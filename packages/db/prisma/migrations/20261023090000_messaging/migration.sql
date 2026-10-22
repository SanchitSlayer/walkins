-- CreateEnum
CREATE TYPE "MessageSide" AS ENUM ('COMPANY', 'CANDIDATE');

-- AlterEnum
ALTER TYPE "ReportTarget" ADD VALUE 'MESSAGE';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "messageId" TEXT;

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "messageId" TEXT;

-- CreateTable
CREATE TABLE "message_threads" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "companyReadSeq" INTEGER NOT NULL DEFAULT 0,
    "companyReadById" TEXT,
    "companyReadAt" TIMESTAMP(3),
    "candidateReadSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "side" "MessageSide" NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "moneyFlag" BOOLEAN NOT NULL DEFAULT false,
    "flagReviewedAt" TIMESTAMP(3),
    "flagReviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_threads_applicationId_key" ON "message_threads"("applicationId");

-- CreateIndex
CREATE INDEX "messages_createdAt_idx" ON "messages"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "messages_threadId_seq_key" ON "messages"("threadId", "seq");

-- CreateIndex
CREATE INDEX "notifications_messageId_idx" ON "notifications"("messageId");

-- CreateIndex
CREATE INDEX "reports_messageId_idx" ON "reports"("messageId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_companyReadById_fkey" FOREIGN KEY ("companyReadById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "message_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_flagReviewedById_fkey" FOREIGN KEY ("flagReviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Alerts are claimed per drive, candidate, template and schedule version;
-- a message's Telegram copy is claimed per message. The alert index leaves
-- message rows out, or every message after the first in a thread would
-- collide with it.
DROP INDEX "notifications_one_claim_per_alert";
CREATE UNIQUE INDEX "notifications_one_claim_per_alert"
  ON "notifications"("driveId", "candidateId", "templateKey", "scheduleVersion")
  WHERE "status" IN ('PENDING', 'SENT') AND "messageId" IS NULL;
CREATE UNIQUE INDEX "notifications_one_claim_per_message"
  ON "notifications"("messageId")
  WHERE "status" IN ('PENDING', 'SENT') AND "messageId" IS NOT NULL;
