-- The language each person reads Walkins in. Everyone starts in English,
-- which is what they have read until now.
CREATE TYPE "Locale" AS ENUM ('en', 'hi');

ALTER TABLE "users" ADD COLUMN "locale" "Locale" NOT NULL DEFAULT 'en';
