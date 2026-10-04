-- pgvector for the 384-dimension embeddings below.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "VoiceIntroStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "ApplicationState" ADD VALUE 'SCREENED_OUT';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "readsLanguages" TEXT[] DEFAULT ARRAY['en', 'hi']::TEXT[];

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "embeddedAt" TIMESTAMP(3),
ADD COLUMN     "embedding" vector(384);

-- AlterTable
ALTER TABLE "drives" ADD COLUMN     "embeddedAt" TIMESTAMP(3),
ADD COLUMN     "embedding" vector(384),
ADD COLUMN     "knockoutQuestions" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "knockoutAnswers" JSONB,
ADD COLUMN     "screenedOutReason" TEXT,
ADD COLUMN     "shortlistedAt" TIMESTAMP(3),
ADD COLUMN     "shortlistedBy" TEXT;

-- CreateTable
CREATE TABLE "voice_intros" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "status" "VoiceIntroStatus" NOT NULL DEFAULT 'UPLOADED',
    "transcript" TEXT,
    "language" TEXT,
    "languageProbability" DOUBLE PRECISION,
    "durationSeconds" DOUBLE PRECISION,
    "avgLogprob" DOUBLE PRECISION,
    "noSpeechProb" DOUBLE PRECISION,
    "compressionRatio" DOUBLE PRECISION,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "replacedAt" TIMESTAMP(3),

    CONSTRAINT "voice_intros_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_intros_objectKey_key" ON "voice_intros"("objectKey");

-- CreateIndex
CREATE INDEX "voice_intros_candidateId_createdAt_idx" ON "voice_intros"("candidateId", "createdAt");

-- AddForeignKey
ALTER TABLE "voice_intros" ADD CONSTRAINT "voice_intros_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

