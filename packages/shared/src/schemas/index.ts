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
