-- AlterTable
ALTER TABLE "payment_events" ADD COLUMN     "rawBodyBytes" INTEGER NOT NULL DEFAULT 0;

-- Every row stored so far kept its whole body.
UPDATE "payment_events" SET "rawBodyBytes" = octet_length("rawBody");
