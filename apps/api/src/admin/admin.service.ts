import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { CHECK_IN_PRICE_EVENT, companyBalance, priceAt, prisma, toPaise } from "@walkins/db";
import {
  type AdminCompany,
  adminCompanySchema,
  type AdminDrive,
  adminDriveSchema,
  type CreatePricingRule,
  type FailedJob,
  failedJobSchema,
  formatPaise,
  type LedgerExplorer,
  ledgerExplorerSchema,
  type ModerateDrive,
  type PricingRuleView,
  pricingRuleSchema,
  type VerificationOutcome,
  verificationOutcomeSchema,
} from "@walkins/shared";
import { JobsService } from "../common/jobs.service";
import { type IVerificationProvider, VERIFICATION_PROVIDER } from "./verification-provider";

const FAILED_JOBS_PER_QUEUE = 100;
const LEDGER_PAGE = 200;

@Injectable()
export class AdminService {
  constructor(
    @Inject(VERIFICATION_PROVIDER) private readonly provider: IVerificationProvider,
    private readonly jobs: JobsService,
  ) {}

  async companies(): Promise<AdminCompany[]> {
    const companies = await prisma.company.findMany({
      include: { city: { select: { name: true } } },
      // Waiting for a decision first, then newest.
      orderBy: [{ verificationStatus: "asc" }, { createdAt: "desc" }],
    });
    return Promise.all(companies.map((c) => this.toAdminCompany(c)));
  }

  // "check" runs the provider and applies what it says; "reject" is the
  // admin's own decision, with their reason. Either way the change and who
  // made it go in the audit log.
  async verifyCompany(adminId: string, companyId: string, decision: "check" | "reject", reason?: string): Promise<VerificationOutcome> {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException("Company not found");

    const result =
      decision === "check"
        ? { provider: this.provider.name, ...(await this.provider.verify(company)) }
        : { provider: null, status: "REJECTED" as const, reason: reason || "Rejected by an admin" };

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.company.update({
        where: { id: companyId },
        data: { verificationStatus: result.status },
        include: { city: { select: { name: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          entityType: "company",
          entityId: companyId,
          action: `${company.verificationStatus}->${result.status}`,
          before: { verificationStatus: company.verificationStatus },
          after: { verificationStatus: result.status, reason: result.reason, provider: result.provider },
        },
      });
      return next;
    });
    return verificationOutcomeSchema.parse({
      company: await this.toAdminCompany(updated),
      provider: result.provider ? { name: result.provider, status: result.status, reason: result.reason } : null,
    });
  }

  async drives(): Promise<AdminDrive[]> {
    const drives = await prisma.drive.findMany({
      where: { status: { in: ["PENDING", "LIVE"] } },
      include: { company: true, role: true, city: true },
      orderBy: [{ status: "desc" }, { startsAt: "asc" }],
    });
    return Promise.all(drives.map(async (d) => adminDriveSchema.parse(await this.toAdminDrive(d))));
  }

  // Approval is where a drive goes live, so it is where the rules that keep a
  // live drive honest are enforced: a verified company, and enough credit for
  // at least one check-in. Everything that blocks it is reported at once.
  async moderateDrive(adminId: string, driveId: string, { decision, reason }: ModerateDrive): Promise<AdminDrive> {
    const drive = await prisma.drive.findUnique({ where: { id: driveId }, include: { company: true, role: true, city: true } });
    if (!drive) throw new NotFoundException("Drive not found");
    if (drive.status !== "PENDING") throw new BadRequestException(`Only a drive waiting for review can be moderated; this one is ${drive.status.toLowerCase()}`);

    const to = decision === "approve" ? "LIVE" : "DRAFT";
    if (decision === "approve") {
      const { blockers } = await this.toAdminDrive(drive);
      if (blockers.length > 0) throw new BadRequestException(`This drive can't go live yet: ${blockers.join(" ")}`);
    }
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.drive.updateMany({ where: { id: driveId, status: "PENDING" }, data: { status: to } });
      if (count === 0) throw new BadRequestException("The drive changed while you were reviewing it; reload and try again");
      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          entityType: "drive",
          entityId: driveId,
          action: `PENDING->${to}`,
          before: { status: "PENDING" },
          after: { status: to, ...(reason ? { reason } : {}) },
        },
      });
    });
    const after = await prisma.drive.findUniqueOrThrow({ where: { id: driveId }, include: { company: true, role: true, city: true } });
    return adminDriveSchema.parse(await this.toAdminDrive(after));
  }

  async failedJobs(): Promise<FailedJob[]> {
    const perQueue = await Promise.all(
      this.jobs.queues().map(async (queue) =>
        (await queue.getFailed(0, FAILED_JOBS_PER_QUEUE - 1)).map((job) =>
          failedJobSchema.parse({
            queue: queue.name,
            id: job.id,
            name: job.name,
            data: job.data,
            failedReason: job.failedReason ?? "No reason recorded",
            attemptsMade: job.attemptsMade,
            failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
          }),
        ),
      ),
    );
    return perQueue.flat().sort((a, b) => (b.failedAt ?? "").localeCompare(a.failedAt ?? ""));
  }

  // Retrying is safe for every queue here: alerts claim before sending, and
  // charges and top-ups are keyed so a second run is a no-op.
  async retryJob(queueName: string, jobId: string) {
    const queue = this.jobs.queues().find((q) => q.name === queueName);
    const job = queue && (await queue.getJob(jobId));
    if (!job) throw new NotFoundException("Job not found");
    if (!(await job.isFailed())) throw new BadRequestException("Only a failed job can be retried");
    await job.retry("failed");
    return { retried: true };
  }

  async ledger(filter: { accountId?: string; txnId?: string }): Promise<LedgerExplorer> {
    const [balances, companies, entries, [{ unbalanced }]] = await Promise.all([
      prisma.$queryRaw<{ accountId: string; ownerType: "COMPANY" | "PLATFORM"; ownerId: string; currency: string; balancePaise: bigint }[]>`
        SELECT "accountId", "ownerType", "ownerId", currency, "balancePaise" FROM ledger_balances ORDER BY "ownerType", "ownerId"
      `,
      prisma.company.findMany({ select: { id: true, name: true } }),
      prisma.ledgerEntry.findMany({
        where: { accountId: filter.accountId, txnId: filter.txnId },
        include: { account: true },
        orderBy: [{ createdAt: "desc" }, { txnId: "asc" }],
        take: LEDGER_PAGE,
      }),
      prisma.$queryRaw<{ unbalanced: bigint }[]>`
        SELECT count(*) AS unbalanced FROM (
          SELECT "txnId" FROM ledger_entries
          GROUP BY "txnId"
          HAVING SUM(CASE WHEN direction = 'DEBIT' THEN "amountPaise" ELSE -"amountPaise" END) <> 0
        ) t
      `,
    ]);
    const names = new Map(companies.map((c) => [c.id, c.name]));
    const name = (ownerType: string, ownerId: string) => (ownerType === "COMPANY" ? (names.get(ownerId) ?? ownerId) : `Platform: ${ownerId}`);
    return ledgerExplorerSchema.parse({
      accounts: balances.map((b) => ({ ...b, ownerName: name(b.ownerType, b.ownerId), balancePaise: toPaise(b.balancePaise) })),
      entries: entries.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        accountName: name(e.account.ownerType, e.account.ownerId),
      })),
      unbalancedTxnCount: Number(unbalanced),
    });
  }

  async pricingRules(): Promise<PricingRuleView[]> {
    const rules = await prisma.pricingRule.findMany({ orderBy: { effectiveFrom: "desc" } });
    return rules.map((r) => pricingRuleSchema.parse({ ...r, effectiveFrom: r.effectiveFrom.toISOString(), createdAt: r.createdAt.toISOString() }));
  }

  // A new price is a new row from now or later. Backdating would quietly
  // re-price check-ins whose charges are still queued.
  async createPricingRule(adminId: string, input: CreatePricingRule): Promise<PricingRuleView> {
    const now = new Date();
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : now;
    if (effectiveFrom.getTime() < now.getTime() - 60_000) throw new BadRequestException("A price can't take effect in the past");
    const rule = await prisma.pricingRule.create({
      data: { event: CHECK_IN_PRICE_EVENT, unit: "PER_CHECK_IN", pricePaise: input.pricePaise, effectiveFrom, createdById: adminId },
    });
    return pricingRuleSchema.parse({ ...rule, effectiveFrom: rule.effectiveFrom.toISOString(), createdAt: rule.createdAt.toISOString() });
  }

  private async toAdminCompany(c: { id: string; name: string; gstin: string | null; contactPhone: string; verificationStatus: AdminCompany["verificationStatus"]; createdAt: Date; city: { name: string } }) {
    return adminCompanySchema.parse({
      id: c.id,
      name: c.name,
      gstin: c.gstin,
      contactPhone: c.contactPhone,
      cityName: c.city.name,
      verificationStatus: c.verificationStatus,
      createdAt: c.createdAt.toISOString(),
      balancePaise: await companyBalance(prisma, c.id),
    });
  }

  private async toAdminDrive(d: {
    id: string;
    companyId: string;
    company: { name: string; verificationStatus: string };
    role: { title: string };
    city: { name: string };
    venueAddress: string;
    startsAt: Date;
    endsAt: Date;
    status: AdminDrive["status"];
    capacity: number;
  }): Promise<AdminDrive> {
    const now = new Date();
    const [balance, price] = await Promise.all([companyBalance(prisma, d.companyId), priceAt(prisma, CHECK_IN_PRICE_EVENT, now)]);
    const blockers: string[] = [];
    if (d.status === "PENDING") {
      if (d.company.verificationStatus !== "VERIFIED") {
        blockers.push(`${d.company.name} isn't verified (${d.company.verificationStatus.toLowerCase()}).`);
      }
      if (price !== null && balance < price) {
        blockers.push(`${d.company.name}'s balance is ${formatPaise(balance)}, below the ${formatPaise(price)} cost of one check-in.`);
      }
      if (d.endsAt <= now) blockers.push("The drive has already ended.");
    }
    return {
      id: d.id,
      companyId: d.companyId,
      companyName: d.company.name,
      roleTitle: d.role.title,
      cityName: d.city.name,
      venueAddress: d.venueAddress,
      startsAt: d.startsAt.toISOString(),
      endsAt: d.endsAt.toISOString(),
      status: d.status,
      capacity: d.capacity,
      blockers,
    };
  }
}
