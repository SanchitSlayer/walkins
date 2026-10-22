-- AlterTable
ALTER TABLE "drives" ADD COLUMN     "scheduleVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "scheduleVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "drive_reschedules" (
    "id" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fromStartsAt" TIMESTAMP(3) NOT NULL,
    "fromEndsAt" TIMESTAMP(3) NOT NULL,
    "toStartsAt" TIMESTAMP(3) NOT NULL,
    "toEndsAt" TIMESTAMP(3) NOT NULL,
    "reseated" INTEGER NOT NULL DEFAULT 0,
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_reschedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drive_reschedules_driveId_version_key" ON "drive_reschedules"("driveId", "version");

-- AddForeignKey
ALTER TABLE "drive_reschedules" ADD CONSTRAINT "drive_reschedules_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "drives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_reschedules" ADD CONSTRAINT "drive_reschedules_byId_fkey" FOREIGN KEY ("byId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The one-claim index gains the schedule version: a drive moved to another
-- day needs its new morning-of reminder, which the old index would have
-- refused as already sent for the old day.
DROP INDEX "notifications_one_claim_per_alert";
CREATE UNIQUE INDEX "notifications_one_claim_per_alert"
  ON "notifications"("driveId", "candidateId", "templateKey", "scheduleVersion")
  WHERE "status" IN ('PENDING', 'SENT');
