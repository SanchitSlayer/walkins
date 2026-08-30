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

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type CreateDriveInput = z.infer<typeof createDriveSchema>;
export type UpdateDriveInput = z.infer<typeof updateDriveSchema>;
