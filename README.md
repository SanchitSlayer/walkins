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

3. Start Postgres, Redis, and MinIO:

   ```
   pnpm docker:up
   ```

   Check `docker compose ps` until all containers report healthy.

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

## Stopping

```
pnpm docker:down
```

Data persists in named Docker volumes (`postgres_data`, `redis_data`,
`minio_data`) until removed explicitly with `docker compose down -v`.

## Notes

- `drives.geom` and `candidates.geom` are PostGIS `geography(Point,4326)`
  columns managed outside the Prisma schema, since Prisma has no native
  PostGIS type. They are created in the raw-SQL migration at
  `packages/db/prisma/migrations/20260828000001_postgis` and kept in sync
  with the Float lat/lng columns by database triggers, so application code
  only ever needs to write the Float columns.
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

Worker tests (vitest) use the local Postgres and Redis, so start Docker first.
They create and remove their own fixtures and use a throwaway queue:

```
pnpm test
```

To queue one drive's alerts by hand, and to list jobs that failed for good:

```
pnpm worker:fanout <driveId> [drive_48h | drive_morning_of]
pnpm worker:dlq
```

Seeded candidates have no Telegram chat linked, so even with a bot token set
the only accounts that can receive a real message are ones you link yourself
from the profile page.
