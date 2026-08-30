# Walkins

Walk-in interview platform. Runs entirely locally via Docker Compose. No paid
services, no API keys.

## Stack

- apps/web — Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui
- apps/api — NestJS 10
- apps/worker — Node + BullMQ
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

## Development

DEV_EXPOSE_OTP=true with NODE_ENV=development returns the OTP in the API
response and logs it, so no SMS provider is needed locally. Both flags are
required.

To clear OTP rate limits while testing, delete the otp-request keys from
Redis with redis-cli.
