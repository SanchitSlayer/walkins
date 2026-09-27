import { Injectable } from "@nestjs/common";
import { findCandidatesForDrive, type TargetingCursor } from "@walkins/db";

// The query lives in @walkins/db so the worker, which owns alert fanout and
// scheduling, runs exactly the same targeting rule as the API.
@Injectable()
export class TargetingService {
  findCandidatesForDrive(driveId: string, page?: { after?: TargetingCursor; limit?: number }) {
    return findCandidatesForDrive(driveId, page);
  }
}
