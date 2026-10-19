import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { type DriveStatus, Prisma, prisma, type ReportReason } from "@walkins/db";
import { type Moderate, type ModerationQueue, moderationQueueSchema, type ModerationTarget } from "@walkins/shared";
import { apiError } from "../common/api-error";
import { JobsService } from "../common/jobs.service";
import { redis } from "../common/redis";
import { LiveGateway } from "../live/live.gateway";
import { overflowKey } from "./reports.service";

type Tx = Prisma.TransactionClient;

// Only a drive that could still be seen or booked is worth suspending.
const SUSPENDABLE: DriveStatus[] = ["LIVE", "PENDING"];

const RECENT_ACTIONS = 20;

type Effects = { suspendedLive: string[]; liftedLive: string[]; touched: string[] };

function audit(tx: Tx, adminId: string, entityType: string, entityId: string, kind: string, after: object) {
  return tx.auditLog.create({ data: { actorUserId: adminId, entityType, entityId, action: `moderation.${kind.toLowerCase()}`, after } });
}

// Suspends drives in one company that are live or waiting for approval,
// remembering each one's status so lifting restores it. Conditional on the
// status read, so a drive that changed meanwhile is left as it now is.
async function suspendDrives(tx: Tx, where: Prisma.DriveWhereInput, cause: "DRIVE" | "COMPANY"): Promise<{ ids: string[]; live: string[] }> {
  const drives = await tx.drive.findMany({ where: { ...where, status: { in: SUSPENDABLE } }, select: { id: true, status: true } });
  for (const status of SUSPENDABLE) {
    const ids = drives.filter((d) => d.status === status).map((d) => d.id);
    if (ids.length) await tx.drive.updateMany({ where: { id: { in: ids }, status }, data: { status: "SUSPENDED", suspendedFrom: status, suspendedCause: cause } });
  }
  return { ids: drives.map((d) => d.id), live: drives.filter((d) => d.status === "LIVE").map((d) => d.id) };
}

// Puts suspended drives back as they were. A drive whose time ran out while
// suspended stays suspended for good: nobody went, nobody should be marked
// as not having gone, and it is the record of what happened.
async function liftDrives(tx: Tx, where: Prisma.DriveWhereInput): Promise<{ ids: string[]; live: string[] }> {
  const drives = await tx.drive.findMany({
    where: { ...where, status: "SUSPENDED", endsAt: { gt: new Date() } },
    select: { id: true, suspendedFrom: true },
  });
  for (const status of SUSPENDABLE) {
    const ids = drives.filter((d) => d.suspendedFrom === status).map((d) => d.id);
    if (ids.length) await tx.drive.updateMany({ where: { id: { in: ids }, status: "SUSPENDED" }, data: { status, suspendedFrom: null, suspendedCause: null } });
  }
  return { ids: drives.map((d) => d.id), live: drives.filter((d) => d.suspendedFrom === "LIVE").map((d) => d.id) };
}

function mostReported(reasons: ReportReason[]): ReportReason {
  const counts = new Map<ReportReason, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "OTHER";
}

@Injectable()
export class ModerationService {
  constructor(
    private readonly jobs: JobsService,
    private readonly live: LiveGateway,
  ) {}

  // Open reports grouped by what they are about, the most recently reported
  // first, each with its reporter's record.
  async queue(): Promise<ModerationQueue> {
    const open = await prisma.report.findMany({
      where: { resolvedAt: null },
      include: {
        reporter: { select: { name: true } },
        drive: { select: { id: true, status: true, role: { select: { title: true } }, company: { select: { id: true, name: true, suspendedAt: true, verificationStatus: true } } } },
        candidate: { select: { id: true, user: { select: { name: true, phone: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    const history = await this.reporterHistory(open);
    const targets = new Map<string, ModerationTarget>();
    const accounts = new Map<string, Set<string>>();
    for (const report of open) {
      const key = report.driveId ? `DRIVE:${report.driveId}` : `CANDIDATE:${report.candidateId}`;
      let target = targets.get(key);
      if (!target) {
        const drive = report.drive;
        target = {
          targetType: drive ? "DRIVE" : "CANDIDATE",
          targetId: drive ? drive.id : report.candidateId!,
          title: drive ? drive.role.title : report.candidate!.user.name,
          subtitle: drive ? drive.company.name : report.candidate!.user.phone,
          companyId: drive?.company.id ?? null,
          driveStatus: drive?.status ?? null,
          companySuspended: drive ? drive.company.suspendedAt !== null : false,
          verificationStatus: drive?.company.verificationStatus ?? null,
          latestAt: report.createdAt.toISOString(),
          accountReporters: 0,
          networkReporters: 0,
          overflow: drive ? Number((await redis.get(overflowKey(drive.id))) ?? 0) : 0,
          reasons: {},
          reports: [],
        };
        targets.set(key, target);
      }
      target.reasons[report.reason] = (target.reasons[report.reason] ?? 0) + 1;
      if (report.reporterUserId) {
        accounts.set(key, (accounts.get(key) ?? new Set()).add(report.reporterUserId));
        target.accountReporters = accounts.get(key)!.size;
      } else {
        target.networkReporters += 1;
      }
      target.reports.push({
        id: report.id,
        reason: report.reason,
        details: report.details,
        createdAt: report.createdAt.toISOString(),
        reporter: report.reporterUserId
          ? { kind: "account", name: report.reporter?.name ?? null, ...history.get(`u:${report.reporterUserId}`)! }
          : { kind: "network", name: null, ...history.get(`n:${report.reporterNetwork}`)! },
      });
    }

    const [suspendedDrives, suspendedCompanies, recent] = await Promise.all([
      prisma.drive.findMany({
        where: { status: "SUSPENDED", suspendedCause: "DRIVE" },
        select: { id: true, role: { select: { title: true } }, company: { select: { name: true } }, moderationActions: { where: { kind: "SUSPEND_DRIVE" }, orderBy: { createdAt: "desc" }, take: 1 } },
      }),
      prisma.company.findMany({ where: { suspendedAt: { not: null } }, select: { id: true, name: true, suspendedAt: true } }),
      prisma.moderationAction.findMany({
        include: { admin: { select: { name: true } }, drive: { select: { role: { select: { title: true } } } }, company: { select: { name: true } }, candidate: { select: { user: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
        take: RECENT_ACTIONS,
      }),
    ]);

    return moderationQueueSchema.parse({
      targets: [...targets.values()],
      suspended: [
        ...suspendedCompanies.map((c) => ({ kind: "COMPANY", id: c.id, title: c.name, since: c.suspendedAt!.toISOString() })),
        ...suspendedDrives.map((d) => ({
          kind: "DRIVE",
          id: d.id,
          title: `${d.role.title} · ${d.company.name}`,
          since: (d.moderationActions[0]?.createdAt ?? new Date()).toISOString(),
        })),
      ],
      recent: recent.map((a) => ({
        id: a.id,
        kind: a.kind,
        admin: a.admin.name,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
        target: a.drive?.role.title ?? a.company?.name ?? a.candidate?.user.name ?? "",
      })),
    });
  }

  // Everything this reporter has ever reported and how it was decided, so
  // someone whose reports are always dismissed stands out.
  private async reporterHistory(reports: { reporterUserId: string | null; reporterNetwork: string | null }[]) {
    const users = [...new Set(reports.flatMap((r) => (r.reporterUserId ? [r.reporterUserId] : [])))];
    const networks = [...new Set(reports.flatMap((r) => (r.reporterNetwork ? [r.reporterNetwork] : [])))];
    const [byUser, byNetwork] = await Promise.all([
      prisma.report.groupBy({ by: ["reporterUserId", "outcome"], where: { reporterUserId: { in: users } }, _count: { _all: true } }),
      prisma.report.groupBy({ by: ["reporterNetwork", "outcome"], where: { reporterNetwork: { in: networks } }, _count: { _all: true } }),
    ]);
    const history = new Map<string, { total: number; dismissed: number; actioned: number }>();
    const add = (key: string, outcome: string | null, count: number) => {
      const h = history.get(key) ?? { total: 0, dismissed: 0, actioned: 0 };
      h.total += count;
      if (outcome === "DISMISSED") h.dismissed += count;
      if (outcome === "ACTIONED") h.actioned += count;
      history.set(key, h);
    };
    for (const row of byUser) add(`u:${row.reporterUserId}`, row.outcome, row._count._all);
    for (const row of byNetwork) add(`n:${row.reporterNetwork}`, row.outcome, row._count._all);
    return history;
  }

  async act(adminId: string, input: Moderate): Promise<ModerationQueue> {
    const effects = await prisma.$transaction((tx) => this.apply(tx, adminId, input));
    for (const driveId of effects.suspendedLive) await this.jobs.alertBooked(driveId, "drive_suspended");
    for (const driveId of effects.liftedLive) await this.jobs.alertBooked(driveId, "drive_reinstated");
    for (const driveId of effects.touched) await this.live.publish(driveId);
    return this.queue();
  }

  private async apply(tx: Tx, adminId: string, { kind, targetType, targetId, note }: Moderate): Promise<Effects> {
    const effects: Effects = { suspendedLive: [], liftedLive: [], touched: [] };
    const drive = targetType === "DRIVE" ? await tx.drive.findUnique({ where: { id: targetId } }) : null;
    if (targetType === "DRIVE" && !drive) throw new NotFoundException(apiError("errors.drive.notFound"));
    const companyId = targetType === "COMPANY" ? targetId : drive?.companyId;
    const candidateId = targetType === "CANDIDATE" ? targetId : null;
    const fits =
      ((kind === "DISMISS" || kind === "WARN") && targetType !== "COMPANY") ||
      ((kind === "SUSPEND_DRIVE" || kind === "LIFT_DRIVE") && targetType === "DRIVE") ||
      ((kind === "SUSPEND_COMPANY" || kind === "LIFT_COMPANY") && targetType !== "CANDIDATE");
    if (!fits) throw new BadRequestException(apiError("errors.moderation.notApplicable"));

    // The reports this action answers: about this drive or candidate, or,
    // for a company suspension, about any of its drives.
    const answered: Prisma.ReportWhereInput =
      kind === "SUSPEND_COMPANY" ? { drive: { companyId } } : candidateId ? { candidateId } : { driveId: drive?.id };
    const open = kind.startsWith("LIFT") ? [] : await tx.report.findMany({ where: { ...answered, resolvedAt: null }, select: { id: true, reason: true } });

    const action = await tx.moderationAction.create({
      data: {
        kind,
        adminId,
        driveId: drive?.id ?? null,
        companyId: targetType === "COMPANY" || kind.endsWith("COMPANY") ? companyId : null,
        candidateId,
        note: note || null,
      },
    });

    if (kind === "WARN") {
      await tx.warning.create({
        data: { actionId: action.id, companyId: candidateId ? null : companyId, candidateId, reason: mostReported(open.map((r) => r.reason)), note: note || null },
      });
    } else if (kind === "SUSPEND_DRIVE") {
      const { ids, live } = await suspendDrives(tx, { id: drive!.id }, "DRIVE");
      if (ids.length === 0) throw new ConflictException(apiError("errors.moderation.notSuspendable"));
      effects.suspendedLive.push(...live);
      effects.touched.push(...ids);
    } else if (kind === "SUSPEND_COMPANY") {
      const { count } = await tx.company.updateMany({ where: { id: companyId, suspendedAt: null }, data: { suspendedAt: new Date() } });
      if (count === 0) throw new ConflictException(apiError("errors.moderation.alreadySuspended"));
      const { ids, live } = await suspendDrives(tx, { companyId }, "COMPANY");
      effects.suspendedLive.push(...live);
      effects.touched.push(...ids);
    } else if (kind === "LIFT_DRIVE") {
      if (drive!.status !== "SUSPENDED") throw new ConflictException(apiError("errors.moderation.notSuspended"));
      if (drive!.suspendedCause === "COMPANY") throw new ConflictException(apiError("errors.moderation.liftCompanyFirst"));
      const { ids, live } = await liftDrives(tx, { id: drive!.id });
      if (ids.length === 0) throw new ConflictException(apiError("errors.moderation.endedWhileSuspended"));
      effects.liftedLive.push(...live);
      effects.touched.push(...ids);
    } else if (kind === "LIFT_COMPANY") {
      const { count } = await tx.company.updateMany({ where: { id: companyId, suspendedAt: { not: null } }, data: { suspendedAt: null } });
      if (count === 0) throw new ConflictException(apiError("errors.moderation.notSuspended"));
      const { ids, live } = await liftDrives(tx, { companyId, suspendedCause: "COMPANY" });
      effects.liftedLive.push(...live);
      effects.touched.push(...ids);
    }

    if (open.length) {
      await tx.report.updateMany({
        where: { id: { in: open.map((r) => r.id) } },
        data: { resolvedAt: new Date(), outcome: kind === "DISMISS" ? "DISMISSED" : "ACTIONED", actionId: action.id },
      });
    }
    const [entityType, entityId] = candidateId ? ["candidate", candidateId] : kind.endsWith("COMPANY") || targetType === "COMPANY" ? ["company", companyId!] : ["drive", drive!.id];
    await audit(tx, adminId, entityType, entityId, kind, { actionId: action.id, reports: open.length, ...(note ? { note } : {}) });
    return effects;
  }
}
