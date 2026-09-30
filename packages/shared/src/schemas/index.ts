import { z } from "zod";

export const verificationStatusSchema = z.enum(["PENDING", "VERIFIED", "REJECTED"]);

export const userRoleSchema = z.enum(["CANDIDATE", "EMPLOYER", "ADMIN"]);

export const driveStatusSchema = z.enum(["DRAFT", "PENDING", "LIVE", "EXPIRED", "CANCELLED"]);

export const applicationStateSchema = z.enum([
  "INTERESTED",
  "CONFIRMED",
  "CHECKED_IN",
  "INTERVIEWED",
  "HIRED",
  "NO_SHOW",
  "REJECTED",
  "WITHDRAWN",
]);

export const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{9,14}$/, "Enter a valid phone number");

export const otpRequestSchema = z.object({
  phone: phoneSchema,
});

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
});

// Shared by createDriveSchema and updateDriveSchema. Deliberately excludes
// companyId (derived from the authenticated employer, never client-supplied)
// and status (always starts DRAFT; transitions happen via /drives/:id/submit).
const driveCoreShape = {
  roleId: z.string().min(1),
  cityId: z.string().min(1),
  salaryMin: z.number().int().nonnegative(),
  salaryMax: z.number().int().nonnegative(),
  venueAddress: z.string().min(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  capacity: z.number().int().positive(),
  experienceMin: z.number().nonnegative(),
  experienceMax: z.number().nonnegative(),
};

export const createDriveSchema = z
  .object({
    ...driveCoreShape,
    slotDurationMinutes: z.number().int().positive(),
    capacityPerSlot: z.number().int().positive(),
  })
  .refine((d) => d.salaryMax >= d.salaryMin, {
    message: "salaryMax must be >= salaryMin",
    path: ["salaryMax"],
  })
  .refine((d) => d.experienceMax >= d.experienceMin, {
    message: "experienceMax must be >= experienceMin",
    path: ["experienceMax"],
  })
  .refine((d) => d.endsAt > d.startsAt, {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });

export const updateDriveSchema = z.object(driveCoreShape).partial();

// Single source of truth for the maximum allowed travel radius. Kept to a
// realistic walk-in-interview commute distance (not an arbitrary large
// number) so the targeting query's GiST-indexable bounding prefilter
// (TargetingService) actually narrows the candidate set instead of just
// technically being "a constant." The profile page's radius slider and the
// zod validation both derive from this same value — if it ever changes
// without the prefilter changing too, the prefilter would silently exclude
// valid candidates above the old ceiling instead of just becoming looser.
export const MAX_TRAVEL_KM = 50;

// Partial at the schema layer; the service enforces that all fields are
// present on a candidate's *first* save (Candidate's location/travel
// columns are NOT NULL with no defaults), then allows true partial edits
// once the row exists.
export const updateCandidateProfileSchema = z
  .object({
    cityId: z.string().min(1),
    homeLat: z.number().min(-90).max(90),
    homeLng: z.number().min(-180).max(180),
    maxTravelKm: z.number().positive().max(MAX_TRAVEL_KM),
    experienceYears: z.number().nonnegative(),
    roleIds: z.array(z.string().min(1)),
  })
  .partial();

export const driveSearchQuerySchema = z.object({
  city: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  radiusKm: z.coerce.number().positive().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

// Response schemas describe the wire format (dates as ISO strings), and the
// public ones are applied by the API before responding: anything a schema
// does not name is stripped, so candidate identities or application rows can
// never reach a public endpoint by being accidentally selected.
export const driveSlotSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  capacity: z.number().int(),
  bookedCount: z.number().int(),
});

export const driveSummarySchema = z.object({
  id: z.string(),
  roleId: z.string(),
  cityId: z.string(),
  salaryMin: z.number().int(),
  salaryMax: z.number().int(),
  venueAddress: z.string(),
  venueLat: z.number(),
  venueLng: z.number(),
  startsAt: z.string(),
  endsAt: z.string(),
  capacity: z.number().int(),
  experienceMin: z.number(),
  experienceMax: z.number(),
  status: driveStatusSchema,
  needsManualGeocode: z.boolean(),
  role: z.object({ title: z.string(), slug: z.string() }),
});

export const driveDetailSchema = driveSummarySchema.extend({
  slots: z.array(driveSlotSchema),
  venuePinnedAt: z.string().nullable(),
});

export const employerDriveRowSchema = driveSummarySchema.extend({
  bookedCount: z.number().int(),
});

export const driveSearchResultSchema = driveSummarySchema.extend({
  distanceKm: z.number(),
  city: z.object({ name: z.string(), state: z.string() }),
  bookedCount: z.number().int(),
});

export const driveSearchPageSchema = z.object({
  items: z.array(driveSearchResultSchema),
  nextCursor: z.string().nullable(),
});

export const publicDriveDetailSchema = driveSearchResultSchema.extend({
  slots: z.array(driveSlotSchema),
});

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const applySchema = z.object({
  slotId: z.string().min(1),
});

// Employers move applicants forward after they arrive; the transition table
// in @walkins/db decides which of these is legal from the current state.
export const employerApplicationUpdateSchema = z.object({
  to: z.enum(["INTERVIEWED", "HIRED", "REJECTED"]),
});

export const checkInRequestSchema = z.object({
  token: z.string().min(1),
  lat: latitude,
  lng: longitude,
  accuracy: z.number().nonnegative(),
  // Set by the offline queue: when the phone captured the scan. Untrusted,
  // shown to the employer, never used to decide whether to accept.
  capturedAt: z.coerce.date().optional(),
  // The candidate agreed to register as a walk-in after being told they
  // hadn't applied.
  walkIn: z.boolean().optional(),
});

export const venuePinSchema = z.object({
  lat: latitude,
  lng: longitude,
  accuracy: z.number().nonnegative(),
});

export const manualCheckInSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export const checkInMethodSchema = z.enum(["SCAN", "WALK_IN", "MANUAL"]);

export const checkInSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  method: checkInMethodSchema,
  scannedAt: z.string(),
  capturedAt: z.string().nullable(),
  distanceMeters: z.number().nullable(),
  accuracyMeters: z.number().nullable(),
  isValid: z.boolean(),
  flagReason: z.string().nullable(),
});

export const checkInResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("checked_in"), checkIn: checkInSchema }),
  z.object({ outcome: z.literal("already_checked_in"), checkIn: checkInSchema }),
  z.object({
    outcome: z.literal("needs_registration"),
    drive: z.object({ id: z.string(), roleTitle: z.string(), companyName: z.string() }),
  }),
]);

export const checkInTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  rotateAfterSeconds: z.number().int(),
});

export const myApplicationSchema = z.object({
  id: z.string(),
  state: applicationStateSchema,
  slotStartsAt: z.string().nullable(),
  drive: z.object({
    id: z.string(),
    roleTitle: z.string(),
    companyName: z.string(),
    venueAddress: z.string(),
    venueLat: z.number(),
    venueLng: z.number(),
    startsAt: z.string(),
    endsAt: z.string(),
    status: driveStatusSchema,
  }),
  checkIn: checkInSchema.nullable(),
});

export const myApplicationsSchema = z.object({
  upcoming: z.array(myApplicationSchema),
  past: z.array(myApplicationSchema),
});

// Employer-only: names are shown to the company running the drive and
// nowhere public.
export const liveBoardSchema = z.object({
  driveId: z.string(),
  counts: z.object({
    alerted: z.number().int(),
    confirmed: z.number().int(),
    checkedIn: z.number().int(),
    walkIns: z.number().int(),
    hired: z.number().int(),
  }),
  arrivals: z.array(
    z.object({
      checkInId: z.string(),
      applicationId: z.string(),
      name: z.string(),
      method: checkInMethodSchema,
      scannedAt: z.string(),
      slotStartsAt: z.string().nullable(),
      distanceMeters: z.number().nullable(),
      isValid: z.boolean(),
      flagReason: z.string().nullable(),
    }),
  ),
  awaiting: z.array(
    z.object({
      applicationId: z.string(),
      name: z.string(),
      state: applicationStateSchema,
      slotStartsAt: z.string().nullable(),
    }),
  ),
});

export type DriveSlot = z.infer<typeof driveSlotSchema>;
export type DriveSummary = z.infer<typeof driveSummarySchema>;
export type DriveDetail = z.infer<typeof driveDetailSchema>;
export type EmployerDriveRow = z.infer<typeof employerDriveRowSchema>;
export type DriveSearchResult = z.infer<typeof driveSearchResultSchema>;
export type DriveSearchPage = z.infer<typeof driveSearchPageSchema>;
export type PublicDriveDetail = z.infer<typeof publicDriveDetailSchema>;

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type CreateDriveInput = z.infer<typeof createDriveSchema>;
export type UpdateDriveInput = z.infer<typeof updateDriveSchema>;
export type UpdateCandidateProfileInput = z.infer<typeof updateCandidateProfileSchema>;
export type DriveSearchQuery = z.infer<typeof driveSearchQuerySchema>;
export type ApplyInput = z.infer<typeof applySchema>;
export type EmployerApplicationUpdate = z.infer<typeof employerApplicationUpdateSchema>;
export type CheckInRequest = z.infer<typeof checkInRequestSchema>;
export type VenuePinInput = z.infer<typeof venuePinSchema>;
export type ManualCheckInInput = z.infer<typeof manualCheckInSchema>;
export type CheckIn = z.infer<typeof checkInSchema>;
export type CheckInResult = z.infer<typeof checkInResultSchema>;
export type CheckInToken = z.infer<typeof checkInTokenSchema>;
export type MyApplication = z.infer<typeof myApplicationSchema>;
export type MyApplications = z.infer<typeof myApplicationsSchema>;
export type LiveBoard = z.infer<typeof liveBoardSchema>;
