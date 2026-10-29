import { z } from "zod";
import { driveStatusSchema } from "./schemas";

// Definitions (see docs/TECHNICAL.md, "Employer analytics"): alerted were sent the
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

// No figure built on hiring outcomes is shown until this many outcomes are
// recorded behind it: below that it says more about who bothered to record
// than about what happened, and it would point at too few people.
export const OUTCOME_MIN_RECORDED = 10;

export const distanceBandSchema = z.enum(["under3", "from3to8", "from8to15", "over15"]);

// Show-up within one slice: of those who held a seat, how many came. Built
// from the system's own records (bookings and scans), so it needs no
// minimum, but always carries its count.
export const showUpBucketSchema = z.object({
  key: z.string(),
  held: z.number().int(),
  attended: z.number().int(),
  rate: z.number().nullable(),
});

export const showUpBreakdownSchema = z.object({
  byRole: z.array(showUpBucketSchema),
  byCity: z.array(showUpBucketSchema),
  byDistance: z.array(showUpBucketSchema),
  // Hour of the slot's start, in India; walk-ins have no slot.
  byHour: z.array(showUpBucketSchema),
});

// From drive to first day. Every count is shown; the median only once
// OUTCOME_MIN_RECORDED starts are recorded. "Recorded" is what the
// employer said; how many of those the candidate also confirmed is kept
// apart.
export const timeToJoinSchema = z.object({
  hires: z.number().int(),
  startRecorded: z.number().int(),
  started: z.number().int(),
  confirmedByCandidate: z.number().int(),
  medianDays: z.number().nullable(),
});

// Thirty-day retention for one slice. eligible started at least 30 days
// ago; notRecorded is its own bucket and never counted as left; rate is
// stayed over recorded, only once OUTCOME_MIN_RECORDED are recorded.
export const retentionRowSchema = z.object({
  key: z.string(),
  eligible: z.number().int(),
  stayed: z.number().int(),
  left: z.number().int(),
  notRecorded: z.number().int(),
  rate: z.number().nullable(),
});

export const analyticsSchema = z.object({
  refreshedAt: z.string().nullable(),
  drives: z.array(driveFunnelSchema),
  daily: z.array(z.object({ day: z.string(), checkIns: z.number().int(), hires: z.number().int() })),
  showUp: showUpBreakdownSchema,
  timeToJoin: timeToJoinSchema,
  retentionByRole: z.array(retentionRowSchema),
});

// For admins: the same retention, by employer, across the platform.
export const adminRetentionSchema = z.object({
  refreshedAt: z.string().nullable(),
  byEmployer: z.array(retentionRowSchema),
});

export type DriveFunnel = z.infer<typeof driveFunnelSchema>;
export type Analytics = z.infer<typeof analyticsSchema>;
export type AdminRetention = z.infer<typeof adminRetentionSchema>;
export type RetentionRow = z.infer<typeof retentionRowSchema>;
export type ShowUpBucket = z.infer<typeof showUpBucketSchema>;
