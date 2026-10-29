import { Prisma, prisma } from "@walkins/db";
import { OUTCOME_MIN_RECORDED, RETENTION_DAYS, type RetentionRow, type ShowUpBucket } from "@walkins/shared";

// Every figure here reads application_facts, never the live tables, and is
// as fresh as its last refresh. Shared by the employer's analytics and the
// admin's retention page so both count the same way.

// Today in India, where every drive happens; dates in the view are India's.
const TODAY = Prisma.sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;

const SLICES = {
  role: Prisma.sql`"roleTitle"`,
  city: Prisma.sql`"cityName"`,
  distance: Prisma.sql`"distanceBand"`,
  hour: Prisma.sql`"slotHour"::text`,
} as const;

// Of those who held a seat, how many came, for one company, sliced one way.
export async function showUpBy(companyId: string, slice: keyof typeof SLICES): Promise<ShowUpBucket[]> {
  const key = SLICES[slice];
  const rows = await prisma.$queryRaw<{ key: string; held: number; attended: number }[]>`
    SELECT ${key} AS key,
      count(*) FILTER (WHERE "heldSeat")::int AS held,
      count(*) FILTER (WHERE "heldSeat" AND "checkedIn")::int AS attended
    FROM application_facts
    WHERE "companyId" = ${companyId} AND counted AND ${key} IS NOT NULL
    GROUP BY 1
    HAVING count(*) FILTER (WHERE "heldSeat") > 0
    ORDER BY ${slice === "hour" ? Prisma.sql`min("slotHour")` : Prisma.sql`held DESC`}
  `;
  return rows.map((r) => ({ ...r, rate: r.attended / r.held }));
}

// Drive day to first day at work, from starts the employer recorded. The
// median waits for enough of them; the counts never do.
export async function timeToJoin(companyId: string) {
  const [row] = await prisma.$queryRaw<{ hires: number; startRecorded: number; started: number; confirmedByCandidate: number; median: number | null }[]>`
    SELECT
      count(*) FILTER (WHERE hired)::int AS hires,
      count(*) FILTER (WHERE hired AND started IS NOT NULL)::int AS "startRecorded",
      count(*) FILTER (WHERE hired AND started)::int AS started,
      count(*) FILTER (WHERE hired AND started AND "candidateStarted")::int AS "confirmedByCandidate",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "startedOn" - ("driveStartsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date)
        FILTER (WHERE hired AND started AND "startedOn" IS NOT NULL) AS median
    FROM application_facts
    WHERE "companyId" = ${companyId} AND counted
  `;
  const { median, ...counts } = row;
  return { ...counts, medianDays: counts.started >= OUTCOME_MIN_RECORDED && median !== null ? Math.round(median) : null };
}

// Of those who started at least 30 days ago: stayed, left, or nobody said.
// Not recorded is its own bucket and never counted as left.
async function retention(scope: Prisma.Sql, key: Prisma.Sql, from: Prisma.Sql = Prisma.empty, group: Prisma.Sql = Prisma.sql`1`): Promise<RetentionRow[]> {
  const rows = await prisma.$queryRaw<{ key: string; eligible: number; stayed: number; left: number }[]>`
    SELECT ${key} AS key,
      count(*)::int AS eligible,
      count(*) FILTER (WHERE f.retained)::int AS stayed,
      count(*) FILTER (WHERE f.retained = false)::int AS "left"
    FROM application_facts f ${from}
    WHERE ${scope} AND f.counted AND f.hired AND f.started AND f."startedOn" + ${RETENTION_DAYS}::int <= ${TODAY}
    GROUP BY ${group}
    ORDER BY eligible DESC
  `;
  return rows.map((r) => {
    const recorded = r.stayed + r.left;
    return { ...r, notRecorded: r.eligible - recorded, rate: recorded >= OUTCOME_MIN_RECORDED ? r.stayed / recorded : null };
  });
}

export function retentionByRole(companyId: string) {
  return retention(Prisma.sql`f."companyId" = ${companyId}`, Prisma.sql`f."roleTitle"`);
}

export function retentionByEmployer() {
  // Grouped by company, not name: two companies may share one.
  return retention(Prisma.sql`true`, Prisma.sql`co.name`, Prisma.sql`JOIN companies co ON co.id = f."companyId"`, Prisma.sql`f."companyId", co.name`);
}
