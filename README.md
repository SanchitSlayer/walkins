# Walkins

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
  interview.

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
reach it. Confirming flagged check-ins, marking people present, and marking
them interviewed, hired or not selected all happen on the drive page, which
is the employer's own screen.

Check-in keeps working without signal. The service worker keeps the
candidate's pass and the check-in page available offline, and a scan made
with no signal is saved on the phone and sent as soon as there is signal,
within the 30 minutes the server accepts a late scan for (it is flagged for
the employer). The page sends it, never the service worker: sending from the
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
phone, and the login page sends admins to `/admin`. The panel has four pages:

- **Verification.** "Check" asks the verification provider and applies its
  answer; "reject" records the admin's own reason. Both go in the audit log.
  The provider is `MockVerificationProvider`, behind `IVerificationProvider`.
  It only checks that a GSTIN is present and well formed (a valid state code,
  then PAN, entity number and check character). It looks nothing up, and its
  answer says so. The seed adds three pending companies, one GSTIN of each
  kind it tells apart.
- **Drives.** Approving is how a drive goes live. It needs a verified company
  with at least one check-in's worth of credit, and every blocker is listed
  on the drive at once. Sending a drive back returns it to draft with the
  reason, which the employer sees on their drive page.
- **Failed jobs.** Every queue's dead-letter set: alerts, charges, voice,
  embeddings and maintenance. Each job has a "Retry" button with a
  confirmation. Retrying is safe: alerts claim a slot before sending, and
  charges and top-ups are keyed so a second run changes nothing.
- **Ledger.** Every account's balance, entries filterable by account or
  transaction, a line saying whether every transaction balances, and the price
  history with a form for a new price. A new price takes effect from now or
  later, never earlier.

#### Employer analytics

`/employer/analytics` reads two materialised views. The worker refreshes them
every 15 minutes from the existing maintenance schedule, using `CONCURRENTLY`
so they stay readable while refreshing. A busy dashboard never queries the
live tables check-in depends on. Per drive:

- **Alerted:** candidates sent the 48-hour alert.
- **Applied:** applied in any way other than walking in.
- **Booked:** ever booked a seat, taken from the audit log. A hired or absent
  candidate did book; their current state has forgotten it, and the
  append-only audit log has not.
- **Checked in:** booked candidates with a verified check-in. Walk-ins are
  counted apart, outside the funnel.
- **Hired.**
- **Show-up rate:** checked in divided by booked.

A second view counts verified check-ins and hires per day, by India's
calendar day, for the 30-day chart. The charts use two colours of their own,
`--chart-1` and `--chart-2`, validated for colour-blind separation and
contrast on the desk's dark surface. The state lamps stay reserved for state.

#### What is live and what is scaffolding

Parts of the data model existed before anything used them. This phase made
these live:

| In the schema | Before Phase 7 | Now |
| --- | --- | --- |
| `UserRole.ADMIN` | Nothing created or checked it | `pnpm admin:create`, and the `/admin` panel |
| `Company.verificationStatus` | Only the seed set it; nothing read it | Changed through the verification provider; approving a drive needs VERIFIED |
| `Company.gstin` | Stored, never read | Read by the verification provider |
| `DriveStatus.PENDING → LIVE` | Employers could submit, but nothing moved a drive live; seeded drives were simply created LIVE | Admin approval, after the verification and balance checks |

Still scaffolding after this phase:

- **Employer self sign-up.** Companies and employers come only from the seed.
  The verification queue is filled by seeded companies until employers can
  register themselves.
- **The verification provider** checks GSTIN format, not a registry.
- **`ApplicationState.INTERESTED`.** No transition leads into it, so no
  application can be in it. The transitions out of it, and the screens that
  handle it, are waiting for a "save for later" feature.
- **`Candidate.reliability`** is recomputed every night and shown nowhere.
- **`Notification.deliveredAt`** is never written: Telegram doesn't report
  delivery, and WhatsApp, which would, is not implemented.
- **Refunds and disputes.** Webhook events are stored, nothing more.

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

To queue one drive's alerts by hand, and to list jobs that failed for good:

```
pnpm worker:fanout <driveId> [drive_48h | drive_morning_of]
pnpm worker:dlq
```

Seeded candidates have no Telegram chat linked, so even with a bot token set
the only accounts that can receive a real message are ones you link yourself
from the profile page.
