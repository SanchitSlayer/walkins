import { Injectable } from "@nestjs/common";
import { prisma } from "@walkins/db";
import { MAX_TRAVEL_KM } from "@walkins/shared";

export type TargetedCandidate = {
  candidateId: string;
  distanceMeters: number;
  telegramChatId: string | null;
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

// Returns the candidate set for a drive; sends nothing. Notification
// delivery is a separate concern (phase 4) — keeping that boundary here
// means this service never needs to know how a candidate gets notified.
@Injectable()
export class TargetingService {
  async findCandidatesForDrive(driveId: string, limit = 100): Promise<TargetedCandidate[]> {
    return prisma.$queryRaw<TargetedCandidate[]>`
      SELECT
        c.id AS "candidateId",
        ST_Distance(c.geom, d.geom) AS "distanceMeters",
        c."telegramChatId" AS "telegramChatId"
      FROM drives d
      JOIN candidates c ON c."cityId" = d."cityId"
      JOIN candidate_roles cr ON cr."candidateId" = c.id AND cr."roleId" = d."roleId"
      WHERE d.id = ${driveId}
        AND c."experienceYears" BETWEEN d."experienceMin" AND d."experienceMax"
        AND ST_DWithin(c.geom, d.geom, ${MAX_POSSIBLE_TRAVEL_METERS})
        AND ST_DWithin(c.geom, d.geom, c."maxTravelKm" * 1000)
        AND NOT EXISTS (
          SELECT 1 FROM applications a WHERE a."driveId" = d.id AND a."candidateId" = c.id
        )
      ORDER BY "distanceMeters" ASC
      LIMIT ${limit}
    `;
  }
}
