-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('OWNER', 'RECRUITER', 'VIEWER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "companyRole" "CompanyRole";

-- Until now a company was one login. Its contact phone's user owns it; where
-- no user has that phone, its longest-standing employer does. Everyone else
-- at a company recruits.
UPDATE "users" u SET "companyRole" = 'OWNER'
FROM "companies" c
WHERE u."companyId" = c.id AND u.phone = c."contactPhone";

UPDATE "users" u SET "companyRole" = 'OWNER'
WHERE u.id IN (
  SELECT DISTINCT ON ("companyId") id FROM "users"
  WHERE "companyId" IS NOT NULL
    AND "companyId" NOT IN (SELECT "companyId" FROM "users" WHERE "companyRole" = 'OWNER')
  ORDER BY "companyId", "createdAt", id
);

UPDATE "users" SET "companyRole" = 'RECRUITER' WHERE "companyId" IS NOT NULL AND "companyRole" IS NULL;

-- An employer with no company could open the console but do nothing in it.
-- With no company to give them a role in, they go back to being candidates.
UPDATE "users" SET role = 'CANDIDATE' WHERE role = 'EMPLOYER' AND "companyId" IS NULL;

ALTER TABLE "users" ADD CONSTRAINT "users_company_role_pair"
  CHECK (("companyId" IS NULL) = ("companyRole" IS NULL));

-- AlterTable
ALTER TABLE "drives" ADD COLUMN     "ownerId" TEXT;

-- Who created each existing drive was never recorded, so each goes to its
-- company's owner rather than to a guess.
UPDATE "drives" d SET "ownerId" = u.id
FROM "users" u
WHERE u."companyId" = d."companyId" AND u."companyRole" = 'OWNER';

ALTER TABLE "drives" ALTER COLUMN "ownerId" SET NOT NULL;

-- AlterTable: the shortlister was an untyped string; keep only values that
-- name a real user.
ALTER TABLE "applications" ADD COLUMN     "shortlistedById" TEXT;
UPDATE "applications" SET "shortlistedById" = "shortlistedBy" WHERE "shortlistedBy" IN (SELECT id FROM "users");
ALTER TABLE "applications" DROP COLUMN "shortlistedBy";

-- CreateTable
CREATE TABLE "company_invitations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "company_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_invitations_companyId_idx" ON "company_invitations"("companyId");

-- CreateIndex
CREATE INDEX "company_invitations_phone_idx" ON "company_invitations"("phone");

-- One open invitation per company and phone. Prisma can't express a partial
-- index, so it lives only here.
CREATE UNIQUE INDEX "company_invitations_open_key" ON "company_invitations"("companyId", "phone")
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;

-- CreateIndex
CREATE INDEX "drives_ownerId_idx" ON "drives"("ownerId");

-- AddForeignKey
ALTER TABLE "drives" ADD CONSTRAINT "drives_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_shortlistedById_fkey" FOREIGN KEY ("shortlistedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
