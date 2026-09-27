import { Prisma } from "@prisma/client";
import { MAX_TRAVEL_KM } from "@walkins/shared";
import { prisma } from "./client";

export type TargetedCandidate = {
  candidateId: string;
  distanceMeters: number;
  telegramChatId: string | null;
};

export type TargetingCursor = Pick<TargetedCandidate, "distanceMeters" | "candidateId">;

export type ReachableDrive = {
  driveId: string;
  distanceMeters: number;
};

// A per-row radius (each candidate's own maxTravelKm) gives the GiST index
// nothing to prune its tree with on its own — there is no single search
// radius to walk the index against. Redundantly ANDing a constant upper
// bound gives the planner a plain ST_DWithin(geom, point, constant) it CAN
// use for index pruning via `&&`; the true per-row ST_DWithin still does
// the exact filtering afterward, so this changes nothing about
// correctness. The bound is derived from the same MAX_TRAVEL_KM the zod
// schema enforces on maxTravelKm, not a separately-hardcoded number, so it
// can never end up lower than a value a candidate is actually allowed to
// save — that would silently exclude valid candidates instead of just
// pruning less.
const MAX_POSSIBLE_TRAVEL_METERS = MAX_TRAVEL_KM * 1000;

// The one definition of "this drive is for this candidate", over aliases c
// (candidates) and d (drives). Alerts and the bot's /jobs both read it, so a
// candidate is never alerted about a drive /jobs would hide, or the reverse.
const candidateReachesDrive = Prisma.sql`
  c."cityId" = d."cityId"
  AND EXISTS (SELECT 1 FROM candidate_roles cr WHERE cr."candidateId" = c.id AND cr."roleId" = d."roleId")
  AND c."experienceYears" BETWEEN d."experienceMin" AND d."experienceMax"
  AND ST_DWithin(c.geom, d.geom, ${MAX_POSSIBLE_TRAVEL_METERS})
  AND ST_DWithin(c.geom, d.geom, c."maxTravelKm" * 1000)
`;

// Returns one page of the candidate set for a drive, nearest first, and
// sends nothing: delivery is the worker's concern. Callers page with the
// last row as `after` until a page comes back short, so no fanout is capped.
// Candidates who already applied are left out; they need no discovery alert.
export async function findCandidatesForDrive(
  driveId: string,
  { after, limit = 500 }: { after?: TargetingCursor; limit?: number } = {},
): Promise<TargetedCandidate[]> {
  return prisma.$queryRaw<TargetedCandidate[]>`
    SELECT
      c.id AS "candidateId",
      ST_Distance(c.geom, d.geom) AS "distanceMeters",
      c."telegramChatId" AS "telegramChatId"
    FROM drives d
    JOIN candidates c ON ${candidateReachesDrive}
    WHERE d.id = ${driveId}
      AND NOT EXISTS (
        SELECT 1 FROM applications a WHERE a."driveId" = d.id AND a."candidateId" = c.id
      )
      ${after ? Prisma.sql`AND (ST_Distance(c.geom, d.geom), c.id) > (${after.distanceMeters}, ${after.candidateId})` : Prisma.empty}
    ORDER BY "distanceMeters", c.id
    LIMIT ${limit}
  `;
}

export async function findLiveDrivesForCandidate(candidateId: string, limit: number): Promise<ReachableDrive[]> {
  return prisma.$queryRaw<ReachableDrive[]>`
    SELECT d.id AS "driveId", ST_Distance(c.geom, d.geom) AS "distanceMeters"
    FROM candidates c
    JOIN drives d ON ${candidateReachesDrive}
    WHERE c.id = ${candidateId}
      AND d.status = 'LIVE'
      AND d."endsAt" > (now() AT TIME ZONE 'UTC')
    ORDER BY "distanceMeters", d.id
    LIMIT ${limit}
  `;
}
