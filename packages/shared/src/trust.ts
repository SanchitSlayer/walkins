import { z } from "zod";
import { verificationStatusSchema } from "./schemas";

export const reportReasonSchema = z.enum(["ASKS_FOR_MONEY", "NOT_A_REAL_JOB", "MISLEADING_PAY", "ABUSIVE", "FAKE_PROFILE", "OTHER"]);

export type ReportReason = z.infer<typeof reportReasonSchema>;

// Which reasons fit which target. Money and pay are what a fake recruiter
// gets wrong; a candidate is reported for how they behaved or for not being
// who they say.
export const REPORT_REASONS = {
  DRIVE: ["ASKS_FOR_MONEY", "NOT_A_REAL_JOB", "MISLEADING_PAY", "ABUSIVE", "OTHER"],
  CANDIDATE: ["ABUSIVE", "FAKE_PROFILE", "OTHER"],
} as const satisfies Record<"DRIVE" | "CANDIDATE", readonly ReportReason[]>;

const details = z.string().trim().max(500).optional();

// website is a honeypot: a field a person never sees, so a filled one marks
// a script. Its report is accepted on screen and dropped.
export const driveReportSchema = z.object({
  reason: z.enum(REPORT_REASONS.DRIVE),
  details,
  website: z.string().optional(),
});

export const candidateReportSchema = z.object({
  applicationId: z.string().min(1),
  reason: z.enum(REPORT_REASONS.CANDIDATE),
  details,
});

export type DriveReport = z.infer<typeof driveReportSchema>;
export type CandidateReport = z.infer<typeof candidateReportSchema>;

// Unverified companies reach only the nearest candidates. Small enough that
// a fake recruiter can't reach a city with one drive, large enough that a
// real employer waiting on review still fills a walk-in.
export const UNVERIFIED_ALERT_LIMIT = 50;

export const VERIFICATION_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const VERIFICATION_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const VERIFICATION_DOCUMENTS_MAX = 3;

export const documentUploadRequestSchema = z.object({
  contentType: z.enum(VERIFICATION_DOCUMENT_TYPES),
  bytes: z.number().int().positive().max(VERIFICATION_DOCUMENT_MAX_BYTES, "errors.verification.documentTooLarge"),
});

export const documentUploadSchema = z.object({
  key: z.string(),
  url: z.string(),
  fields: z.record(z.string()),
});

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const submitVerificationSchema = z.object({
  gstin: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(GSTIN, "errors.validation.gstin")),
  documentKeys: z.array(z.string().min(1)).min(1, "errors.verification.noDocuments").max(VERIFICATION_DOCUMENTS_MAX),
});

export const verificationRejectionSchema = z.enum(["DOCUMENT_UNREADABLE", "DETAILS_DONT_MATCH", "GSTIN_INVALID", "NOT_A_BUSINESS", "OTHER"]);

export const submissionStatusSchema = z.enum(["AWAITING_REVIEW", "APPROVED", "REJECTED"]);

export const submissionSchema = z.object({
  id: z.string(),
  gstin: z.string(),
  documentCount: z.number().int(),
  status: submissionStatusSchema,
  submittedBy: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  rejectionReason: verificationRejectionSchema.nullable(),
  decisionNote: z.string().nullable(),
});

export const warningSchema = z.object({
  id: z.string(),
  reason: reportReasonSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
});

// The company's standing, as everyone at the company sees it: whether it is
// verified, what was last sent, whether it is suspended, and any warning
// nobody has acknowledged yet.
export const companyStandingSchema = z.object({
  verificationStatus: verificationStatusSchema,
  canSubmit: z.boolean(),
  submissions: z.array(submissionSchema),
  suspended: z.boolean(),
  warnings: z.array(warningSchema),
});

// How far a drive's alerts go, shown to the employer so limited reach has a
// reason next to it rather than looking like a quiet drive.
export const driveReachSchema = z.object({
  matching: z.number().int(),
  limit: z.number().int().nullable(),
});

export const adminSubmissionSchema = submissionSchema.extend({
  companyId: z.string(),
  companyName: z.string(),
  cityName: z.string(),
  contactPhone: z.string(),
  companyStatus: verificationStatusSchema,
  documents: z.array(z.object({ key: z.string(), url: z.string() })),
  // The provider's opinion, for the admin to weigh; never the decision.
  provider: z.object({ name: z.string(), code: z.string(), params: z.record(z.union([z.string(), z.number()])) }).nullable(),
  decidedBy: z.string().nullable(),
  // Earlier submissions from the same company, newest first.
  history: z.array(submissionSchema),
});

export const decideSubmissionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), note: z.string().trim().max(500).optional() }),
  z.object({ decision: z.literal("reject"), reason: verificationRejectionSchema, note: z.string().trim().max(500).optional() }),
]);

export const moderationActionKindSchema = z.enum(["DISMISS", "WARN", "SUSPEND_DRIVE", "SUSPEND_COMPANY", "LIFT_DRIVE", "LIFT_COMPANY"]);

// One reporter's record, so a serial false reporter is obvious: what they
// have reported before and how it was decided. A logged-out reporter is
// known only by network, which can be many people.
export const reporterSchema = z.object({
  kind: z.enum(["account", "network"]),
  name: z.string().nullable(),
  total: z.number().int(),
  dismissed: z.number().int(),
  actioned: z.number().int(),
});

export const queuedReportSchema = z.object({
  id: z.string(),
  reason: reportReasonSchema,
  details: z.string().nullable(),
  createdAt: z.string(),
  reporter: reporterSchema,
});

export const moderationTargetSchema = z.object({
  targetType: z.enum(["DRIVE", "CANDIDATE"]),
  targetId: z.string(),
  title: z.string(),
  subtitle: z.string(),
  companyId: z.string().nullable(),
  driveStatus: z.string().nullable(),
  companySuspended: z.boolean(),
  verificationStatus: verificationStatusSchema.nullable(),
  latestAt: z.string(),
  accountReporters: z.number().int(),
  networkReporters: z.number().int(),
  // Logged-out reports past the daily cap for this drive: counted, not kept.
  overflow: z.number().int(),
  reasons: z.record(z.number().int()),
  reports: z.array(queuedReportSchema),
});

export const moderationHistorySchema = z.object({
  id: z.string(),
  kind: moderationActionKindSchema,
  admin: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  target: z.string(),
});

export const moderationQueueSchema = z.object({
  targets: z.array(moderationTargetSchema),
  // Drives and companies under suspension, so lifting one doesn't need a
  // fresh report.
  suspended: z.array(z.object({ kind: z.enum(["DRIVE", "COMPANY"]), id: z.string(), title: z.string(), since: z.string() })),
  recent: z.array(moderationHistorySchema),
});

export const moderateSchema = z.object({
  kind: moderationActionKindSchema,
  targetType: z.enum(["DRIVE", "CANDIDATE", "COMPANY"]),
  targetId: z.string().min(1),
  note: z.string().trim().max(500).optional(),
});

export type AdminSubmission = z.infer<typeof adminSubmissionSchema>;
export type CompanyStanding = z.infer<typeof companyStandingSchema>;
export type DecideSubmission = z.infer<typeof decideSubmissionSchema>;
export type DocumentUpload = z.infer<typeof documentUploadSchema>;
export type DocumentUploadRequest = z.infer<typeof documentUploadRequestSchema>;
export type DriveReach = z.infer<typeof driveReachSchema>;
export type Moderate = z.infer<typeof moderateSchema>;
export type ModerationQueue = z.infer<typeof moderationQueueSchema>;
export type ModerationTarget = z.infer<typeof moderationTargetSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type SubmitVerification = z.infer<typeof submitVerificationSchema>;
export type VerificationRejection = z.infer<typeof verificationRejectionSchema>;
export type Warning = z.infer<typeof warningSchema>;
