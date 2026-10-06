import { z } from "zod";
import { driveStatusSchema } from "./schemas";

// Definitions (see README, "Employer analytics"): alerted were sent the
// 48-hour alert; interested applied in any way other than walking in;
// confirmed ever booked a seat, from the audit log; checkedIn are confirmed
// candidates with a verified check-in; walkIns are counted apart.
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
  // checkedIn / confirmed; null when nobody has booked yet.
  showUpRate: z.number().nullable(),
});

export const analyticsSchema = z.object({
  refreshedAt: z.string().nullable(),
  drives: z.array(driveFunnelSchema),
  daily: z.array(z.object({ day: z.string(), checkIns: z.number().int(), hires: z.number().int() })),
});

export type DriveFunnel = z.infer<typeof driveFunnelSchema>;
export type Analytics = z.infer<typeof analyticsSchema>;
