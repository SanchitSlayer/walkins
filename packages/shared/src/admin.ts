import { z } from "zod";
import { ledgerEntrySchema } from "./billing";
import { driveStatusSchema } from "./schemas";

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
  blockers: z.array(z.object({ code: z.string(), params: z.record(z.union([z.string(), z.number()])) })),
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

export type AdminDrive = z.infer<typeof adminDriveSchema>;
export type ModerateDrive = z.infer<typeof moderateDriveSchema>;
export type FailedJob = z.infer<typeof failedJobSchema>;
export type LedgerAccountRow = z.infer<typeof ledgerAccountRowSchema>;
export type LedgerExplorer = z.infer<typeof ledgerExplorerSchema>;
