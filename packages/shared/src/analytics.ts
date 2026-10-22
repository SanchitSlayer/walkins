import { z } from "zod";
import { driveStatusSchema } from "./schemas";

// Definitions (see README, "Employer analytics"): alerted were sent the
// 48-hour alert; interested applied other than by walking in, screened-out
// left out; confirmed held a seat as the drive happened, the arrivals
// board's rule; checkedIn are those with a verified check-in, and
// awaitingConfirmation those whose check-in is flagged; walkIns are counted
// apart; attendedAfterAlert checked in having been alerted before applying.
// Redis key the worker sets after each refresh, so the page can say how old
// the numbers are.
export const ANALYTICS_REFRESHED_KEY = "analytics:refreshed-at";
export const ANALYTICS_DAYS = 30;

export const driveFunnelSchema = z.object({
  driveId: z.string(),
  roleTitle: z.string(),
  startsAt: z.string(),
  status: driveStatusSchema,
  alerted: z.number().int(),
  interested: z.number().int(),
  confirmed: z.number().int(),
  checkedIn: z.number().int(),
  walkIns: z.number().int(),
  hired: z.number().int(),
  screenedOut: z.number().int(),
  awaitingConfirmation: z.number().int(),
  attendedAfterAlert: z.number().int(),
  // False for a cancelled or suspended drive: it is listed, and left out of
  // every rate and total, since nobody booked on it could have come.
  counted: z.boolean(),
  // checkedIn / confirmed; null when nobody has booked, or not counted.
  showUpRate: z.number().nullable(),
});

export const analyticsSchema = z.object({
  refreshedAt: z.string().nullable(),
  drives: z.array(driveFunnelSchema),
  daily: z.array(z.object({ day: z.string(), checkIns: z.number().int(), hires: z.number().int() })),
});

export type DriveFunnel = z.infer<typeof driveFunnelSchema>;
export type Analytics = z.infer<typeof analyticsSchema>;
