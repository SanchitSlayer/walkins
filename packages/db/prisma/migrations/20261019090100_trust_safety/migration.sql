-- CreateEnum
CREATE TYPE "SuspensionCause" AS ENUM ('DRIVE', 'COMPANY');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('AWAITING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationRejection" AS ENUM ('DOCUMENT_UNREADABLE', 'DETAILS_DONT_MATCH', 'GSTIN_INVALID', 'NOT_A_BUSINESS', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('DRIVE', 'CANDIDATE');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('ASKS_FOR_MONEY', 'NOT_A_REAL_JOB', 'MISLEADING_PAY', 'ABUSIVE', 'FAKE_PROFILE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportOutcome" AS ENUM ('DISMISSED', 'ACTIONED');

-- CreateEnum
CREATE TYPE "ModerationActionKind" AS ENUM ('DISMISS', 'WARN', 'SUSPEND_DRIVE', 'SUSPEND_COMPANY', 'LIFT_DRIVE', 'LIFT_COMPANY');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ALTER COLUMN "verificationStatus" SET DEFAULT 'UNSUBMITTED';

-- AlterTable
ALTER TABLE "drives" ADD COLUMN     "suspendedCause" "SuspensionCause",
ADD COLUMN     "suspendedFrom" "DriveStatus";

-- CreateTable
CREATE TABLE "verification_submissions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "submittedById" TEXT,
    "gstin" TEXT NOT NULL,
    "documentKeys" TEXT[],
    "status" "SubmissionStatus" NOT NULL DEFAULT 'AWAITING_REVIEW',
    "providerName" TEXT,
    "providerCode" TEXT,
    "providerParams" JSONB,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" "VerificationRejection",
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "targetType" "ReportTarget" NOT NULL,
    "driveId" TEXT,
    "candidateId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "reporterUserId" TEXT,
    "reporterNetwork" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "outcome" "ReportOutcome",
    "actionId" TEXT,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" TEXT NOT NULL,
    "kind" "ModerationActionKind" NOT NULL,
    "adminId" TEXT NOT NULL,
    "driveId" TEXT,
    "companyId" TEXT,
    "candidateId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warnings" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "companyId" TEXT,
    "candidateId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,

    CONSTRAINT "warnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_submissions_companyId_createdAt_idx" ON "verification_submissions"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "verification_submissions_status_idx" ON "verification_submissions"("status");

-- CreateIndex
CREATE INDEX "reports_driveId_createdAt_idx" ON "reports"("driveId", "createdAt");

-- CreateIndex
CREATE INDEX "reports_candidateId_createdAt_idx" ON "reports"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "reports_reporterUserId_idx" ON "reports"("reporterUserId");

-- CreateIndex
CREATE INDEX "reports_reporterNetwork_idx" ON "reports"("reporterNetwork");

-- CreateIndex
CREATE INDEX "moderation_actions_createdAt_idx" ON "moderation_actions"("createdAt");

-- CreateIndex
CREATE INDEX "warnings_companyId_idx" ON "warnings"("companyId");

-- CreateIndex
CREATE INDEX "warnings_candidateId_idx" ON "warnings"("candidateId");

-- AddForeignKey
ALTER TABLE "verification_submissions" ADD CONSTRAINT "verification_submissions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_submissions" ADD CONSTRAINT "verification_submissions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_submissions" ADD CONSTRAINT "verification_submissions_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "drives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "moderation_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "drives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "moderation_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Until now a company was verified on its GSTIN alone. A pending company with
-- one becomes a submission awaiting review, so the queue stays real; one
-- without has nothing to review and has not submitted.
INSERT INTO "verification_submissions" ("id", "companyId", "gstin", "documentKeys", "status", "createdAt")
SELECT gen_random_uuid()::text, id, gstin, '{}', 'AWAITING_REVIEW', "createdAt"
FROM "companies" WHERE "verificationStatus" = 'PENDING' AND gstin IS NOT NULL;

UPDATE "companies" SET "verificationStatus" = 'UNSUBMITTED' WHERE "verificationStatus" = 'PENDING' AND gstin IS NULL;
