-- On their own: Postgres can't use an enum value in the transaction that
-- adds it, and the next migration backfills with these.

-- AlterEnum
ALTER TYPE "DriveStatus" ADD VALUE 'SUSPENDED';

-- AlterEnum
ALTER TYPE "VerificationStatus" ADD VALUE 'UNSUBMITTED';
