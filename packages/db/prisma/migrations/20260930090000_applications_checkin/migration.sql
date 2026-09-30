-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('SCAN', 'WALK_IN', 'MANUAL');

-- AlterEnum
ALTER TYPE "ApplicationState" ADD VALUE 'WITHDRAWN';

-- DropIndex
-- The (driveId, candidateId) unique index below leads with driveId, so it
-- serves every lookup this single-column index did.
DROP INDEX "applications_driveId_idx";

-- AlterTable
ALTER TABLE "drives" ADD COLUMN     "venuePinnedAt" TIMESTAMP(3);

-- AlterTable
-- "method" is NOT NULL with no default. Nothing has written check-ins before
-- this phase, so the table is empty; this fails loudly if that is ever untrue
-- rather than inventing a method for existing rows.
ALTER TABLE "check_ins" ADD COLUMN     "accuracyMeters" DOUBLE PRECISION,
ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "method" "CheckInMethod" NOT NULL,
ALTER COLUMN "lat" DROP NOT NULL,
ALTER COLUMN "lng" DROP NOT NULL,
ALTER COLUMN "distanceMeters" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "applications_driveId_candidateId_key" ON "applications"("driveId", "candidateId");

