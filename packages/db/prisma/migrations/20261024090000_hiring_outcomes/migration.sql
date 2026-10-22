-- CreateTable
CREATE TABLE "hiring_outcomes" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "hiredAt" TIMESTAMP(3) NOT NULL,
    "joiningDate" DATE,
    "joiningDateById" TEXT,
    "joiningDateRecordedAt" TIMESTAMP(3),
    "started" BOOLEAN,
    "startedOn" DATE,
    "startedById" TEXT,
    "startedRecordedAt" TIMESTAMP(3),
    "retained" BOOLEAN,
    "retainedById" TEXT,
    "retainedRecordedAt" TIMESTAMP(3),
    "candidateStarted" BOOLEAN,
    "candidateAnsweredAt" TIMESTAMP(3),

    CONSTRAINT "hiring_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hiring_outcomes_applicationId_key" ON "hiring_outcomes"("applicationId");

-- CreateIndex
CREATE INDEX "hiring_outcomes_joiningDate_idx" ON "hiring_outcomes"("joiningDate");

-- AddForeignKey
ALTER TABLE "hiring_outcomes" ADD CONSTRAINT "hiring_outcomes_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_outcomes" ADD CONSTRAINT "hiring_outcomes_joiningDateById_fkey" FOREIGN KEY ("joiningDateById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_outcomes" ADD CONSTRAINT "hiring_outcomes_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_outcomes" ADD CONSTRAINT "hiring_outcomes_retainedById_fkey" FOREIGN KEY ("retainedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Every hire so far gets its outcome record, everything in it unknown. The
-- hire's time is from the audit log, which has always recorded it.
INSERT INTO "hiring_outcomes" ("id", "applicationId", "hiredAt")
SELECT gen_random_uuid()::text, a.id,
  COALESCE(
    (SELECT max(al."createdAt") FROM "audit_logs" al
      WHERE al."entityType" = 'application' AND al."entityId" = a.id AND al.action LIKE '%->HIRED'),
    a."stateChangedAt")
FROM "applications" a WHERE a.state = 'HIRED';

-- The funnel, corrected (README, "Employer analytics"):
-- - booked is who held a seat as the drive happened: the same rule the
--   arrivals board counts by. Someone who released their seat, before the
--   drive or after a reschedule, or whom the employer turned away before
--   they arrived, is not booked. Before, anyone who had ever confirmed was,
--   and counted against the show-up rate if they then released.
-- - applied leaves out the screened-out, counted on their own.
-- - a check-in awaiting the employer's confirmation is counted on its own,
--   not silently as absent.
-- - attendedAfterAlert: booked, checked in, and sent the 48-hour alert
--   before applying. After, not because: they may have found it anyway.
-- Cancelled and suspended drives stay in the view; the API leaves them out
-- of every rate.
DROP MATERIALIZED VIEW "drive_funnel";
CREATE MATERIALIZED VIEW "drive_funnel" AS
WITH apps AS (
  SELECT
    a.id,
    a."driveId",
    a."candidateId",
    a.state,
    ci.id IS NOT NULL AS scanned,
    COALESCE(ci."isValid", false) AS checked_in,
    COALESCE(ci.method = 'WALK_IN', false) AS walk_in,
    (SELECT min(al."createdAt") FROM "audit_logs" al WHERE al."entityType" = 'application' AND al."entityId" = a.id) AS applied_at
  FROM "applications" a
  LEFT JOIN "check_ins" ci ON ci."applicationId" = a.id
), seats AS (
  SELECT apps.*,
    (NOT walk_in AND state NOT IN ('INTERESTED', 'WITHDRAWN', 'SCREENED_OUT') AND NOT (state = 'REJECTED' AND NOT scanned)) AS held_seat
  FROM apps
)
SELECT
  d.id AS "driveId",
  d."companyId",
  (SELECT count(DISTINCT n."candidateId") FROM "notifications" n
    WHERE n."driveId" = d.id AND n."templateKey" = 'drive_48h' AND n.status = 'SENT')::int AS alerted,
  count(s.id) FILTER (WHERE NOT s.walk_in AND s.state <> 'SCREENED_OUT')::int AS interested,
  count(s.id) FILTER (WHERE s.state = 'SCREENED_OUT')::int AS "screenedOut",
  count(s.id) FILTER (WHERE s.held_seat)::int AS confirmed,
  count(s.id) FILTER (WHERE s.held_seat AND s.checked_in)::int AS "checkedIn",
  count(s.id) FILTER (WHERE s.held_seat AND s.scanned AND NOT s.checked_in)::int AS "awaitingConfirmation",
  count(s.id) FILTER (WHERE s.walk_in AND s.checked_in)::int AS "walkIns",
  count(s.id) FILTER (WHERE s.state = 'HIRED')::int AS hired,
  count(s.id) FILTER (
    WHERE s.held_seat AND s.checked_in AND EXISTS (
      SELECT 1 FROM "notifications" n
      WHERE n."driveId" = s."driveId" AND n."candidateId" = s."candidateId"
        AND n."templateKey" = 'drive_48h' AND n.status = 'SENT' AND n."sentAt" < s.applied_at
    )
  )::int AS "attendedAfterAlert"
FROM "drives" d
LEFT JOIN seats s ON s."driveId" = d.id
GROUP BY d.id;

CREATE UNIQUE INDEX "drive_funnel_driveId" ON "drive_funnel"("driveId");
CREATE INDEX "drive_funnel_companyId" ON "drive_funnel"("companyId");
