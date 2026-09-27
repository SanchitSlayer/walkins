-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "reliability" DOUBLE PRECISION,
ADD COLUMN     "reliabilityUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "attempt" INTEGER NOT NULL,
    "jobId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_driveId_candidateId_idx" ON "notifications"("driveId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_telegramChatId_key" ON "candidates"("telegramChatId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "drives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one live claim per alert. An attempt inserts a PENDING row before
-- calling the provider and moves it to SENT or FAILED afterwards, so a FAILED
-- attempt frees the slot for a retry while a PENDING or SENT one blocks any
-- second send. Partial indexes are outside what Prisma's schema can express.
CREATE UNIQUE INDEX "notifications_one_claim_per_alert"
  ON "notifications"("driveId", "candidateId", "templateKey")
  WHERE "status" IN ('PENDING', 'SENT');
