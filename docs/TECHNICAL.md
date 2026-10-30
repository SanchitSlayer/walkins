# Walkins: technical reference

Walk-in interview platform. Runs entirely locally via Docker Compose. No paid
services, and no API keys are needed to run it; a Telegram bot token is
optional and only switches alerts from the console to real messages.

## Stack

- apps/web — Next.js 15 (App Router), TypeScript, Tailwind, MapLibre GL
- apps/api — NestJS 10
- apps/worker — Node + BullMQ queues, cron schedules and the Telegram bot
- packages/db — Prisma schema, client, migrations, seed script
- packages/shared — shared TypeScript types and zod schemas
- services/ml — Python FastAPI sidecar: speech-to-text (faster-whisper) and
  multilingual text embeddings (ONNX Runtime)


## Features

Authentication is phone-based. A user requests an OTP, verifies it, and
receives a short-lived JWT plus a rotating refresh token stored in an
httpOnly cookie. OTP requests are rate limited per phone (3 per 15 minutes)
and per IP (10 per hour), and an OTP is destroyed after 5 failed verify
attempts.

Three roles exist: CANDIDATE, EMPLOYER and ADMIN. Employers are scoped to a
single company and cannot read or modify another company's drives. This is
enforced in the service layer, not just the controller.

Employers can create walk-in drives, which are jobs bound to a venue, a time
window and a capacity. Creating a drive generates its interview slots from
the time window and slot duration. Venue addresses are geocoded through
Nominatim and written to the PostGIS columns; if geocoding fails the drive is
still saved and flagged for manual coordinate entry.


Candidates set their home location, travel radius, role interests and
experience on a profile page with a draggable map pin. The targeting query
then finds, for any drive, every candidate whose own stated travel radius
reaches that venue - the radius comes from each candidate row rather than
being fixed, so a candidate willing to travel 3 km and one willing to travel
25 km get different results for the same drive.

That per-row radius means a spatial index cannot be used directly, so the
query applies a constant bounding-box prefilter first and the per-candidate
radius second. Both the prefilter and the validation ceiling derive from one
shared constant so they cannot drift apart.

Public drive search is open to anonymous visitors, with cursor pagination and
distance from either the candidate's home or the city centre. Drives that
have ended are left out of search, but a direct link to one still loads and
says the drive has ended, so a stale forwarded link never 404s. Results
render as a list beside a MapLibre GL city map: OpenStreetMap tiles in the
board's dark palette, each drive a pillar whose height is its headcount and
whose lit top is the seats still open. Filters are held in URL search params.

The interface follows a departure-board design system (tokens and primitives
in `apps/web/components/board` and `apps/web/app/globals.css`, with a live
specimen at `/design` in development). One rule is easy to break by accident:
interface copy is sentence case, but strings from the database are content
and keep the casing they were entered with, so a role title reads
"Warehouse Associate". Don't lower-case or text-transform them.

### Notifications

The problem the platform exists for is that walk-in drives happen and the
people nearby never hear about them in time. Alerts are the core of it.

- Targeting (`packages/db/src/targeting.ts`) decides who a drive is for:
  candidates in the same city with a matching role and experience whose own
  travel radius reaches the venue. It is paged, so a fanout is never capped.
- `AlertService` in the worker turns a drive into one queued job per
  candidate. It never sends anything. Discovery alerts go to the targeting
  set; morning-of reminders go only to candidates who confirmed, read from
  applications, because a reminder is about a commitment, not discovery.
- The `alerts` queue does the sending through a `NotificationChannel`
  (interface in `packages/shared`). A resolver picks the first channel that
  can reach each candidate: WhatsApp (a stub until Meta business verification
  exists), then Telegram, or the console channel when no bot token is set.
- Every attempt is a row in `notifications`. An attempt claims the alert with
  a PENDING row before calling the provider, and a partial unique index allows
  only one PENDING or SENT row per drive, candidate and template, so no retry
  or duplicate job can send the same alert twice. The BullMQ job id
  (`alert.{driveId}.{candidateId}.{templateKey}`) deduplicates earlier and more
  cheaply, but only while the job is kept.
- Sends are throttled to 25 a second, a Telegram 429 pauses the whole queue for
  as long as Telegram asks, and failures retry three times with exponential
  backoff. A send whose outcome is unknown (a timeout, a connection dropped
  mid-request) is not retried, since it may have been delivered; it keeps its
  claim and goes to the dead-letter list for a person to check. Telegram
  reports no delivery receipts, so `deliveredAt` stays empty for it.

Candidates connect Telegram from their profile, which issues a single-use
token (10 minutes, in Redis) and a t.me deep link. The bot, run by the worker
in polling mode so no public URL is needed, answers:

- `/start <token>` links the chat to the candidate
- `/jobs` lists the five nearest live drives within the candidate's travel
  distance, using the same rule as alerts, and says how to widen it if none
- `/stop` unlinks the chat and stops alerts

Scheduled jobs, in India time:

- every 15 minutes: live drives starting within 48 hours that haven't had a
  discovery alert are fanned out
- 07:00: reminders to confirmed candidates for drives starting that day
- 00:30: ended drives move to EXPIRED, and confirmed applications with no
  check-in become NO_SHOW. Booked counts are kept as the record of what was
  booked. (The web app still derives Expired on its own between runs.)
- 01:00: candidate reliability is recomputed as attended over confirmed.
  REJECTED counts toward neither, since it can happen before or after an
  interview. An absence from a drive moved without the notice reaching the
  candidate counts toward neither either (see "Rescheduling a drive"), and
  hiring outcomes never count (see "Hiring outcomes"). Nothing reads the
  score.
- 11:00: candidates whose joining date was in the last week are asked once,
  on Telegram, whether they started (see "Hiring outcomes")

Scheduled jobs only run while the worker is running. If it is stopped over
00:30, ended drives stay LIVE until the next night's run: the missed run is
not replayed. That looks like a bug and isn't one. The web app derives
"Expired" from the end time on its own, so public pages stay right meanwhile,
but anything reading the stored status (the employer list, the alert scans)
sees LIVE until the job runs.

### Booking, check-in and the arrivals board

Candidates book a slot from the drive page and can release it again. Every
change to an application goes through one transition function
(`packages/db/src/applications.ts`) that checks the move is legal, moves the
seat with it and writes an audit row. A slot's last seat can't be sold twice:
the booked count only goes up while it is below capacity, in the same
transaction that creates the application.

At the venue the employer opens the drive's check-in screen on a laptop. It
shows a QR that changes every minute, and the same code in large type under
it. The QR holds only a short link, `/checkin#K7QF4XM2`: the signed check-in
token stays on the server, stored against that 8-character code (Crockford
base32, 40 bits), so the symbol is coarse enough to read off a laptop screen
at standing distance. Anyone whose camera won't read it types the code
instead; that box is on the check-in page from the start, because bad light
and old phones are the normal case. Wrong codes are limited to 10 per
account and 60 per network address every 10 minutes, since a short code is
a secret that could otherwise be guessed.

The code stands for a token that lives 90 seconds, and keeps resolving for 30
minutes after that so a scan made offline can still be sent late (flagged for
the employer). The candidate's phone takes one GPS reading, and the check-in
is accepted within 200 m of the venue, accepted but flagged when the reading
is worse than ±100 m, and refused otherwise. Someone who never booked is
offered a walk-in on the spot.

Before the first check-in the employer should set the venue location from
the laptop, at the venue: geocoding an address often lands on the middle of
an area, hundreds of metres from the building, and every honest check-in
would then be refused. A pin more than 50 km from the drive's city centre
needs an explicit confirmation naming the distance, and a notice stays on the
drive's pages while it is there, because a venue outside its city quietly
breaks alerts, the city map and check-in at once.

The arrivals board (`/employer/drives/<id>/live`) is built to be put on a
screen facing the queue: split-flap counts and the latest arrivals as first
name and last initial with their slot time. It receives its own, narrower
data than the employer gets, so full names, distances and flag reasons can't
reach it. Someone whose account has no name yet is shown as "Arrived".
Their account name is their phone number, and until Phase 9 the board
printed that number in full on the screen facing the queue. Confirming flagged check-ins, marking people present, and marking
them interviewed, hired or not selected all happen on the drive page, which
is the employer's own screen.

Check-in keeps working without signal. The service worker keeps the
candidate's pass and the check-in page available offline, and a scan made
with no signal is saved on the phone and sent as soon as there is signal,
within the 30 minutes the server accepts a late scan for (it is flagged for
the employer). For a late scan the recorded time is when its code expired,
the latest moment the server can vouch for, so the arrivals desk also shows
when the phone saved the scan, labelled as the phone's clock because the
candidate's phone sets it. The page sends it, never the service worker: sending from the
worker would mean refreshing the session outside the page, which races the
page's own refresh and logs the candidate out. Where Background Sync exists
(Chrome on Android) the worker wakes an open page when signal returns; Safari
on iOS has no Background Sync, so there the scan goes when Walkins is next
open with signal. What the phone keeps is cleared on logout.

### Screening, voice intros and matching

**Screening questions.** An employer can set up to five pass/fail questions on
a drive: yes/no, a number with a minimum and/or maximum, or one answer from a
list. Each carries a requirement the employer words for the candidate who
doesn't meet it ("A valid two-wheeler licence"). Answers are checked as the
candidate books. Anyone who doesn't meet one gets no seat and is told the
requirement in plain words, so they don't travel for nothing. Their
application is `SCREENED_OUT`, a state of its own rather than `REJECTED`,
because no person decided it. Answering again after learning the requirement
doesn't book. If they turn up and scan anyway, the scan is refused with the
reason. The employer can still let them in from the applicants page ("Mark
present anyway"), and that is recorded against the employer. Someone who
walks in without ever applying skips the questions; the desk screens them in
person.

**Voice intros.** Most candidates for these jobs have no CV, and many are more
at ease speaking than writing, often not in English. So the profile has a
45-second voice intro instead, recorded in the browser in whatever language
the candidate likes. The recording goes from the phone straight to MinIO on a
presigned POST policy that MinIO itself caps at 2 MB. It never passes through
the API, which is only told once it has arrived. A worker job then sends it to
the sidecar, which decodes and transcribes it with Whisper (the `small` model,
language detected rather than assumed) and refuses anything over 50 seconds.
The candidate's page shows the status live: received, transcribing, ready, or
why it failed. A failed transcript never hides the candidate: employers can
always listen to the recording.

**Matching.** Candidates and drives are embedded into 384-dimensional vectors
by `paraphrase-multilingual-MiniLM-L12-v2`, stored with pgvector. It is
multilingual, so a transcript in Hindi lands near a drive written in English.
A candidate is described by their roles, experience, city and, when it was
transcribed confidently, their intro. A drive is described by its role, pay,
experience band and venue. The applicants page ranks by

    score = w × similarity + (1 − w) × nearness

where similarity is cosine similarity (`1 − (a <=> b)`), nearness is
`1 − distance / 50 km`, and `w` is a slider the employer moves. `w = 0` is
plain nearest-first. Someone with no embedding yet is given the drive's median
similarity, so a missing intro neither lifts nor sinks them, and their row
says "Ranked by distance only". Any change to a profile, intro or drive queues
a fresh embedding, and the worker embeds anything missing when it starts.

**Shortlisting.** The applicants page (`/employer/drives/<id>/applicants`)
lists everyone who applied: answers to each question and whether they met it,
match score, distance, and the intro. Shortlisting is a private flag for the
employer, not a state, so the candidate sees nothing change. Marking booked
candidates "not selected" in bulk frees their seats and sends each of them a
message telling them not to travel.

**Retention.** A recording is someone's voice, so it is kept only while it is
their current intro and never longer than 180 days. Replaced recordings and
old ones are deleted, object and transcript together, by the existing nightly
maintenance job at 00:30. The same job deletes any audio that has no row
and is more than a day old. A file like that can't be played, and the purge,
which finds recordings through their rows, would never remove it. It comes
from an upload that was never confirmed, or a row deleted some other way.
The day's margin is deliberate: a slow upload or a row written late must never
cost someone their recording, and waiting a day costs nothing for a nightly
job. Each one is logged as a warning with its key. Orphans turning up
regularly point to a problem in the upload flow, not routine housekeeping.

#### Transcripts are a guess, and the interface says so

We used Whisper, measured its error rate on our users' language, and built the
interface so it cannot quietly mislead an employer.

**The most important finding: a transcript can pass every confidence check and
still be substantively wrong.** A real candidate said तीन साल (three years) of
experience, and Whisper wrote दीन साल. दीन is a real Hindi word ("poor"), so the
transcript doesn't look wrong to anyone reading it. It was heard clearly and
written confidently: every signal Whisper gives (log-probability, no-speech
probability, compression ratio, language confidence) was healthy, and the
transcript was rated high confidence. **Confidence signals detect unclear
audio, not wrong words.** A clearly heard wrong word passes them all. That is
why every transcript carries a permanent "Automatic transcript, may contain
errors" label, why the recording is always one click away, and why a
transcript is never something employers filter or shortlist on. The details
are below, under "The first real voice measured".

What we measured, on this machine's CPU (Apple Silicon, 4 threads), with
macOS's built-in text-to-speech voices reading prepared scripts:

| Clip | Model | Result |
| --- | --- | --- |
| Hindi, 9.3 s and 27.5 s | base | Language detected correctly ("hi", 97%), but written in Urdu (Perso-Arabic) script, not Devanagari. Forcing Hindi still gave Urdu script, and prompting with Devanagari gave nonsense. An employer couldn't read it, and search and matching couldn't use it. |
| Same two Hindi clips | small | Devanagari. **25.2% word error rate** (27 errors in 107 words). 21.5% if a missing nukta or chandrabindu (ज for ज़, हूं for हूँ) isn't counted as an error. Language "hi" at 94–96%. 6.4 s and 11.6 s to transcribe. |
| English, 8.6 s | small | 0% word error rate, language "en" at 90%, 2.5 s |

`small` is what runs. `base` was dropped because of the Urdu-script result:
handling it gracefully in the interface didn't change the fact that the
transcript, the search and the embedding were all useless for the candidates
this feature exists for.

The first run of `small` also turned up a silent failure. Whisper decodes at
most 448 tokens per 30-second window, and Devanagari costs several tokens a
character, so on the 27.5 s clip it stopped two-thirds of the way through, in
the middle of a letter, with no error. The sidecar now splits speech at pauses
into pieces of at most 15 seconds, and the whole clip is now transcribed.

**These figures are from synthetic audio, not real candidates.** A clear
studio voice reading a script is the easiest case there is. Real recordings
made on cheap phones, in noisy places, with regional accents and Hindi mixed
with English, will do worse, and we have not measured by how much.
Whisper's own published results also show Hindi error rates several times
higher than English for the smaller models. `services/ml/eval/wer.py` runs
the same measurement on a folder of real recordings with hand-written
reference transcripts, and should only be run on recordings whose speakers
agreed.

#### The first real recording: Hinglish

The first real intro, about 31 seconds recorded in a browser, was the case the
synthetic clips couldn't reach: Hindi mixed with English, which is how most
candidates speak. Whisper put it at 48% Urdu, 44% Hindi and 7% English. It
wrote the English sentences in Latin script and the Hindi in Perso-Arabic
script, which a Hindi reader can't read. The interface did what it should:
low confidence, labelled, recording first. We then tried each way of
re-running it, on the same model and settings:

| Pass | Avg log-prob | Time | What came out |
| --- | --- | --- | --- |
| Auto-detect (Urdu) | −0.315 | 10.6 s | English in Latin, Hindi in Perso-Arabic script |
| Forced Hindi | −0.386 | 16.3 s | All Devanagari. The Hindi is readable but misspelled ("प्रोड़व मैंज्मेंट" for product management). The English became phonetic Devanagari ("अलो मैंने में संचित अई आम सुट्टेंट" for "Hello, my name is Sanchit, I am a student") |
| Forced Urdu | −0.315 | 7.7 s | Identical to auto-detect |
| Forced English | −0.284 | 7.1 s | Fluent English, but a **translation** of the Hindi, although the task was set to transcribe |

The obvious fix was a second pass: when Urdu is detected with low confidence,
force Hindi and keep whichever result has the better log-probability. It
would never switch. Forced Hindi scores worse, because log-probabilities from
different scripts and vocabularies aren't comparable, so they can't be the
judge between them. Whether to show forced Hindi to Hindi-reading employers is
held until it has been scored against a hand-written reference of the same
recording. Garbling the English half, the job titles included, may make it
worse than showing no text at all.

**Forced English was tested and rejected, even though it scored best.** It
had the best log-probability of any pass and the most readable text. It was
also not what the candidate said: Whisper translated the Hindi on its own,
even though it was asked to transcribe. Showing it would present a machine's
paraphrase in the candidate's name, in a language they didn't speak in, which
is exactly what the label on every transcript promises not to do. A score
measures how sure the model is of its own output, not whether that output is
the thing that was asked for.

Then we checked the assumption that a transcript in the wrong script makes a
bad vector. We embedded each version and compared it with the same words in
English and with three drives:

| Transcript embedded | vs. the English meaning | Product manager drive | Warehouse drive | Delivery driver drive |
| --- | --- | --- | --- | --- |
| Urdu script (auto-detect) | **0.81** | 0.54 | 0.43 | 0.35 |
| Forced Hindi (Devanagari) | 0.49 | 0.33 | 0.35 | 0.27 |
| English | 1.00 | 0.54 | 0.43 | 0.29 |

The Perso-Arabic transcript embeds almost exactly like the English meaning and
ranks the drives the same way. The words were heard right and only the script
is unexpected, and the multilingual model reads Urdu. The Devanagari version
is the one that damages matching: its misspellings break the model's tokens,
and it puts a warehouse job above product management.

So the one confidence score is now two:

- **Can an employer read it?** Display uses all four signals below. Low
  language confidence counts, because it means the text may have come out in
  a script the reader can't use.
- **Was the audio clear enough to transcribe?** The embedding uses only
  average log-probability, no-speech probability and compression ratio. Low
  language confidence means "unsure which script", not "unsure what was
  said". All three were healthy on this recording, and under the old single
  threshold its best possible input to matching was being thrown away. Clear
  audio is not the same as correct words (see the दीन finding), so these
  three keep out a muddled transcript, not every wrong one.

This rests on one recording. It is a direction to keep measuring, not a
settled result.

#### The first real voice measured: Hindi read from a script

This is the first error rate measured on a real human voice rather than
synthetic audio. A person read a prepared Hindi script into the profile page's
recorder in a browser, so the exact words were known in advance:

> नमस्ते, मेरा नाम सचिन है। मैं जोधपुर में रहता हूँ। मुझे तीन साल का अनुभव है।
> मैंने पहले एक दुकान में सेल्स का काम किया है। मैं फील्ड सेल्स एग्जीक्यूटिव के
> लिए काम ढूंढ रहा हूँ। मैं कल से काम शुरू कर सकता हूँ।

Whisper `small` detected Hindi at 79% and wrote Devanagari:

> नमस ते मेरा नाम सचिन है में जोर्पूर में रहता हूं मुझे दीन साल का अनुबव है
> मैंने पहले एक दुकान में सेल्स का गाम किया है मैं फील सेल्स अग्जिकुटिव के लिये
> कान भूड्राम मैं कल से काम चुरू कर सकता हैं

| | Word error rate |
| --- | --- |
| Real voice, read script, 20.3 s | **38.6%** (17 errors in 44 words) |
| Same, not counting a missing nukta or chandrabindu | 36.4% |
| Synthetic Hindi clips, for comparison | 25.2% |

**The error rate understates the harm.** The errors fall on the words an
employer reads a transcript for:

| Said | Transcribed | What was lost |
| --- | --- | --- |
| तीन (three) years' experience | दीन | The number. दीन is a real word ("poor"), so it doesn't even look wrong |
| जोधपुर | जोर्पूर | Where they live |
| फील्ड सेल्स एग्जीक्यूटिव | फील सेल्स अग्जिकुटिव | The job they want |
| काम ढूंढ रहा हूँ (looking for work) | कान भूड्राम | That they are looking for work at all |

Of the six things this intro tells an employer, the name, the previous job (sales in a
shop) and the start date ("from tomorrow") came through. The years of
experience, the city and the role wanted did not. Numbers, place names and
English job titles written in Devanagari are where Whisper is weakest and
where a wrong word matters most: they are rare in what the model learned from,
and तीन and दीन differ by a single consonant.

None of the confidence signals noticed. Log-probability −0.33, no-speech
probability 0.16, compression ratio 2.12 and language confidence 79% all pass,
so this transcript is rated high confidence and shown to employers as text.
The audio was clear, and the signals measure exactly that. They have no way to
know that a clearly heard word is the wrong one. The only thing between an
employer and "दीन साल" is the label on every transcript.

#### Hindi or Urdu: language detection on real voices

The Hinglish recording raised the question of whether code-switching is what
makes Whisper write Hindi in Urdu script. Four real recordings, all on
`small`:

| Recording | Detected | Script written |
| --- | --- | --- |
| Hinglish, 31 s | Urdu 48% | Perso-Arabic for the Hindi, Latin for the English |
| Pure Hindi, formal vocabulary, 15 s | **Urdu 78%** (Hindi 17%) | Perso-Arabic |
| Pure Hindi, 21 s | Hindi 83% | Devanagari |
| Pure Hindi, read script, 20 s | Hindi 79% | Devanagari |

**On short clips Whisper often cannot tell Hindi from Urdu.** Code-switching
made it worse in the one sample we have, but pure Hindi was also written in
Urdu script once in three. The pure-Hindi recording that came out as Urdu used
formal vocabulary (शाखा, रसायन विज्ञान), about as far from Urdu as Hindi goes,
and it reproduced on a second run. It also passed every confidence check, at
78% language confidence. What kept it from an employer was the script check,
which judges the text by the script it came out in and offers the recording
instead.

These are four recordings from one speaker. Only the read-script one has a
measured error rate. The Urdu-script recording was not scored: scoring needs a
reference transcript, and the recording was left to be deleted under the
retention policy rather than kept back to grow the sample. Keeping someone's voice past its
retention to improve a statistic is the wrong trade.

So, wherever a transcript appears:

- It is labelled "Automatic transcript, may contain errors" every time it is
  shown, never once in a tooltip. It is never presented as what the candidate
  said. The label is the only guard against a confident, plausible wrong word
  like दीन for तीन, because no signal Whisper gives can catch one.
- The detected language and how sure Whisper was of it sit next to it.
- When the audio was hard to make out, the recording comes first and the text
  is folded away under a note saying it is likely to be wrong. "Hard to make
  out" means any of: average log-probability below −0.7, no-speech probability
  above 0.5, compression ratio above 2.4 (Whisper repeating itself), or
  language confidence below 60%.
- Readability is judged by the script the text actually came out in, not by
  the language Whisper detected. `base` wrote all Hindi in Urdu script, and
  `small` did it for one pure-Hindi recording in three and for Hinglish, at
  confidence high enough to pass every other check. Each company records
  which languages its team reads (English and Hindi by default). A
  transcript in a script nobody there reads is not shown at all. The employer is told which script it came out in and offered the
  recording instead.
- A transcript whose audio was hard to make out (the first three signals) is
  left out of the candidate's embedding, so a muddled transcript doesn't
  decide their match score. One whose only problem is the language is kept,
  for the reasons above. A clearly heard wrong word still gets through, into
  the embedding as into the text.

### Billing: employers pay for verified show-ups

An employer pays for one thing: a person who actually arrived. That is what
the system can prove (the QR, the geofence and the employer's own desk exist
to establish it) and what an employer values. Applications, alerts and
bookings are free. A check-in costs ₹200, set as data in `pricing_rules`, not
in code. A check-in is charged when it is verified, and every kind counts:
- a scan inside the venue's geofence;
- a walk-in;
- someone the desk marks present, including "mark present anyway" for a
  screened-out candidate. The employer is vouching that this person came, and
  if their word were free, the desk could mark the whole room present.

A flagged check-in (a loose GPS reading, or an offline scan sent late) isn't
charged until the employer confirms it.

#### The ledger

Money lives in a double-entry ledger: `ledger_accounts`, `ledger_entries` and
`pricing_rules`. Each company has a wallet account. The platform has three:
- `revenue`, for check-in charges;
- `gateway`, for money received through the payment gateway;
- `promotions`, for credit the platform has given away.

The rules are enforced by Postgres itself, in the migration's SQL, so no code
path, script or psql session can break them by accident:

- **Every transaction balances.** A deferred constraint trigger checks, for
  each `txnId`, that debits equal credits and every account shares a currency.
  It runs when the transaction commits rather than per row, so both legs can
  be inserted first. A later transaction adding an unbalanced leg to an old
  `txnId` is refused the same way.
- **Append-only.** Triggers refuse UPDATE, DELETE and TRUNCATE on entries,
  accounts and prices. A mistake is fixed by a new, reversing transaction,
  never by editing history. A price change is a new row with a later
  `effectiveFrom`.
- **Whole paise only.** `amountPaise` is an integer, checked positive; a
  direction says which way the money moves. Every API schema insists on
  integers. Paise become rupees in exactly one place, `formatPaise`, and only
  as text.
- **Balances are never stored.** The `ledger_balances` view computes credits
  minus debits for every account. Under that one rule, platform accounts that
  hold money read negative; the admin ledger says so rather than flipping signs.
- **No double charges.** `txnId` is predictable (`charge:checkin:<id>`,
  `topup:<payment id>`, `promo:launch:<company>`), and a unique index on
  `(txnId, accountId, direction)` turns a retry, a redelivered job or a
  replayed webhook into a no-op.

The limit, stated honestly: the app connects to Postgres as the tables' owner,
so revoking UPDATE and DELETE (which the migration does) changes nothing for
it. The triggers are the real guard. A database superuser can disable
triggers. These rules protect the ledger from the application, not from
someone with full control of the database.

**Prisma hides commit-time errors.** Building this turned up a Prisma
behaviour that would have defeated the balance rule silently. When the
deferred trigger rejects a transaction at COMMIT, Postgres rolls it back,
but Prisma's interactive `$transaction` reports success. A charge job would
have logged "charged ₹200" with nothing written. So `postTransaction` runs
`SET CONSTRAINTS ledger_entries_balanced IMMEDIATE` after inserting its
legs. That fires the check inside the transaction, as an ordinary error Prisma
does report. `apps/api/test/ledger.test.ts` pins down both halves: the
database still refuses the write left to commit, and the immediate check
raises. If a Prisma upgrade starts reporting commit errors, that test fails,
and the workaround can be reconsidered.

#### Charging

1. The check-in transaction commits and the candidate gets their answer.
   Billing runs after that and can neither undo it nor slow it down.
2. The API queues a `charge` job and **doesn't wait for it**. BullMQ's
   connection waits out a Redis outage rather than failing, which would
   otherwise hang the response at the gate. If queueing fails, it is logged
   and the check-in stands.
3. The worker's charge job debits the company's wallet and credits platform
   revenue, at the price **in effect when the person arrived** (`effectiveFrom
   ≤ scannedAt`), not when the job runs.
4. **The guarantee:** every 15 minutes, the existing maintenance schedule
   sweeps for verified check-ins since billing began that have no charge, and
   queues them again. A dropped job delays a charge; it never loses one.
5. Failures retry with backoff. A job that runs out of retries stays in the
   charge queue's failed set, which the admin panel shows and can retry.

Check-ins from before the launch price existed are never charged. Payment
outages can't touch any of this: charges only move money between ledger
accounts, and the gateway is only used for top-ups.

**A wallet can go negative during a live drive.** The show-up happened and is
owed. Refusing to record it would let a billing state affect a person standing
at a gate, which this project has avoided throughout. A negative or short
balance shows on the employer's billing page and blocks any new drive from
going live.

One known gap: if a price of ₹0 is ever set, a check-in at that price has no
charge to record, so the sweep keeps re-queueing it every 15 minutes. That is
harmless, but wasteful.

#### Wallet and top-ups

Employers top up through Razorpay test mode or a mock gateway, both behind
`IPaymentGateway` (`apps/api/src/billing/`), the same pattern as the
notification channels. `PAYMENT_GATEWAY` picks the gateway:

- **`mock` (the default)** runs the whole flow with no network and no keys.
  It produces orders, payments, checkout signatures and signed webhooks shaped
  exactly like Razorpay's, so a demo runs the real verification and crediting
  code. The billing page shows a panel ("Pay", "Decline the payment") where
  Razorpay's checkout window would be. Its secrets are generated afresh each
  time the API starts, and it refuses to start in production.
- **`razorpay`** uses Razorpay's REST API directly, with no SDK. It needs
  `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`. The
  webhook secret is the one set on the webhook in Razorpay's dashboard, not the
  key secret. The account must capture payments automatically: an authorised
  but uncaptured payment is never credited.

Money is credited in one place, keyed on the gateway's payment id. Two paths
lead there, and using both still credits once:

1. **The webhook** (`POST /api/billing/webhooks/razorpay`). Every delivery is
   stored first, exactly as received, valid or not: the raw bytes go in a text
   column, because a JSON column would re-serialise them. Then:
   - The signature is checked over the raw request bytes with a constant-time
     comparison. A bad signature gets a 400 and nothing else happens.
   - Only `payment.captured` and `order.paid` credit. `payment.failed` marks
     the order failed only if it is still open, so a captured order never moves
     back to failed, whatever order events arrive in.
   - Retries, duplicate events and replays (Razorpay's signature has no
     timestamp) all reach the same payment id and change nothing.
   - The captured amount and currency must match an order we created for that
     company.
   - A second, different payment on an order that's already paid is refused
     and logged for a refund.
2. **Confirmation after checkout.** The page's word is never enough. The API
   verifies the checkout signature, then asks Razorpay directly whether the
   payment was captured.

**The webhook is correct but unexercised against live deliveries.** Razorpay
can't reach a webhook on a laptop without a tunnel, and none is used, so in
local development money arrives through the second path. The webhook handler
is fully implemented. `apps/api/test/billing.test.ts` covers it with signed
payloads: duplicates, racing deliveries, forged and edited bodies, events out
of order, a failed attempt followed by a successful one, and the wrong amount.
Every mock top-up also delivers a signed webhook through the same handler
before the page confirms. It has never received a delivery from Razorpay
itself.

Refunds and disputes (`refund.*` events) are stored but not acted on; a refund
would be a reversing ledger transaction. **A drive can't go live while the
company's balance is below the cost of one check-in.** The admin's approval
refuses it and says why, and the employer's drive page and billing page say
so as well.

#### Admin panel

`/admin` is for the ADMIN role only. Nothing created an ADMIN before this
phase, and sign-in still can't, on purpose. An admin is made with a script:

```
pnpm admin:create <10-digit phone> <name>
```

It is a script rather than a seed flag so it runs once against any database
without reseeding. It changes nothing if the phone is already an admin, and
refuses a phone that belongs to a candidate or employer. Sign in with that
phone, and the login page sends admins to `/admin`. The panel has six pages:

- **Verification.** Companies' submissions, which an admin approves or
  rejects with a reason (see "Trust and safety").
- **Moderation.** Reports, warnings and suspensions (see "Trust and
  safety").
- **Drives.** Approving is how a drive goes live. It needs a company that is
  verified or waiting on review, not suspended, with at least one check-in's
  worth of credit. Every blocker is listed on the drive at once. Sending a drive back returns it to draft with the
  reason, which the employer sees on their drive page.
- **Failed jobs.** Every queue's dead-letter set: alerts, charges, voice,
  embeddings and maintenance. Each job has a "Retry" button with a
  confirmation. Retrying is safe: alerts claim a slot before sending, and
  charges and top-ups are keyed so a second run changes nothing.
- **Ledger.** Every account's balance, entries filterable by account or
  transaction, a line saying whether every transaction balances, and the price
  history with a form for a new price. A new price takes effect from now or
  later, never earlier.
- **Retention.** Thirty-day retention by employer across the platform,
  counted from `application_facts` with the same coverage rules employers
  see for their own roles (see "Employer analytics").

#### Employer analytics

`/employer/analytics` reads materialised views. The worker refreshes them
every 15 minutes from the existing maintenance schedule, using `CONCURRENTLY`
so they stay readable while refreshing, and the page says when they were
last refreshed. A busy dashboard never queries the live tables check-in
depends on. Per drive (`drive_funnel`):

- **Alerted:** candidates sent the 48-hour alert.
- **Applied:** applied in any way other than walking in. **Screened out**
  is counted beside it, not in it.
- **Held a seat:** the arrivals board's rule. A booking that was released,
  or rejected before anyone scanned it, never held a seat.
- **Came:** held a seat and has a verified check-in.
- **Awaiting confirmation:** checked in, but the check-in is flagged and
  the employer hasn't confirmed it. Counted on its own, never as absent.
- **Walk-ins:** counted apart, outside the funnel.
- **Attended after an alert:** came, having been sent the 48-hour alert
  before applying. *After*, not *because*: nothing here can show the alert
  is why they came, and the page never says it is.
- **Hired:** the application is HIRED, which is final (see "Hiring
  outcomes").
- **Show-up rate:** came divided by held a seat.

**Cancelled and suspended drives are listed but left out of every rate and
total.** Nobody booked on them could have come.

A second view counts verified check-ins and hires per day, by India's
calendar day, for the 30-day chart. The charts use two colours of their own,
`--chart-1` and `--chart-2`, validated for colour-blind separation and
contrast on the desk's dark surface. The state lamps stay reserved for state.

**Errors in the funnel this phase fixed.** Each made employers' numbers
worse than the truth, or better:

1. **Releasing a seat counted as not turning up**, including a release after
   the drive was rescheduled, which the candidate had every right to make.
   This is the Phase 10 reliability bug (see "A bug this phase fixed" under
   "Trust and safety") on the employer's side: a no-show counted against
   someone for something that wasn't a failure to turn up.
2. **Cancelled and suspended drives were counted**, so a drive nobody could
   attend dragged show-up down.
3. **Hired would have dropped people** as soon as any state came after
   HIRED. Nothing does now: what happens after a hire is a separate record,
   not more states.
4. **Applied included screened-out applicants**, who never held a seat.
5. **A flagged check-in counted as absent**, though the person was at the
   venue and only the employer's confirmation was missing.
6. **Alerts were never linked to who came.** Alerted and checked in were
   two unrelated counts.

**Slices and outcomes.** A third view, `application_facts`, holds one row
per application on a drive that left draft: role, city, the candidate's
distance from the venue in bands, the hour their slot started, whether they
held a seat and came, whether an alert reached them before they applied,
and what is known after a hire. From it the page shows:

- show-up by role, city, distance and slot hour, counting only who held a
  seat;
- time to join: drive day to first day at work, from starts the employer
  recorded, with how many the candidate confirmed;
- thirty-day retention by role.

**Coverage rules for every figure that comes from outcomes.** Outcomes are
recorded by employers, and most are never recorded:

1. **Every figure carries its coverage**: "from 10 of 14", never a bare
   rate.
2. **Not recorded is its own column**, never counted as left. Retention is
   stayed divided by recorded.
3. **No rate or median below 10 recorded** (`OUTCOME_MIN_RECORDED`). The
   counts are still shown, with "shown at 10".
4. **Nothing is extrapolated.** Unrecorded hires aren't assumed to look
   like recorded ones.

Show-up and alert attendance come from Walkins' own records (scans and
sends), not anyone's word, so they need no minimum.

#### What is live and what is scaffolding

Parts of the data model existed before anything used them. This phase made
these live:

| In the schema | Before Phase 7 | Now |
| --- | --- | --- |
| `UserRole.ADMIN` | Nothing created or checked it | `pnpm admin:create`, and the `/admin` panel |
| `Company.verificationStatus` | Only the seed set it; nothing read it | Set by an admin's decision on a submission (Phase 10); approving a drive needs a company verified or awaiting review |
| `Company.gstin` | Stored, never read | Sent with each verification submission |
| `DriveStatus.PENDING → LIVE` | Employers could submit, but nothing moved a drive live; seeded drives were simply created LIVE | Admin approval, after the verification and balance checks |

Still scaffolding after this phase:

- **Company self sign-up.** Companies, and each company's first owner, come
  only from the seed. Everyone after the first owner joins by invitation
  (see "Teams"). The verification queue is filled by seeded companies until
  companies can register themselves.
- **The verification provider** checks GSTIN format, not a registry. It only
  advises; an admin decides.
- **`ApplicationState.INTERESTED`.** No transition leads into it, so no
  application can be in it. The transitions out of it, and the screens that
  handle it, are waiting for a "save for later" feature.
- **`Candidate.reliability`** is recomputed every night and read by
  nothing. If it is ever shown to anyone, the candidate sees it first, on
  Your record.
- **`Notification.deliveredAt`** is never written: Telegram doesn't report
  delivery, and WhatsApp, which would, is not implemented.
- **Refunds and disputes.** Webhook events are stored, nothing more.

### Teams: owners, recruiters and viewers

A company used to be one login. Now it is several people, each with a role.

**Two axes of authority.** `UserRole` (CANDIDATE, EMPLOYER, ADMIN) still
says which side of the product someone uses. `CompanyRole` (OWNER,
RECRUITER, VIEWER) is a separate column on `users`, next to `companyId`.
A check constraint keeps the two either both set or both empty. It says
what someone may do inside their company:

| Permission | Owner | Recruiter | Viewer |
| --- | --- | --- | --- |
| Read: drives, applicants, desk, analytics, wallet balance, the team | yes | yes | yes |
| Run drives: create, edit, submit, cancel, pin the venue, show the check-in code, shortlist, reject, desk actions | yes | yes | no |
| Billing: top-ups | yes | no | no |
| Company settings: the languages the team reads | yes | no | no |
| People: invite, revoke, change roles, remove, reassign drives | yes | no | no |

The table is `COMPANY_PERMISSIONS` in `packages/shared/src/people.ts`. The
API enforces it, and the web reads the same table to hide what a role
can't do.

A membership table was considered and not used. A person belongs to at
most one company, so a join table would add many-to-many lookups for
nothing. The history of who joined, changed role or left is in
`audit_logs`, which is what it's for.

Any recruiter can run any of the company's drives, not only their own. On
a walk-in day, whoever is at the desk works the drive. Each drive has an
`ownerId`, the person answerable for it. It is the creator by default, and
an owner can hand it to someone else from the drive's page. The owner
field records accountability; it doesn't block anyone.

**Where the check lives.** Every employer service method starts with
`requireCompanyAccess(userId, permission)`
(`apps/api/src/common/require-company.ts`). It reads the person's company
and role from the database, not from the access token. Removing someone,
or changing their role, therefore takes effect on their next request. It
doesn't wait up to 15 minutes for their token to expire. The cost is one
primary-key lookup per employer request. Controllers only pass the user's
id along.

`apps/api/test/people.test.ts` calls every employer service method as each
role. It checks that each call is allowed or refused exactly as the table
says, and that someone in no company is refused everything.

#### Invitations

1. An owner invites a colleague by the 10-digit number they sign in with,
   with a name and a role.
2. Nothing is sent to that phone, because there is no SMS provider. The
   People page shows the owner what to tell them: sign in at this address
   with this number.
3. The colleague signs in with an OTP like anyone else. If an invitation is
   open for that number, login takes them to `/join`.
4. `/join` shows the company's name and city, who sent the invitation, and
   what the role can do. They join with one tap.

A tap is needed, rather than joining automatically. Indian carriers reissue
phone numbers, so an invitation can reach a stranger who now holds a former
employee's number. Seeing the company's name before joining is the only
guard against that, and the page tells them to leave an invitation they
don't recognise.

The rules an invitation follows:
- **It expires after 7 days.** An expired invitation for a number is
  replaced when the owner sends a new one.
- **An owner can revoke it**, and the invitations a person sent are revoked
  when they leave.
- **It can be accepted once.** Accepting is one conditional update
  (open, unexpired, unrevoked). Two taps at once, or a tap racing a revoke,
  can't both succeed. A partial unique index allows one open invitation per
  company and number.
- **Someone can join only one company.** Accepting two companies'
  invitations at once joins exactly one.
- **Joining waits while the invitee has a booked interview still ahead.**
  Joining turns the account into an employer's, which would quietly cost
  them the seat. The join screen names each booking and points to My
  drives. The API refuses the join until the bookings have been attended
  or released.
- **Joining hides the candidate profile.** The profile stays, hidden, and
  the person stops getting job alerts: targeting now excludes anyone who
  isn't a candidate.
- **The invited name takes over** if the account's name is still its phone
  number.

#### Removing someone, or leaving

The user's row is never deleted. Their name is on the audit trail, on
shortlists, on the drives they ran and on payment orders, and all of that
stays as it was.

Removing someone, in one transaction:
- moves their **open drives** (draft, in review, live) to a successor the
  owner picks, by default the person doing the removal. Finished drives
  keep their name as history;
- leaves their **shortlists** in place. A shortlist belongs to the
  application, and "Shortlisted by" keeps their name, marked "(left)";
- leaves the **audit trail** untouched. `actorUserId` keeps pointing at
  them;
- revokes the invitations they sent;
- turns the account back into a candidate account.

After the transaction, any open live-board socket of theirs is
disconnected. The desk view shows candidates' names, so a board left open
must not outlive their place in the company. Joining checks membership in
the database, as HTTP requests do.

Two more rules:
- **Demoting someone to viewer hands their open drives on** the same way,
  because a viewer can't run a drive.
- **A company always has an owner.** The last owner can't leave, be removed
  or be demoted. Membership changes lock the company row, so two owners
  removing each other at the same moment leave exactly one.

#### Who did what

With one login per company, every audit row's actor was the same account.
Now the actor field records something, and more is recorded:
- **Drive changes are audited**, naming who did them: created, edited,
  submitted, cancelled, owner changed. Before this, only venue pins were.
- **Shortlisting is audited**, and `applications.shortlistedById` is a real
  foreign key. Before, it was an untyped string nothing read. The
  applicants page shows who shortlisted each person.
- **The arrivals desk shows who did each action:** who marked someone
  present and who confirmed a flagged check-in, read from the audit log.
  Two people at one desk can see each other's work.
- **Membership events are audited on the company:** invited, revoked,
  joined, role changed, removed, left.

#### Accounts after the migration

Migration `20261011090000_company_roles` gives every existing employer a
role:
- the user whose phone is the company's contact phone becomes OWNER. If no
  user has that phone, the company's longest-standing employer does;
- every other employer at a company becomes RECRUITER;
- an employer with no company, who could open the console but do nothing
  in it, becomes a candidate again;
- each existing drive is owned by its company's owner, because who created
  it was never recorded.

The seed then adds one account per role, and a second company:

| Phone | Company | Role |
| --- | --- | --- |
| 9999999999 | Test Company | OWNER |
| 9111111111 | Test Company | RECRUITER |
| 9222222222 | Test Company | VIEWER |
| 9666666666 | Rival Company (Bengaluru, verification PENDING) | OWNER |

Rival Company gives the admin verification queue a real entry. It also
provides drives that Test Company's people must never see.

#### Known gaps

- **Employers can't set their own name.** OTP sign-up names an account by
  its phone number. An invitation's name replaces that when the person
  joins, but employers who were in a company before this phase (9555555555,
  9876543210, 9111111111) still show their numbers on the People page.
- **The access token still says EMPLOYER** for up to 15 minutes after
  someone is removed. The API refuses them at once, because it reads the
  database. The web shell shows "Not part of a company" until the token is
  refreshed.
- **A company's contact phone is separate from its owners.** It stays
  whatever the company registered with, and the admin panel shows it.
- **A phone number can belong to only one account.** Someone who wants to
  be both a recruiter and a job seeker needs two numbers.

### Trust and safety

Indian blue-collar job platforms are overrun with fake recruiters who
charge "registration fees". Everything here is a defence against that.

**Who the messages are for.** The person reading a notice here is usually
the one with least power in the situation, and no idea why it is
happening. So every message about a suspension, cancellation, report or
warning says:
- what is happening;
- that the reader hasn't done anything wrong, when they haven't;
- what to do now.

None of them names an accusation to the people it doesn't concern: a
candidate is told a drive is "paused while Walkins checks it", never why.

#### Verification

1. An owner sends the company's GSTIN and documents (PDF, JPG or PNG, up to
   5 MB each, at most 3) from the console's Verification page. Files go
   straight to storage under the company's own prefix, so a submission can
   only name files its company uploaded.
2. The verification provider runs when the submission arrives. Its verdict
   is recorded as **advice**: the admin's Verification page shows it, worded
   as a mock.
3. An admin opens the documents (links signed for five minutes) and
   approves, or rejects with a reason code (unreadable, details don't match,
   GSTIN invalid, not a business, other) and an optional note. The decision
   is recorded on the submission and in the audit log, with the admin.
4. A rejected company sees the reason in plain words and can send again.
   Every submission stays as history.

**The provider is still a mock.** `MockVerificationProvider` checks a
GSTIN's format and looks nothing up. Both the admin page and the employer
page say so. A real GST registry or KYC provider replaces it behind
`IVerificationProvider` without touching anything else.

A company's status is one of:

| Status | Meaning | Can it go live? |
| --- | --- | --- |
| UNSUBMITTED | Nothing sent yet | No |
| PENDING | A submission is waiting for an admin | Yes, at limited reach |
| VERIFIED | Approved | Yes |
| REJECTED | Turned down; it can send again | No, until it does |

A company waiting on an admin can still operate. A rule that stopped it
completely would push real employers to a competitor while doing nothing a
reach limit doesn't already do.

The migration made each existing PENDING company with a GSTIN a submission
awaiting review, with no documents, so the queue stayed real. One with no
GSTIN became UNSUBMITTED.

#### Reach for unverified companies

**The rule:** a drive from a company awaiting review alerts only **the
nearest 50 candidates who match it** (`UNVERIFIED_ALERT_LIMIT`). Targeting
already sorts nearest first, so the alert fan-out stops at 50. Reminders to
people who booked are never limited, and the drive still appears in
search.

Fifty is small enough that a fake recruiter can't reach a whole city with
one drive, and large enough that a real employer waiting on review can
still fill a walk-in.

**The employer is told:**
- every desk page shows a banner while the company isn't verified, saying
  alerts reach only the nearest 50, and why;
- each drive's page shows the numbers, for example "the nearest 50 of the
  312 candidates who match", with a link to Verification.

**Candidates are told:** the public page of an unverified company's drive
says its documents are still waiting to be checked.

#### Reporting

- **Anyone can report a drive** from its public page, signed in or not:
  asks for money, not a real job, misleading pay, abusive, or something
  else, with optional details of up to 500 characters.
- **Anyone at a company can report a candidate** who applied to one of its
  drives, from the applicants page or the arrivals desk: abusive, fake
  profile, or something else.

**Why logged-out reporting isn't a spam vector**
- **A report never does anything by itself.** Nothing is hidden or
  suspended until an admin acts, so flooding reports costs an admin's
  attention, not a company its drive.
- **Repeats collapse.** The same account or network reporting the same
  drive for the same reason within 24 hours adds no row.
- **Logged-out reports are capped per drive.** Past 200 in a day, more are
  counted in Redis rather than stored, and the queue shows that count. The
  table can't be filled from outside.
- **A honeypot field** that no person sees catches crude scripts.
- **No raw addresses are kept.** A logged-out report stores a keyed hash of
  the address, enough to group one network's reports. The queue says
  plainly that one network can be thousands of people.
- **Every path answers "received" the same way**, so a script can't tell
  which of its reports were kept.
- **A generous rate limit:** 30 an hour, per account or else per address.

#### Moderation

The admin Moderation page shows:
- open reports grouped by drive or candidate, most recently reported first;
- for each target, counts of signed-in reporters and logged-out reports
  (plus any past the cap), and reasons;
- for each report, the reporter's record: how many reports they have made,
  and how many were dismissed or acted on. A reporter whose reports are
  mostly dismissed shows in red.

Actions: **dismiss, warn, suspend drive, suspend company**, and lifting a
suspension from the suspended list.
- Each action writes a `moderation_actions` row and an audit row, and
  resolves the open reports it answers.
- A **warning** is shown to the company's people, or to the candidate,
  until someone acknowledges it. It says what was reported, that nothing
  has been taken away, and the admin's note if there is one.
- **Candidates can't be suspended this phase.** Suspending a candidate
  needs rules for their bookings, and half-building it would be worse than
  not building it.

#### When a drive or company is suspended mid-day

`DriveStatus.SUSPENDED` is a status of its own, not a flag beside LIVE.
Every check that a drive is LIVE (search, applying, the check-in code,
check-in, alerts, targeting) therefore refuses a suspended drive without
having to know about suspension.

| Area | What happens |
| --- | --- |
| Search and `/jobs` | Gone at once |
| Public page | A civil "paused" notice instead of a 404, so someone arriving from an old alert understands |
| Bookings | Kept as they are; candidates can release them |
| Telling people | Everyone booked who hasn't checked in gets a `drive_suspended` Telegram alert and a notice on My drives: paused while Walkins checks it, they haven't done anything wrong, don't travel for now, and holding it won't count against them |
| Queued alerts | Each alert checks the drive is still in the status it was written for, so a stale reminder is skipped |
| Check-in | Refused with the same civil wording; no code is issued |
| The desk | Read-only: nothing can be confirmed, marked present or moved on |
| Charges | Check-ins made before the suspension stay charged. Flagged ones can't be confirmed, so they're never charged |
| No-shows and reliability | Never marked against anyone on a suspended drive |
| Lifting it | If the drive hasn't ended, it goes back to the status it had and everyone booked who hasn't checked in gets a `drive_reinstated` alert. If it ended while suspended, it stays SUSPENDED for good, as the record of what happened |

**Suspending a company:**
- sets `Company.suspendedAt` and suspends every drive it has live or in
  review, marked as caused by the company;
- makes its desk read-only, in `requireCompanyAccess`: its people can see
  everything and change nothing, including approvals, invitations and
  top-ups.

Lifting the company restores only the drives its suspension caused. A drive
suspended on its own stays suspended until it is lifted on its own.

**No refunds on suspension.** Check-ins charged before a suspension were
real show-ups. If a refund is ever needed, the ledger can carry it as a
reversal transaction: new balancing entries that leave the original charge
in place.

#### Never pay anyone

The same statement stands wherever a candidate reads about a job: Walkins
never charges candidates, no employer should ask them for money, and here
is how to report it. It appears:
- as a band on every public drive page, above booking, linking to that
  drive's report form;
- as the last line of every Telegram alert, with the drive's report link;
- in the bot's `/jobs` and connection replies;
- on My drives.

#### A bug this phase fixed: cancelled drives harmed candidates' reliability

The nightly reliability score counted a CONFIRMED booking on any drive that
had ended as a missed interview, **including drives the employer had
cancelled**. A candidate's score was damaged by a decision that wasn't
theirs, and they had the least chance of noticing.

The recompute now counts only drives that ran (LIVE or EXPIRED). It
rescores every candidate, so a candidate whose only bookings were on
cancelled drives goes back to having no score.
`apps/worker/test/reliability.test.ts` covers it, and fails against the old
query.

Cancelling a live drive also used to tell nobody who had booked it. It now
sends each of them who hasn't checked in a `drive_cancelled` alert: don't
travel, and this won't count against you. Someone already checked in is
at the venue, and hears it from the desk. The cancel, suspend, lift and
reschedule notices all go through `alertBooked` and its `BOOKED` filter,
and their wording says "who hasn't checked in" to match. A drive can no longer be cancelled once it has ended, or
while it's suspended.

#### Known gaps

- **Alerts reach only candidates with Telegram linked.** Everyone else
  learns of a suspension or cancellation from My drives or the drive page.
- **Each alert is sent at most once per drive.** If a drive is suspended,
  lifted and suspended again, the second suspension alert isn't sent; the
  My drives notice still shows.
- **There's no appeal flow.** A suspended company has no way to respond
  inside the product.

### Rescheduling a drive

Before this, an employer who needed to move a drive could only cancel it
and create a new one, which silently lost every booking. Now anyone at the
company who can run drives can move one from its page, with
`POST /drives/:id/reschedule`. It works on a draft, a drive in review, or a
live drive that hasn't ended. A suspended drive's desk is read-only, so it
can't be moved.

**Slots move with the drive.** They keep their length and order:
- **a later or earlier time** shifts every slot by the same amount;
- **a longer window** adds slots at the end, with the same number of seats
  as the last one;
- **a shorter window** drops slots from the end. Anyone booked into a dropped
  slot moves to the latest remaining slot that hasn't started and has room:
  the nearest to the time they chose.

**Slots must fill the window, or nothing moves.** Where everything goes is
worked out from slots that fill the drive's window end to end, in equal
steps from its start, which is how `create()` makes them. Nothing else
guarantees that layout. So a reschedule first checks it, and refuses a drive
whose slots don't fit, saying so: the drive can still run at its current
time, or be cancelled. A refusal the employer can act on beats moving
someone to the wrong slot.

**Nobody is stranded silently.** If anyone booked can't be moved, the
reschedule is refused before anything changes. The refusal names each
person and says how many. The friction is deliberate: the employer is
making a change that harms people who did nothing wrong, and should see
exactly whom. An employer who truly can't run the drive can still cancel
it, which tells everyone properly. The refusal says so.

**Once check-in has opened** (an hour before the start), people may already
be at the venue, so the start is fixed and only the end can move:
- **later**, freely;
- **earlier**, never before now, and only if everyone booked into a dropped
  slot can move to a slot that hasn't started.

People already checked in, their charges and the desk are untouched.

**Everyone booked who hasn't checked in is told** with a
`drive_rescheduled` Telegram alert. Someone already checked in is at the
venue, where only the end can still move and the desk can tell them in
person; a notice offering to release a seat they are sitting in would be
wrong. The confirmation the employer sees counts the same people
(`confirmedCount` on the drive, from the filter `alertBooked` uses), so it
never promises a notice to someone who won't get one.
- It gives the old and new times and their slot.
- It says they can release their seat without it counting against them.
  That was already true: a WITHDRAWN booking never counts in reliability,
  and a test pins it down.
- If two reschedules happen before the alert goes out, only the latest is
  sent, and it names the time the candidate last knew, not an in-between
  time nobody announced to them.

**History.** Every reschedule is a `drive_reschedules` row and an audit
entry, and the drive's page lists them with who made each change. Each
entry gives the dates themselves: "today" and "tomorrow" are relative to
the reader, and a move made two days ago to "Tomorrow" would read as a date
still to come.

**The edit form no longer changes times.** Editing a draft's or pending
drive's time through the form used to leave its slots at the old times, a
bug from before this phase. The form's time fields now point to
Reschedule, and the API refuses a time change through edit.

#### Known gaps

- **The confirmation comes before the server checks the move.** The
  employer agrees that people will be told, and only then may the server
  refuse the move (someone would be stranded, or the time is in the past).
  Nothing changes on a refusal, so it costs a click, not a wrong move.
- **The time fields show the browser's clock format.** A
  `datetime-local` input is drawn by the browser in its own locale, so it
  can show "03:30 PM" while the rest of Walkins uses the 24-hour clock. A
  page can't set the format of a native input.

#### Everything that keys off a drive's time

| Area | What happens when the time moves |
| --- | --- |
| Check-in window | Opens an hour before the new start, closes at the new end |
| Expiry and no-shows | At the new end |
| Reliability | Counts CONFIRMED bookings only once the new end has passed, and not at all if the notice of the new time never reached them: see below |
| 48-hour discovery alert | Not sent again. Moving a drive earlier into the window lets it alert if it hasn't yet |
| Morning-of reminder | Sent again for the new day: see below |
| Applying | "Slot has started" and "drive has ended" use the new times |
| Search, `/jobs`, My drives, the public page | Use the new times |
| Lifting a suspension, approving a drive, joining a company | Each checks "not ended" against the new end |
| Charges, the charge sweep, prices | Unaffected: keyed to each check-in's own time |
| Analytics | Unaffected: grouped by check-in day |

**The reminder bug this avoids.** The "at most one alert" index allowed one
morning-of reminder per drive and candidate, ever. A drive moved to another
day would have had its new day's reminder refused as already sent.
- `drives.scheduleVersion` now counts reschedules.
- The reminder and the reschedule notice carry it, and the index includes
  it, so each version of the time gets its own reminder.
- An alert written for a version that has since changed is skipped.

#### A reschedule the candidate never heard about

A candidate without Telegram, or whose notice failed, may never learn a
drive moved. If they then miss it, they didn't fail to turn up to anything
they knew about, yet they were marked NO_SHOW and it counted in their
reliability.

Now an absence isn't held against them when the drive was moved after they
booked and the `drive_rescheduled` notice for its **final**
`scheduleVersion` was never SENT to them. Knowing about an earlier move
isn't knowing where the drive landed. The rule is one SQL fragment,
`absenceExcusedByReschedule` in `packages/db/src/reliability.ts`, used by
both the nightly reliability score and Your record, so the two can't
disagree. The absence stays recorded: Your record shows it as "marked as
not attending; this won't count against you" and says why.

#### The offline pass

A candidate with no signal can't be reached, so the pass doesn't pretend
to be current.
- **Offline, My drives leads with when it last synced**, day and time, in
  large type.
- **A drive that has been rescheduled carries a loud warning** that it may
  have moved again since that copy was saved.
- **Check-in's offline pass** shows the same.

### Messaging

Each application has one thread between the company and the candidate.
Either side starts it with a message once the application exists.

**The thread belongs to the company, not to a person.**
- Everyone at the company reads every thread, and each message names who
  sent it.
- Viewers read but can't send.
- There is one unread count for the whole company, with a note of who read
  last. Whoever is at the desk works the drive, as in "Teams".
- A recruiter can't hold a private conversation the owner can't see.

#### The delivery guarantee

- **Stored first.** A message is committed with its place in the thread
  before anyone is told. The in-app thread is the record: if it's in the
  thread, it was sent.
- **One order everyone sees.** Sending locks the thread's row to take the
  next sequence number. Two people sending at the same moment both succeed,
  one after the other, and every reader sees the same order. Order is by
  that number, never by timestamp.
- **Read markers are sequence numbers**, not times. Marking a thread read
  can never skip a message that committed a moment later.
- **Telegram gets at most one copy of each company message**, claimed the
  same way alerts are:
  - a PENDING delivery row is inserted before the send, and a partial
    unique index allows one per message;
  - a definite failure frees the claim, so the queue's retries can try
    again;
  - an unknown outcome (a timeout, a dropped connection) keeps the claim
    and dead-letters the job. It is never resent;
  - copies go on the alerts queue, so they share the bot's rate limit.
- **Nothing is lost between storing and queuing.** The copy is queued after
  the message commits, without waiting. If queuing fails, a 15-minute sweep
  re-queues company messages from the last 24 hours that have no delivery
  row, after a minute's grace so it doesn't race a normal queue.
- **Candidates' messages to the company aren't sent anywhere.** Employers
  have no Telegram; their console shows unread counts.

**What a company sees about delivery:**
- each of its messages shows how it reached the candidate: sent on
  Telegram, waiting, failed, or in the app only;
- the thread says whether the candidate has Telegram linked.

**A candidate without Telegram** sees messages only when they next open
Walkins. Nothing else reaches them: no SMS, no WhatsApp. The company is
told this on the thread, so it doesn't treat a message as a phone call.

#### When a thread stops taking messages

Read-only means nothing can be sent. The thread and everything in it stay
visible to both sides. The reasons are worked out on every read and send,
not by a job:
- **closed:** 30 days after the drive ends, for both sides. A reschedule
  that moves the end moves the close with it;
- **application closed:** the application was screened out or withdrawn,
  for both sides. A rejected application's thread stays open, since the
  employer may want to explain or offer another role;
- **company suspended** or **drive suspended:** the company can't send,
  but the candidate can;
- **view only:** a viewer can't send.

A thread can be read-only for several reasons at once. All of them are
reported, the permanent ones first, so a thread closed for 30 days and also
withdrawn says both.

#### The money-request detector is a tripwire, not a guard

**Messages are not screened.** `moneyRequestSignals` looks for the common
wording of a fee demand: a UPI handle, a bank account or IFSC, a payment
app, or a fee word next to an amount, in English, Hinglish and Devanagari.
It is easy to defeat. "send me 500 on the number you have" passes it
completely, and a test pins that down so nobody mistakes it for a screen.
It does catch फ़ीस however it is typed (with the nukta as its own mark, as
one precomposed letter, or without it) and an amount before the fee word
("500 रुपये फ़ीस"). Both missed the glossary's own spelling until Hindi
was written.

**The real protection is elsewhere:**
- the never-pay band at the foot of every thread and on every Telegram
  copy;
- the report action on every message.

The detector only decides when to shout. When it trips on a company's
message:
- **The message is delivered, never held**, with a warning in front of it
  in the app and on Telegram. Holding would punish the false positives, and
  salary talk near the word "deposit" trips it often enough to matter.
- **An automatic report** (no reporter: the queue shows "system") goes into
  the moderation queue.
- **The company's owners see it.** It is counted in the company's standing,
  and listed for owners until one marks it reviewed. A rogue recruiter is
  visible inside the company, not only to Walkins.

Only company messages are checked. A candidate asking "do I need to pay
the ₹500 registration fee?" is a warning about the employer, not a reason
to file a report against the candidate.

#### Other rules

- **Plain text** of up to 1,000 characters. No attachments, and links
  aren't made clickable in the app. Telegram's own apps make links in a
  copy clickable, and Walkins can't stop that.
- **Reporting:** either side can report a message from the other side
  (asks for money, abusive, something else). Reports go to the same
  moderation queue, grouped by thread. Admin actions on a thread reach its
  drive and company, and a warning goes to whichever side wrote what was
  reported.
- **Admins read a thread only once a message in it has been reported.**
  Each opening is an audit entry.
- **Rate limits:** 60 messages an hour per person and 300 per company on
  the company side, and 30 an hour per candidate.

### Hiring outcomes

What happens after a hire is a separate `hiring_outcomes` record, one per
HIRED application, not more application states. HIRED stays final, so
nothing counted as hired can fall out of the count by moving on. The record
holds three facts, each nullable, because unknown is the usual answer and a
real one:
- **joining date**;
- **started**, with the day;
- **still there 30 days after starting.**

Each fact keeps who recorded it and when, and every change is an audit
entry. The candidate's own answer to "did you start?" sits beside the
employer's, never in its place.

**Recording is asked for where the employer already is**, never as a gate:
- on the desk, as they hire, a joining date field appears beside the hire;
- the Outcomes page (`/employer/outcomes`), with a count in the nav of
  what is due;
- a prompt on the drives list, the new-drive page and a draft's page: the
  one moment an employer is certainly back weeks after a hire;
- the candidate is sent a `joining_check` on Telegram at 11:00, once, in
  the week after their joining date, and answers on My drives.

**Rules:**
- whether someone started can be recorded only on or after the joining
  date;
- whether they stayed can be recorded only 30 days after they started;
- either side may record or correct until 60 days after the joining date
  (or the hire, when no date was agreed). After that the record stays as
  it is;
- viewers read outcomes and record nothing.

#### Why outcomes don't feed reliability

It would be easy to count "didn't start" against a candidate. It isn't
counted, for these reasons:
- **The evidence is unequal.** A check-in is a scan at the venue. An
  outcome is the employer's word, and nothing checks it.
- **Not starting is often the right call.** The offer was withdrawn, the
  terms changed, or the "joining fee" turned out to be the scam the
  never-pay band warns about.
- **Scoring would depend on the employer.** Candidates hired by employers
  who record outcomes would be scored, and the rest wouldn't.
- **It would give employers a way to damage someone** that nobody could
  verify or answer.
- **Outcomes describe jobs, not people.** They belong in figures about
  roles and employers, which is where they are used.

### Your record

A candidate's profile has Your record (`GET /candidates/me/record`):
everything Walkins has recorded about the drives they applied to. It is its
own schema, `candidateRecordSchema`, so nothing else can travel in it.

**It shows** every drive applied to, with its state:
- came;
- checked in, awaiting the employer's confirmation;
- marked as not attending, with the day it was recorded, and whether it is
  held against them (see "A reschedule the candidate never heard about");
- released their seat;
- screened out;
- not taken forward;
- drive cancelled;
- drive paused.

After a hire it shows each fact the employer recorded, marked "from
{company}", next to the candidate's own answer.

**It never shows:**
- who reported them, or any report;
- employer notes or shortlists;
- match scores;
- anything about anyone else;
- a reliability number. Nothing uses one. If one is ever shown to anyone,
  the candidate sees it here first.

`apps/api/test/outcome-analytics.test.ts` checks the record's JSON for each
of these.

### Claims the data can't support

Some features could easily say more than Walkins knows. Each says only what
it can support, and a change that would make one claim more should have to
argue for it:
- **A transcript is a guess**, and is labelled as one (see "Transcripts
  are a guess, and the interface says so").
- **The money-request detector is a tripwire, not a guard** (see
  "Messaging"). Messages aren't screened, and the interface never implies
  they are.
- **"Attended after an alert", never "because of"** (see "Employer
  analytics"). The data shows order, not cause.
- **Outcomes are the employer's word.** They are shown with their
  coverage and who recorded them, and never score a person.

## Rate limits

**An address is not a person in India.** Carrier NAT puts thousands of
phones behind one IPv4 address, and every candidate at a venue shares its
Wi-Fi. A per-address limit therefore counts a whole city block or a whole
interview hall as one client. Here, per-address limits are a coarse ceiling
on a single abusive script and nothing more. The real limits are per user
or per company. **Do not tighten the per-address numbers.** A limit low
enough to slow one person down is low enough to lock out a venue. For the
same reason, anything a candidate touches is generous: the limits stop loops
and scripts, not people.

Every limit is in `apps/api/src/common/rate-limit.ts` (the `LIMITS` table),
with its reasoning beside it. A route opts in with `@RateLimit(...)`. A
route without the decorator gets the default rule, so an endpoint added
later is never unlimited by accident.

| Rule | Counted per | Limit | Why this number |
| --- | --- | --- | --- |
| default (no decorator) | user, else address | 600 / minute | Ceiling for anything not listed below |
| `public-read`: search, map, drive pages | address | 1200 / minute | A venue's or a NAT's worth of phones, a few requests each |
| `application`: book, withdraw | user | 30 / hour | A handful of seats, with room for retries on a bad signal |
| `voice-upload` | user | 20 / hour | Each take is up to 2 MB of storage |
| `drive-create` | user, and company | 20 / hour, and 100 / day | Desk work, never a burst |
| `drive-edit`, `profile-edit` | user | 60 / hour | Each save queues an embedding; a script looping here floods that queue |
| `applicant-actions` | user, and company | 30 / hour, and 150 / hour | A bulk "not selected" messages every booked candidate. Per person, because several recruiters work one drive; the company ceiling stops one script |
| `invitations` | company | 30 / day | A team is a handful of people |
| `top-up-order` | company | 10 / 10 minutes | Each order opens one at the payment gateway |
| `top-up-confirm` | company | 30 / 10 minutes | Each confirmation calls the gateway |
| `webhook` | address | 300 / minute | Public and unauthenticated; Razorpay's own retries stay far below it |
| `checkin-code` | drive | 10 / minute | The check-in screen asks for a code about once a minute |
| `intro-audio` | user | 300 / hour | Listening down a shortlist |
| `telegram-link` | user | 10 / hour | |
| `report`: reporting a drive, logged in or not | user, else address | 30 / hour | A venue's Wi-Fi may carry many honest reports of one scam; the real defences are in "Trust and safety" |
| `report-candidate` | user | 20 / day | |
| `message`: the company side | user, and company | 60 / hour, and 300 / hour | Each message can reach a phone |
| `message-candidate` | user | 30 / hour | |
| `report-message` | user | 30 / day | |
| `verification-upload`, `verification-submit` | company | 30 / hour, 10 / day | |
| OTP request | phone, and address | 3 / 15 minutes, and 100 / hour | The phone limit is the real one |
| Wrong check-in code | account, and address | 10, and 300 / 10 minutes | Per account is the real one; a 40-bit code stays unguessable under both |
| Board socket `join` | socket | 30 / minute | |

A refused request gets a 429 with a `Retry-After` header, and the body
carries a message saying how many minutes to wait.

The limiter is a sliding window in Redis. Each check and count is a single
Lua script, so concurrent requests can't all read "under the limit" before
any of them counts itself. Before this, the read and the write were
separate commands, so a parallel burst could get past the limit. A test now
fires 50 parallel requests at a limit of 10 and expects exactly 10 through.

### Why per-address limits never worked before

The browser never calls the API directly. Every request goes through the
Next.js `/api` proxy (see "Testing check-in on a phone"), and server-rendered
pages call the API from the Next server itself. The API therefore saw every
request coming from `::1`. Every per-address limit was one bucket shared by
all visitors. The OTP limit, then 10 an hour per address, was in effect 10
OTPs an hour for the whole site.

Two changes fixed it:
- The API sets Express's `trust proxy` to `loopback`, so it takes the client
  address from `X-Forwarded-For` only when the request comes from the local
  proxy.
- Server-rendered fetches (`apps/web/lib/server-search.ts`) pass the
  visitor's `X-Forwarded-For` on.

With both in place, `request.ip` is the visitor's address. The per-address
numbers were then raised to the ceilings above, because they now count
real addresses, which are shared.

### Production needs a proxy that overwrites X-Forwarded-For

Next's dev server keeps any `X-Forwarded-For` a client sends and appends to
it. That means a client can choose its own address, and with it which
per-address bucket it counts against. This is acceptable in development
only. In production, the web app must sit behind a reverse proxy (nginx, a
load balancer) that **replaces** `X-Forwarded-For` with the address it
actually saw, rather than appending to it. The per-user and per-company
limits don't depend on this. The per-address ceilings do.

### Webhook bodies

Razorpay webhook events are stored. A body whose signature checks out is
stored byte for byte. A body that fails the signature check is stored only
up to its first 2 KB, with its full length in `payment_events.rawBodyBytes`.
That is enough to diagnose a misconfigured secret, and it means anyone on
the internet can't fill the table with large bodies.

## Errors

Every refusal the API gives a person has the same shape:

```json
{ "code": "errors.drive.notFound", "message": "...", "params": { } }
```

- `code` is a key in the message catalog (below).
- `message` is that key's wording in the default locale, for clients that
  don't translate (curl, logs, a future partner).
- `params` holds the values the wording needs (a field name, a distance, a
  number of minutes).

Validation errors also carry `field`. A 429 also carries
`retryAfterSeconds`. Services build the body with `apiError(code, params)`
(`apps/api/src/common/api-error.ts`) and throw it in the usual Nest
exception.

Errors carry a code, rather than only text, for three reasons:
- The web app translates the code in the reader's language, not the
  server's.
- Code that reacts to a specific refusal compares a stable key. The venue
  pin's "far from the city" confirmation checks `errors.drive.pinFar`, not
  a sentence that a copy edit could change.
- Tests assert on what was refused, not on the wording.

The same goes for things the API and worker store or send on to be shown
later. Voice intro failures are stored as keys (`voice.failure.*`). Admin
go-live blockers, bulk-action skips and knockout answers travel as codes or
raw values, and the page words them.

Zod's own messages ("Expected number, received string") never reach a
person. A global error map in `packages/shared/src/validation.ts` gives every
issue a catalog key and the field's label. For example, "salaryMax must be
>= salaryMin" now reads: “Pay up to” is lower than “Pay from”. Set it to
the same amount or more.

Each message says what went wrong and what to do next, in the voice of the
check-in and venue-pin messages. A generic "Something went wrong" appears
only as the last fallback for a failure the page has no words for.

## Languages

English and Hindi. Hindi covers what a candidate meets: the public pages,
everything a candidate signs in to, the venue's screens, alerts and the
bot. The employer console and admin stay English. `HINDI_SCOPE` in
`packages/shared/src/i18n.ts` lists that by key prefix; where a namespace
mixes candidate and employer wording (the API's refusals, the board's drive
states), the candidate's keys are listed one by one, so an employer's
refusal doesn't hold Hindi back.

**Until `hi.json` covers all of it, nobody meets Hindi.** Not offering it
in the picker isn't enough, since a half-translated page can be reached
other ways. While it isn't offered (`OFFERED_LOCALES`):
- the picker and the header switch are hidden, and no `hreflang`
  alternates are given;
- a `/hi` address redirects to its English one, and a saved Hindi choice
  doesn't send anyone to `/hi`. `/hi/<path>` goes to `/<path>` even where
  that is a 404 (`/hi/jobs` to `/jobs`): the English address 404s the same
  way, so the redirect changes nothing but the language. Don't send it to
  `/` instead, which would turn a mistyped address into a different page;
- the API refuses to save `hi` (`setLocaleSchema`);
- a Hindi choice already in `users.locale` is served as English
  (`servedLocale`): the session's cookie, alerts and their links, and the
  bot's replies;
- the bot answers a chat it can't place in English only.

The gate lifts itself when the last key lands: there is no flag to forget.
`WALKINS_OFFER_HINDI=1` in `.env` lifts it early on one machine, to look at
a partial catalog. It is off unless set, so a developer sees the gated path
by default, and it is never set in production. The gate is read once, when
each app starts. The tests of the gate's rules take both states directly;
the API and worker tests that follow a saved choice through follow whichever
state the run started in, so run `pnpm test` with the variable set as well.

**One catalog per language.** All English wording lives in
`packages/shared/src/messages/en.json`, and Hindi in `hi.json` beside it.
The web app, the API's error messages and the worker's Telegram alerts all
read them. Nothing user-facing is written anywhere else. A key `hi.json`
doesn't have reads in English, which is how the employer console stays
whole.

**Web: `next-intl`.** It works with the App Router's server components and
`generateMetadata`. Messages are typed against the catalog through
`AppConfig` (`apps/web/i18n/global.d.ts`), so a misspelt key is a type
error. `apps/web/i18n/request.ts` takes the locale from the address, as
the middleware reports it (see "Addresses and the saved language").

**API and worker: `intl-messageformat` 10.** The obvious choice would have
been `use-intl`, the formatter under `next-intl`. Version 4 is ESM-only,
and so is `intl-messageformat` 11. The API and worker are CommonJS on Node
20, and neither can load them. Version 10 reads the same ICU message syntax
and runs in both. `translate()` in `packages/shared/src/i18n.ts` wraps it.

**Formatting follows the same locale.** Dates, times, money, distances and
seat counts come from `formatFor(locale)` in `packages/shared/src/format.ts`.
The numbers come from `Intl`, and the words around them ("Today", "2–4
yrs") come from the catalog. Language and script names come from
`Intl.DisplayNames`, so they translate themselves. The web app uses
`useFormat()`, and the worker `formatFor(the candidate's locale)`. The API
words its refusals in English for any client that isn't the web app; the
web app words them itself, from their codes, in the page's language.

**Alerts and the bot speak the candidate's language.** The worker reads
`users.locale` when it sends, not when the alert was queued, and builds
every link for that language: a Hindi reader's Telegram link opens the
`/hi` page, which matters most with no signal, when nothing can redirect
them. The bot answers a linked chat in its candidate's language, and a
chat it can't place yet in Hindi above English.

**Public pages set their own metadata.** The home page, city and role
search pages, and drive pages have their own titles and descriptions.
Descriptions use absolute dates, because a search result outlives "today".
`<html lang>` follows the locale, and once Hindi is offered each public
page lists its other language's address as an `hreflang` alternate.

### Addresses and the saved language

**The language is on the person, `users.locale`, not the candidate
profile.** Someone chooses their language before they have a profile to
save, and an employer will choose one later too. Don't move it onto
`candidates`.

**The address decides what a page says.** `/hi/jobs/pune` is Hindi and
`/jobs/pune` is English, for a crawler and a phone alike: `middleware.ts`
serves both from the same page and tells it which language it is in. It
never reads `Accept-Language`. Pages that exist only in English redirect
from their `/hi` address.

**Redirects go from English to Hindi, never back,** once Hindi is offered
(before that, see "Languages"). A reader who saved Hindi is sent from an
English address to its Hindi one. A reader who saved
English is never sent from a Hindi address to an English one. That is
what keeps a shared `/hi` link working: a Hindi reader can forward a link
to a friend, or an employer can paste one into a message, and it opens in
the language it was sent in, whatever the person opening it saved. A
redirect back would make what a link says depend on who clicks it.

**The database wins over the cookie.** The middleware can't read the
database, so it reads a `locale` cookie: a copy of `users.locale`. The two
can disagree, most often when someone switches language on another
device. They are kept from drifting by who writes the cookie:
- only the API writes it, never the browser's code, and only with the
  value it has just read from or saved to `users.locale`;
- it is written at sign-in, at every session refresh (each page load and
  every 15 minutes), and when a choice is saved;
- signing out clears it.

So a stale copy lasts at most until that device's next refresh, and
overwrites nothing. Whichever value was written last never matters: the
database's value always reaches the cookie, and the cookie never reaches
the database. The API test "follows the database, not the last cookie
written" pins this down.

**Switching language** saves the choice first for a signed-in candidate,
then reloads the same page at its other address. A full reload, because
both addresses share the root layout, and a client-side navigation would
keep the old language's `<html lang>` and catalog.

### The check

`apps/web/test/i18n.test.ts` runs with the rest of `pnpm test`. It covers
the web app thoroughly and the API and worker partly. Both parts are
described below.

**The web app.** The check parses every file under `apps/web/app`,
`components` and `lib` with the TypeScript compiler and fails on:

- **Hardcoded wording:** text in JSX, user-facing attributes (`placeholder`,
  `aria-label`, `title`, `alt`, `label` and similar), strings passed to
  `setError`, `setNotice`, `confirm`, `alert` or `prompt`, and phrases kept
  in lookup tables (`{ CONFIRMED: "Booked" }`). Keys, class lists and CSS
  values don't count.
- **Formatting that bypasses the locale:** importing `formatTime` and the
  other bare formatters into the web app instead of using `useFormat()`.
- **A key the catalog doesn't have.**
- **A catalog key nothing uses.** The server-only namespaces (`errors`,
  `alerts`, `bot`, `fields`, `format`) are exempt.
- **A phrase written into the worker's alert templates** rather than the
  catalog.
- **A Hindi key English doesn't have,** or a Hindi string whose arguments,
  tags or select cases differ from its English. A translation that drops
  `{link}` fails, and so does one that adds a gender `select`. Plural
  categories may differ, since Hindi's differ.

**The API and worker.** The check covers the places where they speak to a
person directly:
- an HTTP refusal (`new ...Exception(...)`), whose body must come from
  `apiError`;
- a live socket's `{ error }` reply;
- a Telegram message (`ctx.reply`, `sendMessage`).

A phrase anywhere inside one of these fails, however it is built.
Phase 8's web-only check had missed two leaks this way: the live gateway's
`"Unknown view"`, and every reply the Telegram bot sends. Both now come from
the catalog, and the bot's wording is under `bot.*`.

What the check does **not** cover on the server:
- **Words built in one place and sent from another.** The check sees a
  phrase only inside one of the calls above. Text assigned to a variable
  first and passed in later goes unseen.
- **Words stored to show later.** Syntax can't tell these from internal
  text. They are:
  - a payment's `failureReason`, as the gateway sent it;
  - the notes admins write on verification decisions and warnings, which
    are their own words to the company, in whatever language they wrote.
  These are listed under the Hindi phase's known work below. The
  verification provider's verdict and the reasons for rejecting a company
  became codes in Phase 10, and a check-in's flags in Phase 13 (below), so
  they are worded from the catalog.
- **Log lines, job outcomes and embedding input.** These are for operators
  and the model, not people, and stay in English on purpose.

There are three escape hatches, each visible in review:
- `/design` is exempt as a whole. It is the design system's specimen page,
  and its text is sample content, not product.
- `data-i18n-ignore` on a JSX element exempts its subtree, for content that
  is data.
- An `i18n-ignore` comment on a line exempts that line, and should say why.

Why a check-in was held for the employer is stored as codes in
`check_ins.flags`, never as wording:
- `LOW_GPS_ACCURACY`: the reading was worse than ±100 m. Its values are the
  check-in's `accuracyMeters` and `distanceMeters`.
- `SYNCED_AFTER_EXPIRY`: an offline scan reached the server after its code
  expired. Its value is `lateBySeconds`.

The codes are data. Rewording a flag is a catalog change
(`format.checkInFlags`); renaming a code needs a migration of the stored
rows. `formatFlags()` words them in the reader's language for the
candidate's check-in result and the employer's arrivals desk, and it is
keyed by every code, so a new code doesn't compile without wording. The
audit entry for confirming a flag records the codes too.

Each flag is a sentence of its own, shown on its own line: never joined to
another flag or built into a longer sentence, so a translation is one
complete sentence per flag. The desk shows them under the time line
("Scanned at 15:25"), so no flag starts with "Scanned".

Until Phase 13 this was an English sentence in `flagReason`, several flags
joined by "; ". The migration (`20261031100000_check_in_flags`) converted
each sentence to its codes. The accuracy and distance in the text were the
columns rounded, so nothing was lost. The lateness had been kept only as
whole minutes, so it became minutes × 60, which words the same again. It
converted the audit log's copies the same way. It refuses to run, before
changing anything, if any sentence isn't one of the two shapes the
check-in service wrote.

A count before a noun always goes through a plural (`{count, plural, one
{# seat} other {# seats}}`), even where the number is never 1 in practice,
so every count has the same shape for a translator. "All 1 seats taken"
came from a bare `{capacity} seats`. A test in `apps/web/test/i18n.test.ts`
fails on a bare count before seat, slot, candidate, person or yr.

### Hindi: register and glossary

Status: read by a native speaker on 30 October 2026 and accepted as
written. The safety strings built from the fixed phrases below still get
their own reading once they exist.

**The register: everyday Hindi, with English loanwords in Devanagari.**
Write what a jobseeker in a tier-2 city says, not what a government form
says. Where people say the English word, write it in Devanagari: ड्राइव,
स्लॉट, चेक-इन, बुकिंग, लोकेशन. OTP and QR stay in Latin, as on the
reader's own phone. Sanskritised vocabulary (पंजीकरण, अभ्यर्थी, सत्यापन,
आरक्षित, स्थल) is correct and wrong here: it rebuilds, in Devanagari, the
barrier the Hindi interface exists to remove. This is the decision every
other choice below follows from. Don't drift from it string by string.

**Never ask, or assume, the reader's gender.** Hindi verbs agree with the
subject's gender in many tenses: "you came" is आप आए or आप आईं. English
never made Walkins ask a candidate's gender, and Hindi must not become the
reason it starts. Don't "fix" an awkward sentence by adding a gender
field or a gender `select`. The placeholder-parity test fails on any
argument the English string doesn't have. Phrase around it instead:
- **Make a noun the subject.** आपकी बुकिंग हो गई, not आप बुक हो गए.
- **Use a transitive past tense with ने.** The verb then agrees with the
  object, not the reader: आपने सीट छोड़ दी, आपने काम शुरू किया.
- **Imperatives and the subjunctive are neutral.** करें, जाएँ, चुनें.
- **Use an impersonal passive.** आपको गैरहाज़िर दर्ज किया गया.
- **Avoid** आप with an intransitive verb in the progressive, habitual or
  future (आप आ रहे हैं, आप जाएँगे), and adjectives that inflect (अच्छा,
  अच्छी). Invariant ones are fine: हाज़िर, गैरहाज़िर, रद्द, तैयार.

**Other rules:**
- **आप throughout,** never तुम or तू.
- **Instructions and buttons use the -एँ form:** सेव करें, सीट बुक करें.
- **Sentences end with ।**
- **Nukta on ज़ and फ़ only** (प्रोफ़ाइल, फ़ीस, ज़रूरी), not on क़ ख़ ग़,
  which everyday writing drops (गैरहाज़िर, तारीख).
- **Digits stay Latin (0–9),** as the formatter gives them for `hi-IN`.
  Times are on the 24-hour clock (14:30), as in English.
- **Units stay Latin:** km and m. The formatter's कि॰मी॰ is overridden.
- **Dates use the long weekday and month** (शुक्रवार, 30 अक्तूबर), never
  the formatter's abbreviations (शुक्र, अक्तू॰). Month and day names are
  never written into the catalog: they come from the formatter, so their
  spelling stays consistent.
- **कल means both yesterday and tomorrow,** so in Hindi it never appears
  without the date beside it. The formatter names tomorrow by its date in
  Hindi ("शनिवार, 31 अक्तूबर") where English says "Tomorrow"; `format.tomorrow`
  has Hindi only so the catalog is complete.
- **Hindi's "one" plural form covers 0 as well as 1.** A count that can be
  zero needs an explicit `=0` case.
- **Placeholders move with Hindi word order.** "{role} at {company}"
  becomes "{company} में {role}". Employer content stays as typed, and
  Hindi postpositions follow it whatever its script.
- **Names the reader sees in Latin on their phone stay in Latin:**
  Walkins, Telegram, Chrome, Safari, iPhone, WebGL, OTP, QR, UPI, AI.

**Each loanword's gender is fixed here**, because every verb and
adjective agreeing with it depends on it. Gender is m (masculine), f
(feminine), or "–" where nothing agrees with the word.

| English | Hindi | Gender | Note |
| --- | --- | --- | --- |
| Walkins | Walkins | m | Brand, Latin. "Walkins ... करता है" |
| walk-in interview | वॉक-इन इंटरव्यू | m | |
| walk-in (a person without a booking) | वॉक-इन | m | Also the board's slot label |
| drive | ड्राइव | f | ड्राइव रद्द हो गई. Not अभियान, which means campaign |
| interview | इंटरव्यू | m | |
| employer | कंपनी | f | What a jobseeker calls them. Not नियोक्ता |
| the employer at the desk | डेस्क पर कंपनी का स्टाफ़ | m | A person, not the company |
| candidates (third person) | नौकरी ढूँढने वाले | m pl | Better still, rephrase to आप. Not अभ्यर्थी |
| job | नौकरी | f | |
| role (kind of work) | काम | m | "Roles you'd walk in for": किन कामों के लिए |
| pay | सैलरी | f | Not वेतन |
| experience | अनुभव | m | Everyday enough; एक्सपीरियंस reads as English |
| seat | सीट | f | |
| slot | स्लॉट | m | |
| book (a slot) | बुक करना | – | स्लॉट बुक करें |
| booking | बुकिंग | f | आपकी बुकिंग हो गई |
| Booked (status) | बुक है | – | |
| release my seat | अपनी सीट छोड़ें | – | Not मुक्त करें |
| Seat released (status) | सीट छोड़ दी | – | Agrees with सीट, not the reader |
| check in (verb) | चेक-इन करना | – | |
| check-in (noun) | चेक-इन | m | आपका चेक-इन हो गया |
| checked in, waiting for the employer to confirm | चेक-इन हुआ, कंपनी की पुष्टि बाकी है | – | पुष्टि is common enough to keep |
| venue | इंटरव्यू की जगह | f | Labels: जगह. Not स्थल |
| address | पता | m | |
| screening questions | बुकिंग से पहले के सवाल | m pl | Described, not named |
| requirement | ज़रूरी शर्त | f | "It asks for": इसके लिए ज़रूरी है |
| not a match (screened out) | इस ड्राइव की ज़रूरी शर्त पूरी नहीं होती | – | About the requirement, never the person |
| application | आवेदन | m | Known from every form. Verb: अप्लाई करना |
| hired / selected | सिलेक्शन हो गया | m | What people say. Not चयन, not चुने गए (gendered) |
| not selected / not taken forward | सिलेक्शन नहीं हुआ / आवेदन आगे नहीं बढ़ाया | – | |
| attended | हाज़िरी दर्ज हुई | f | Not आप आए |
| marked absent | गैरहाज़िर दर्ज किया गया | – | Known from school registers |
| paused (suspended) | रोकी गई | – | Everywhere, the board's status label and alert prefixes included: Walkins paused it, and रुकी हुई reads as if it stopped. Agrees with ड्राइव: ड्राइव अभी रोकी गई है |
| cancelled | रद्द | – | Invariant: ड्राइव रद्द हो गई |
| moved (rescheduled) | समय बदल गया | – | ड्राइव का समय बदल गया है |
| Was / Now | पहले / अब | – | |
| report (noun) | रिपोर्ट | f | |
| report (verb) | रिपोर्ट करें | – | इस ड्राइव की रिपोर्ट करें |
| money | पैसे | m pl | |
| fee | फ़ीस | f | रजिस्ट्रेशन फ़ीस |
| training, uniform, document, job letter | ट्रेनिंग, यूनिफ़ॉर्म, डॉक्यूमेंट, जॉइनिंग लेटर | – | The never-pay list |
| profile | प्रोफ़ाइल | f | |
| home | घर | m | |
| travel distance | आने-जाने की दूरी | f | A noun, so no verb agrees with the reader |
| city centre | शहर के बीच | – | Not शहर का केंद्र |
| voice intro | वॉइस इंट्रो | m | Verb: अपने बारे में बोलकर रिकॉर्ड करें |
| record / recording | रिकॉर्ड करें / रिकॉर्डिंग | f | |
| automatic transcript | अपने-आप लिखा गया टेक्स्ट | m | |
| CV | बायोडाटा | m | What entry-level jobseekers call it |
| alert | मैसेज | m | An alert reaches people as a message |
| reminder | रिमाइंडर | m | |
| message | मैसेज | m | |
| conversation | बातचीत | f | |
| Telegram | Telegram | m | Latin. Telegram जोड़ें, Telegram जुड़ गया |
| link | लिंक | m | |
| login code | OTP | m | Latin |
| check-in code | कोड | m | QR कोड, with QR in Latin |
| scan | स्कैन करें | – | |
| location | लोकेशन | f | लोकेशन चालू करें |
| signal | नेटवर्क | m | What people say: नेटवर्क नहीं आ रहा |
| offline | ऑफ़लाइन | – | |
| last synced | आखिरी बार अपडेट हुआ | – | Always with the day and time |
| save / saved | सेव करें / सेव हो गया | – | |
| log in / log out | लॉग इन करें / लॉग आउट करें | – | |
| phone number | मोबाइल नंबर | m | |
| try again | फिर से कोशिश करें | – | |
| Cancel (a dialog) | रहने दें | – | Never रद्द, which is reserved for a drive being called off |
| Not now | अभी नहीं | – | |
| joining date | जॉइनिंग की तारीख | f | |
| started (the job) | काम शुरू किया | – | Transitive with ने, so the verb agrees with काम, not the reader |
| still there after 30 days | 30 दिन बाद भी काम पर हैं | – | हैं doesn't mark gender |
| Your record | आपका रिकॉर्ड | m | |
| Arrivals (venue board) | आगमन | m | A formal word, kept on purpose: every Indian station board uses it, and the board is a station board |
| Live / Filling up / Closing today / Ended | लाइव / भर रही है / आज बंद / खत्म | – | Agrees with ड्राइव |
| starts in / doors close in | शुरू होने में / बंद होने में | – | Countdown labels |

**Fixed phrases.** These recur in the safety strings, so each is
written once, here, and reused word for word. A native reading of these
covers most of the critical tier's meaning:

| English | Hindi |
| --- | --- |
| Walkins never charges candidates. | Walkins नौकरी ढूँढने वालों से कभी पैसे नहीं लेता। |
| No employer should ask you for money. | किसी भी कंपनी को आपसे पैसे नहीं माँगने चाहिए। |
| If anyone does, don't pay. | अगर कोई माँगे, तो पैसे बिल्कुल न दें। |
| Report it. | इसकी रिपोर्ट करें। |
| You haven't done anything wrong. | आपकी कोई गलती नहीं है। |
| Please don't travel to it. | कृपया वहाँ न जाएँ। |
| This won't count against you. | इसे आपके खिलाफ़ नहीं गिना जाएगा। |
| Your booking is still held. | आपकी बुकिंग अब भी बनी हुई है। |
| This message seems to ask for money. | लगता है यह मैसेज पैसे माँग रहा है। |

**The safety strings are a manifest, `SAFETY_KEYS`** in
`packages/shared/src/i18n.ts`. A key is in it if it tells the reader not to
pay or that Walkins never charges, is part of reporting, tells them their
account or check-in was questioned, tells them whether to travel (a drive
paused, cancelled or moved, an application turned down), or promises
something won't count against them. 62 keys, in five groups. Tests hold
the set together (`apps/web/test/i18n.test.ts`, "safety wording in
Hindi"):
- every key in it is in `HINDI_SCOPE` and has Hindi;
- every in-scope English string with the wording of one of those things
  ("never charges", "don't pay", "don't travel", "report", ...) is in it.
  A new one fails until it joins.

Status: written 30 October 2026, not yet read by a native speaker. Where
a string departs from a fixed phrase above (a fragment of one, or a word
added), that is a choice for the reading to confirm, not settled.

**Each Hindi string records the English it was made from**, in
`hi.source.json` beside `hi.json`. A test fails when the two differ: the
English changed, so the Hindi says the old thing. Translate it again, put
the new English in `hi.source.json`, and have a safety string re-read.
Updating `hi.source.json` alone silences the test; that is the step review
should look for.

**Plurals.** Wherever English has a plural, Hindi has one with English's
`one`, `other` and `=n` cases, and its `one` and `other` say different
things. Hindi's "one" covers 0 and 1. Some nouns really don't change
(मिनट, दिन, साल): a key using one is listed in the test with its reason,
and the list fails if a listed key's branches stop being the same.

**Digits and kept words.** Numbers are Latin digits, and a test fails on
०–९. Walkins, Telegram, OTP, QR, UPI and bot commands (`/start`) appear in
the Hindi exactly as in the English.

**The language picker** says exactly what review happened. Once the
glossary and the safety strings have had their native reading, and not
before, it reads:
- English: "Hindi written with AI help. The glossary and safety wording
  were checked by a person; the rest hasn't been yet."
- Hindi: "हिंदी AI की मदद से लिखी गई है। शब्दावली और सुरक्षा से जुड़ी
  बातें एक व्यक्ति ने जाँची हैं, बाकी अभी नहीं।"

If the review covers more later, the picker says more. Until the reading
has happened, it says only "Hindi written with AI help; not yet checked
by a person."

### Devanagari on the board

**The face: Anek Devanagari, beside Archivo.** It is the one Devanagari
face with Archivo's width range (75% to 125%), so the scale's expanded,
standard and narrow steps carry over rather than collapsing into weight
alone. Looked at on `/design`, which now sets every step in Hindi under
the English:
- **Headings and reading text read as one system.** At 125% both are
  wide, flat-sided and low-contrast, and they carry the same colour at
  700 and 800. In one line, the Devanagari headline sits at about
  Archivo's x-height, so neither looks smaller.
- **The narrow step only matched on paper.** At 75%, Devanagari closes
  up its counters and stacks its marks long before Latin figures do. At
  the board's small sizes (seats left, at 14px) it read as smaller and
  heavier than the Archivo figures beside it. The narrow step is served
  at width 90 for Devanagari, while its descriptor stays 75%, so the
  figures in the same line stay narrow.

**Served from the app, not Google's CDN.** `apps/web/public/fonts` holds
seven static instances, one per width and weight the scale uses, cut with
fontTools from the Google Fonts release and subset to Devanagari. They
are about 90 KB each, with the OFL licence beside them. The variable font
was 660 KB even when subset, nearly all of it variation data. Each face
has a Devanagari `unicode-range`, so an English page fetches nothing until
it shows a Devanagari name, and then only the one instance it draws. The
service worker caches them with the offline pass.

**Leading and tracking.** Under `:lang(hi)`, every type step gets more
leading: display 1.05 becomes 1.3, and body 1.5 becomes 1.75. That makes
room for the marks above the headline (ि ी ँ) and below the baseline
(ु ू ृ). Tracking is zero. Codes typed character by character (check-in,
OTP) are Latin and keep theirs.

**Flaps.**
- **The clipping bug, live on the English board before this phase.** Each
  half of a flap cell used `overflow: hidden`, which cut all four sides.
  That took off what Devanagari puts outside a cell sized for Latin
  capitals: the ु under ह्र and the ू hook under सू were sheared flat
  along the cell's bottom edge. Each half is now cut only at the hinge
  (`clip-path`), and those marks stand proud of the flap.
- **A Devanagari word is one flap, not one per letter.** A Latin letter
  is a shape of its own. Devanagari letters join along the headline and
  vary widely in width, so splitting a word into equal cells broke it at
  every gap. The flap spans whole cells: at least one per letter, more
  once measured, since a conjunct like ष्ण is one letter and two cells
  wide. The padding gives the extra cells back, so a name row stays 16
  cells and the board's columns line up. Latin text is unchanged.
- **The cell counts stay.** With words spanning cells, 16 cells for a
  name and 5 for a time hold in either script. The board's labels
  ("Walk-in") are sized when the Hindi wording lands.

**Initials.** The board shortens "सुप्रिया क्षत्रिय" to "सुप्रिया क्ष.". It
used to take the surname's first code unit, which gave a bare "क" for the
conjunct क्ष. It now takes the first letter as a reader sees it.

### Known work for the Hindi phase

These were found while building the scaffolding and are not fixed yet.

- **Stored English.** Decline reasons from the payment gateway are stored as
  the gateway sends them, and admins' notes on decisions and warnings are
  their own words.
- **The plural guard reads English only.** The test that fails on a bare
  count before a noun (see "Languages") matches English words: seat, slot,
  candidate, person, yr. It never looks at Hindi. A Hindi string that drops
  the plural English has is still caught, by the check that each argument
  keeps its kind, and a Hindi plural whose `one` and `other` say the same
  is caught too (see "Plurals" above). What nothing catches is a Hindi
  plural that differs but is still wrong, or a count English leaves bare
  that Hindi needs to agree with.
- **Language names come from each runtime's ICU data.** Node 20 names `or`
  "Odia", and older ICU data says "Oriya". The server render and the browser
  can disagree. Check the names when they are shown in Hindi, and override
  any that differ in the catalog.

## Prerequisites

- Node.js 20 or later
- pnpm 9 or later (`corepack enable` if pnpm is not already installed)
- Docker and Docker Compose

## Setup

1. Copy the environment file and adjust values if needed (the defaults work
   for local development):

   ```
   cp .env.example .env
   ```

2. Install dependencies:

   ```
   pnpm install
   ```

3. Start Postgres, Redis, MinIO and the ML sidecar:

   ```
   pnpm docker:up
   ```

   Check `docker compose ps` until all containers report healthy. The first
   run builds two images: Postgres with pgvector added (about 190 MB on top
   of the PostGIS image), and the ML sidecar (about 700 MB). The sidecar then
   downloads its models into the `ml_models` volume, about 590 MB: Whisper
   small (464 MB) and the quantised embedding model with its tokenizer
   (122 MB). That takes a few minutes on a fast connection and is skipped
   on every later start. Jobs that reach the sidecar before it is ready are
   retried a few times. An intro that still can't be transcribed is shown as
   such (employers can still listen to it), and anything left without an
   embedding is ranked by distance until the worker next starts and fills
   it in. The sidecar idles at about 750 MB of memory, reaches about 1 GB
   while transcribing, and is capped at 1.5 GB.

4. Run database migrations:

   ```
   pnpm db:migrate
   ```

5. Seed reference data (cities, roles):

   ```
   pnpm db:seed
   ```

   Optional: to send real Telegram alerts, create a bot with @BotFather and set
   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` in `.env`. Without them
   the worker prints alerts to its console instead, and everything else runs.

6. Start web, api, and worker together:

   ```
   pnpm dev
   ```

   - web: http://localhost:3000
   - api: http://localhost:4000/health
   - MinIO console: http://localhost:9001

7. Optional: make an admin for `/admin`:

   ```
   pnpm admin:create <10-digit phone> <name>
   ```

   Top-ups use the mock payment gateway unless `PAYMENT_GATEWAY=razorpay` and
   the three `RAZORPAY_*` keys are set in `.env` (see "Wallet and top-ups").

## Stopping

```
pnpm docker:down
```

Data persists in named Docker volumes (`postgres_data`, `redis_data`,
`minio_data`, and `ml_models` for the downloaded models) until removed explicitly with `docker compose down -v`.

## Notes

- `drives.geom` and `candidates.geom` are PostGIS `geography(Point,4326)`
  columns managed outside the Prisma schema, since Prisma has no native
  PostGIS type. They are created in the raw-SQL migration at
  `packages/db/prisma/migrations/20260828000001_postgis` and kept in sync
  with the Float lat/lng columns by database triggers, so application code
  only ever needs to write the Float columns.
- Postgres runs from `docker/postgres`, the PostGIS 16 image with pgvector
  installed. That image is Debian bullseye, whose PostgreSQL apt repository
  has moved to apt-archive.postgresql.org, so the Dockerfile points there.
  The base image was kept, rather than moved to a newer Debian, because a
  different C library under an existing data volume can silently corrupt
  text indexes.
- `packages/shared` exists so `apps/web` never depends on `@walkins/db`,
  which keeps the Prisma client out of the frontend bundle.
- MapLibre locates its web worker from `import.meta.url`, which the Next.js
  bundler can't follow, so `apps/web` copies the worker files into
  `public/maplibre/` (gitignored) before every `dev` and `build`.

## Testing check-in on a phone

Check-in is meant to be tested with a real phone: a real camera reading the
QR on the laptop screen and a real GPS fix. Two things make that different
from ordinary local development.

**The browser never calls the API directly.** It calls `/api` on the web
app's own origin, and Next.js proxies that to the API (`API_INTERNAL_URL`,
default `http://localhost:4000`; see `apps/web/next.config.ts`). This is not
an optimisation. On the phone, `localhost` means the phone itself, so an API
address of `http://localhost:4000` points nowhere useful. And the page has to
be HTTPS for the camera and GPS, and an HTTPS page is not allowed to call a
plain-HTTP API. Proxying through the page's own origin removes both problems,
and the refresh cookie stays on that origin too.

**The camera and GPS only work over HTTPS** (or on `localhost`, which the
phone isn't). To serve the web app over HTTPS on your network:

1. Find the laptop's Wi-Fi address, e.g. `ipconfig getifaddr en0` on macOS,
   and set it in `.env`:

   ```
   LAN_HOST=192.168.1.20
   ```

2. Run `pnpm dev`. On the first run Next.js downloads mkcert, installs a local
   certificate authority on the laptop (this can ask for your password once)
   and writes a certificate for `localhost` and `LAN_HOST` to
   `apps/web/certificates/` (gitignored). The log prints where the authority's
   `rootCA.pem` lives: `CA Root certificate created in <folder>`.

3. Make the phone trust that authority, or it will refuse the certificate:
   - iPhone: AirDrop or email `rootCA.pem` to the phone and open it; install
     it under Settings > General > VPN & Device Management; then turn on full
     trust for it under Settings > General > About > Certificate Trust
     Settings.
   - Android: Settings > Security > Encryption & credentials > Install a
     certificate > CA certificate, and choose `rootCA.pem`.

4. With the phone on the same Wi-Fi, open `https://<LAN_HOST>:3000`. If it
   can't connect, the laptop's firewall may be blocking incoming connections
   to Node.

The laptop's address changes when it joins a different network. If the web
app fails to start with `EADDRNOTAVAIL`, `LAN_HOST` is an old address: run
`ipconfig getifaddr en0` again and update it.

The arrivals board's live connection goes through the same proxy, at
`/socket.io/`. In development the proxy may carry it as frequent HTTP
requests rather than a WebSocket, which works but is chattier.

That authority can sign a certificate for any site, and anyone with its key
can too, so remove it from the phone when you're done testing. Leave
`LAN_HOST` empty for ordinary development on `http://localhost:3000`.

The QR on the employer's screen is a link to `/checkin` with the code after
the `#`, so the phone's own camera app can open it directly; `/checkin` also
has a scanner for anyone who opens the page first.

## Development

DEV_EXPOSE_OTP=true with NODE_ENV=development returns the OTP in the API
response and logs it, so no SMS provider is needed locally. Both flags are
required.

To clear OTP rate limits while testing, delete the otp-request keys from
Redis with redis-cli.

API and worker tests (vitest) use the local Redis and their own Postgres
database, `TEST_DATABASE_URL`. Create it once, and again after any new
migration:

```
pnpm test:db
```

Then:

```
pnpm test
```

That runs the API, worker and web suites. The web suite needs no database:
it is the i18n check (see "Languages"). To run it alone while working on
pages:

```
pnpm --filter @walkins/web test
```

Tests never run against `DATABASE_URL`: each suite's `test/setup.ts` refuses
to start if `TEST_DATABASE_URL` is missing or the same. There are two reasons:
- The ledger is append-only, so every charge or top-up a test commits stays
  there forever.
- Tests call maintenance functions that act on whole tables.

The test database collects ledger rows from every run, which is expected.
Drop it and run `pnpm test:db` to start clean. Fixtures other than ledger
rows are created and removed by each test.

**Scope every maintenance function a test calls.** Test files run in
parallel against one test database. Any test that calls a maintenance
function (`markNoShows`, `purgeVoiceIntros`, `removeOrphanedRecordings`,
`sweepCharges` or anything else the nightly jobs run) must scope it to the
test's own rows, or give it fake storage. Unscoped, it acts on everything in
the database. Before tests had their own database, a test that ran the real
voice purge unscoped deleted the rows for two real recordings, which left
their audio in storage with nothing tracking it.

The same goes for lookups. A `findFirst` that matches on kind alone ("any
message report filed by the system") can return another file's row, and
which one depends on timing. Scope it to the fixture's own drive, company
or ids. Code that reads a whole table on purpose, like the moderation
queue, must also survive other files deleting rows while it reads: the
queue reads its reports and their reporters' history in one snapshot for
that reason.

**Known debt: test files are outside the typecheck.** The API and worker
`tsconfig.json` include only `src`, and vitest strips types without checking
them, so a type error in a test file fails nothing. That is how
`apps/api/test/errors.test.ts` and `apps/worker/test/charging.test.ts` have
carried type errors unnoticed. Check a test file by hand with a tsconfig that
also includes `test`.

To queue one drive's alerts by hand, and to list jobs that failed for good:

```
pnpm worker:fanout <driveId> [drive_48h | drive_morning_of]
pnpm worker:dlq
```

Seeded candidates have no Telegram chat linked, so even with a bot token set
the only accounts that can receive a real message are ones you link yourself
from the profile page.
