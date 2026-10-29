-- One row per application on a drive that left draft, carrying everything
-- the outcome analytics cut by: role, city, the candidate's distance from
-- the venue, the hour their slot started (in India), whether they held a
-- seat and came, whether a 48-hour alert reached them before they applied,
-- and what is known after a hire. Refreshed with the other analytics views,
-- so the dashboard never reads the tables check-in depends on.
CREATE MATERIALIZED VIEW "application_facts" AS
SELECT
  a.id AS "applicationId",
  a."driveId",
  d."companyId",
  d."roleId",
  r.title AS "roleTitle",
  d."cityId",
  c.name AS "cityName",
  d."startsAt" AS "driveStartsAt",
  -- Cancelled and suspended drives count towards nothing.
  d.status IN ('LIVE', 'EXPIRED') AS counted,
  -- The arrivals board's rule, as in drive_funnel.
  (COALESCE(ci.method <> 'WALK_IN', true)
    AND a.state NOT IN ('INTERESTED', 'WITHDRAWN', 'SCREENED_OUT')
    AND NOT (a.state = 'REJECTED' AND ci.id IS NULL)) AS "heldSeat",
  COALESCE(ci."isValid", false) AS "checkedIn",
  EXTRACT(HOUR FROM (s."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::int AS "slotHour",
  CASE
    WHEN cand.geom IS NULL OR d.geom IS NULL THEN NULL
    WHEN ST_Distance(cand.geom, d.geom) < 3000 THEN 'under3'
    WHEN ST_Distance(cand.geom, d.geom) < 8000 THEN 'from3to8'
    WHEN ST_Distance(cand.geom, d.geom) < 15000 THEN 'from8to15'
    ELSE 'over15'
  END AS "distanceBand",
  EXISTS (
    SELECT 1 FROM "notifications" n
    WHERE n."driveId" = d.id AND n."candidateId" = a."candidateId"
      AND n."templateKey" = 'drive_48h' AND n.status = 'SENT'
      AND n."sentAt" < (SELECT min(al."createdAt") FROM "audit_logs" al WHERE al."entityType" = 'application' AND al."entityId" = a.id)
  ) AS "alertedBeforeApplying",
  a.state = 'HIRED' AS hired,
  o."joiningDate",
  o.started,
  o."startedOn",
  o.retained,
  o."candidateStarted"
FROM "applications" a
JOIN "drives" d ON d.id = a."driveId"
JOIN "roles" r ON r.id = d."roleId"
JOIN "cities" c ON c.id = d."cityId"
JOIN "candidates" cand ON cand.id = a."candidateId"
LEFT JOIN "check_ins" ci ON ci."applicationId" = a.id
LEFT JOIN "drive_slots" s ON s.id = a."slotId"
LEFT JOIN "hiring_outcomes" o ON o."applicationId" = a.id
WHERE d.status <> 'DRAFT';

CREATE UNIQUE INDEX "application_facts_applicationId" ON "application_facts"("applicationId");
CREATE INDEX "application_facts_companyId" ON "application_facts"("companyId");
