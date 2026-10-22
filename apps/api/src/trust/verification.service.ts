import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { alertLimitForDrive, countCandidatesForDrive, Prisma, prisma } from "@walkins/db";
import {
  type AdminSubmission,
  adminSubmissionSchema,
  type CompanyStanding,
  companyStandingSchema,
  type DecideSubmission,
  type DocumentUpload,
  type DocumentUploadRequest,
  type DriveReach,
  type Submission,
  type SubmitVerification,
  VERIFICATION_DOCUMENT_MAX_BYTES,
} from "@walkins/shared";
import { apiError } from "../common/api-error";
import { requireCompanyAccess } from "../common/require-company";
import { StorageService } from "../common/storage.service";
import { type IVerificationProvider, VERIFICATION_PROVIDER } from "./verification-provider";

const EXTENSION: Record<DocumentUploadRequest["contentType"], string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

const SUBMISSION_INCLUDE = { submittedBy: { select: { name: true } } } as const;

type SubmissionRow = Prisma.VerificationSubmissionGetPayload<{ include: typeof SUBMISSION_INCLUDE }>;

const ADMIN_INCLUDE = {
  ...SUBMISSION_INCLUDE,
  decidedBy: { select: { name: true } },
  company: { include: { city: { select: { name: true } } } },
} as const;

type AdminRow = Prisma.VerificationSubmissionGetPayload<{ include: typeof ADMIN_INCLUDE }>;

function toSubmission(row: SubmissionRow): Submission {
  return {
    id: row.id,
    gstin: row.gstin,
    documentCount: row.documentKeys.length,
    status: row.status,
    submittedBy: row.submittedBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    decisionNote: row.decisionNote,
  };
}

// Documents live under the company's own prefix, so a submission can only
// name files its company uploaded.
function documentPrefix(companyId: string) {
  return `verification/${companyId}/`;
}

@Injectable()
export class VerificationService {
  constructor(
    @Inject(VERIFICATION_PROVIDER) private readonly provider: IVerificationProvider,
    private readonly storage: StorageService,
  ) {}

  async standing(userId: string): Promise<CompanyStanding> {
    const { companyId } = await requireCompanyAccess(userId, "read");
    const [company, submissions, warnings, flaggedMessages] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { verificationStatus: true, suspendedAt: true } }),
      prisma.verificationSubmission.findMany({ where: { companyId }, include: SUBMISSION_INCLUDE, orderBy: { createdAt: "desc" } }),
      prisma.warning.findMany({ where: { companyId, acknowledgedAt: null }, orderBy: { createdAt: "desc" } }),
      prisma.message.count({ where: { moneyFlag: true, flagReviewedAt: null, thread: { application: { drive: { companyId } } } } }),
    ]);
    return companyStandingSchema.parse({
      verificationStatus: company.verificationStatus,
      canSubmit: company.verificationStatus === "UNSUBMITTED" || company.verificationStatus === "REJECTED",
      submissions: submissions.map(toSubmission),
      suspended: company.suspendedAt !== null,
      warnings: warnings.map((w) => ({ id: w.id, reason: w.reason, note: w.note, createdAt: w.createdAt.toISOString() })),
      flaggedMessages,
    });
  }

  async startDocumentUpload(userId: string, { contentType }: DocumentUploadRequest): Promise<DocumentUpload> {
    const { companyId } = await requireCompanyAccess(userId, "manageCompany");
    const key = `${documentPrefix(companyId)}${randomUUID()}.${EXTENSION[contentType]}`;
    return { key, ...(await this.storage.presignUpload(key, contentType, VERIFICATION_DOCUMENT_MAX_BYTES)) };
  }

  // The provider runs now, so its opinion is waiting when an admin opens the
  // submission; the admin decides.
  async submit(userId: string, input: SubmitVerification): Promise<CompanyStanding> {
    const { companyId } = await requireCompanyAccess(userId, "manageCompany");
    for (const key of input.documentKeys) {
      if (!key.startsWith(documentPrefix(companyId)) || (await this.storage.size(key)) === null) {
        throw new BadRequestException(apiError("errors.verification.documentMissing"));
      }
    }
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const advice = await this.provider.verify({ name: company.name, gstin: input.gstin });

    await prisma.$transaction(async (tx) => {
      // Only from not-yet-submitted or rejected: a second submit while one
      // waits, or after approval, would quietly replace what the admin sees.
      const { count } = await tx.company.updateMany({
        where: { id: companyId, verificationStatus: { in: ["UNSUBMITTED", "REJECTED"] } },
        data: { verificationStatus: "PENDING", gstin: input.gstin },
      });
      if (count === 0) {
        throw new ConflictException(apiError(company.verificationStatus === "VERIFIED" ? "errors.verification.alreadyVerified" : "errors.verification.alreadyWaiting"));
      }
      const submission = await tx.verificationSubmission.create({
        data: {
          companyId,
          submittedById: userId,
          gstin: input.gstin,
          documentKeys: input.documentKeys,
          providerName: this.provider.name,
          providerCode: advice.code,
          providerParams: advice.params,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          entityType: "company",
          entityId: companyId,
          action: `${company.verificationStatus}->PENDING`,
          before: { verificationStatus: company.verificationStatus },
          after: { verificationStatus: "PENDING", submissionId: submission.id },
        },
      });
    });
    return this.standing(userId);
  }

  // How far the drive's alerts go, so an employer whose company is waiting
  // on review sees why a drive is quiet.
  async reach(userId: string, driveId: string): Promise<DriveReach> {
    const { companyId } = await requireCompanyAccess(userId, "read");
    if ((await prisma.drive.count({ where: { id: driveId, companyId } })) === 0) throw new NotFoundException(apiError("errors.drive.notFound"));
    const [matching, limit] = await Promise.all([countCandidatesForDrive(driveId), alertLimitForDrive(driveId)]);
    return { matching, limit };
  }

  async acknowledgeWarning(userId: string, warningId: string): Promise<void> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { companyId: true, candidate: { select: { id: true } } } });
    const { count } = await prisma.warning.updateMany({
      where: {
        id: warningId,
        acknowledgedAt: null,
        OR: [...(user.companyId ? [{ companyId: user.companyId }] : []), ...(user.candidate ? [{ candidateId: user.candidate.id }] : [])],
      },
      data: { acknowledgedAt: new Date(), acknowledgedById: userId },
    });
    if (count === 0) throw new NotFoundException(apiError("errors.moderation.warningGone"));
  }

  async candidateWarnings(userId: string) {
    const warnings = await prisma.warning.findMany({ where: { candidate: { userId }, acknowledgedAt: null }, orderBy: { createdAt: "desc" } });
    return warnings.map((w) => ({ id: w.id, reason: w.reason, note: w.note, createdAt: w.createdAt.toISOString() }));
  }

  // Waiting first, then newest. Documents are signed for five minutes: long
  // enough to open, too short to pass around.
  async queue(): Promise<AdminSubmission[]> {
    const rows = await prisma.verificationSubmission.findMany({ include: ADMIN_INCLUDE, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
    return Promise.all(rows.map((row) => this.toAdmin(row, rows)));
  }

  async decide(adminId: string, submissionId: string, input: DecideSubmission): Promise<AdminSubmission> {
    const to = input.decision === "approve" ? "VERIFIED" : "REJECTED";
    await prisma.$transaction(async (tx) => {
      const submission = await tx.verificationSubmission.findUnique({ where: { id: submissionId } });
      if (!submission) throw new NotFoundException(apiError("errors.verification.submissionNotFound"));
      const { count } = await tx.verificationSubmission.updateMany({
        where: { id: submissionId, status: "AWAITING_REVIEW" },
        data: {
          status: input.decision === "approve" ? "APPROVED" : "REJECTED",
          decidedById: adminId,
          decidedAt: new Date(),
          rejectionReason: input.decision === "reject" ? input.reason : null,
          decisionNote: input.note || null,
        },
      });
      if (count === 0) throw new ConflictException(apiError("errors.verification.alreadyDecided"));
      await tx.company.update({ where: { id: submission.companyId }, data: { verificationStatus: to } });
      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          entityType: "company",
          entityId: submission.companyId,
          action: `PENDING->${to}`,
          before: { verificationStatus: "PENDING" },
          after: {
            verificationStatus: to,
            submissionId,
            ...(input.decision === "reject" ? { reason: input.reason } : {}),
            ...(input.note ? { note: input.note } : {}),
          },
        },
      });
    });
    const decided = await prisma.verificationSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: ADMIN_INCLUDE });
    const siblings = await prisma.verificationSubmission.findMany({
      where: { companyId: decided.companyId },
      include: ADMIN_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return this.toAdmin(decided, siblings);
  }

  private async toAdmin(row: AdminRow, all: AdminRow[]): Promise<AdminSubmission> {
    return adminSubmissionSchema.parse({
      ...toSubmission(row),
      companyId: row.companyId,
      companyName: row.company.name,
      cityName: row.company.city.name,
      contactPhone: row.company.contactPhone,
      companyStatus: row.company.verificationStatus,
      documents: await Promise.all(row.documentKeys.map(async (key) => ({ key, url: await this.storage.presignPlayback(key) }))),
      provider: row.providerName && row.providerCode ? { name: row.providerName, code: row.providerCode, params: row.providerParams ?? {} } : null,
      decidedBy: row.decidedBy?.name ?? null,
      history: all.filter((r) => r.companyId === row.companyId && r.id !== row.id).map(toSubmission),
    });
  }
}
