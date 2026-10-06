import { z } from "zod";
import { ledgerEntrySchema } from "./billing";
import { driveStatusSchema, verificationStatusSchema } from "./schemas";

export const adminCompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  gstin: z.string().nullable(),
  contactPhone: z.string(),
  cityName: z.string(),
  verificationStatus: verificationStatusSchema,
  createdAt: z.string(),
  balancePaise: z.number().int(),
});

export const verifyCompanySchema = z.object({ decision: z.enum(["check", "reject"]), reason: z.string().max(300).optional() });

export const verificationOutcomeSchema = z.object({
  company: adminCompanySchema,
  // What the provider said, shown to the admin whatever it decided.
  provider: z.object({ name: z.string(), status: z.enum(["VERIFIED", "REJECTED"]), reason: z.string() }).nullable(),
});

// blockers lists every reason the drive can't be approved yet, so the admin
// sees all of them at once rather than one per attempt.
export const adminDriveSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  roleTitle: z.string(),
  cityName: z.string(),
  venueAddress: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: driveStatusSchema,
  capacity: z.number().int(),
  blockers: z.array(z.string()),
});

export const moderateDriveSchema = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().max(300).optional() });

export const failedJobSchema = z.object({
  queue: z.string(),
  id: z.string(),
  name: z.string(),
  data: z.unknown(),
  failedReason: z.string(),
  attemptsMade: z.number().int(),
  failedAt: z.string().nullable(),
});

export const ledgerAccountRowSchema = z.object({
  accountId: z.string(),
  ownerType: z.enum(["COMPANY", "PLATFORM"]),
  ownerId: z.string(),
  ownerName: z.string(),
  currency: z.string(),
  balancePaise: z.number().int(),
});

export const ledgerExplorerSchema = z.object({
  accounts: z.array(ledgerAccountRowSchema),
  entries: z.array(ledgerEntrySchema.extend({ accountId: z.string(), accountName: z.string() })),
  // Every txnId balances by construction; this is the database saying so.
  unbalancedTxnCount: z.number().int(),
});

export type AdminCompany = z.infer<typeof adminCompanySchema>;
export type VerifyCompany = z.infer<typeof verifyCompanySchema>;
export type VerificationOutcome = z.infer<typeof verificationOutcomeSchema>;
export type AdminDrive = z.infer<typeof adminDriveSchema>;
export type ModerateDrive = z.infer<typeof moderateDriveSchema>;
export type FailedJob = z.infer<typeof failedJobSchema>;
export type LedgerAccountRow = z.infer<typeof ledgerAccountRowSchema>;
export type LedgerExplorer = z.infer<typeof ledgerExplorerSchema>;
