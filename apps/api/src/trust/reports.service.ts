import { createHmac } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@walkins/db";
import type { CandidateReport, DriveReport } from "@walkins/shared";
import { apiError } from "../common/api-error";
import { redis } from "../common/redis";
import { requireCompanyAccess } from "../common/require-company";

const DAY_MS = 24 * 3600_000;

// Past this many logged-out reports about one drive in a day, more are
// counted rather than stored, so the table can't be filled from outside. A
// real scam drive is long since in the queue by then.
export const ANONYMOUS_REPORTS_PER_DRIVE_PER_DAY = 200;

export function overflowKey(driveId: string) {
  return `report-overflow:${driveId}`;
}

// A keyed hash of the address: one network's reports group together, and
// the address itself is never stored. Keyed so the hash can't be reversed
// by hashing every IPv4 address.
export function networkOf(ip: string): string {
  return createHmac("sha256", process.env.JWT_SECRET ?? "").update(`report-network:${ip}`).digest("hex").slice(0, 32);
}

export type ReportReceipt = { received: true };

// A report never changes anything by itself: it waits in the moderation
// queue for an admin. Every path below answers "received" the same way, so
// a script can't tell which of its reports were kept.
@Injectable()
export class ReportsService {
  async reportDrive(driveId: string, input: DriveReport, userId: string | null, ip: string): Promise<ReportReceipt> {
    const drive = await prisma.drive.findFirst({ where: { id: driveId, status: { in: ["LIVE", "EXPIRED", "SUSPENDED"] } }, select: { id: true } });
    if (!drive) throw new NotFoundException(apiError("errors.drive.notFound"));
    if (input.website) return { received: true };

    const reporter = userId ? { reporterUserId: userId } : { reporterNetwork: networkOf(ip) };
    const since = new Date(Date.now() - DAY_MS);
    const repeat = await prisma.report.count({ where: { driveId, reason: input.reason, createdAt: { gte: since }, ...reporter } });
    if (repeat > 0) return { received: true };

    if (!userId) {
      const anonymous = await prisma.report.count({ where: { driveId, reporterUserId: null, createdAt: { gte: since } } });
      if (anonymous >= ANONYMOUS_REPORTS_PER_DRIVE_PER_DAY) {
        await redis.multi().incr(overflowKey(driveId)).expire(overflowKey(driveId), 7 * 24 * 3600).exec();
        return { received: true };
      }
    }

    await prisma.report.create({ data: { targetType: "DRIVE", driveId, reason: input.reason, details: input.details || null, ...reporter } });
    return { received: true };
  }

  // Anyone at the company may report someone they met through a drive.
  async reportCandidate(userId: string, input: CandidateReport): Promise<ReportReceipt> {
    const { companyId } = await requireCompanyAccess(userId, "read");
    const application = await prisma.application.findFirst({ where: { id: input.applicationId, drive: { companyId } }, select: { candidateId: true } });
    if (!application) throw new NotFoundException(apiError("errors.application.notFound"));
    const { candidateId } = application;
    const repeat = await prisma.report.count({
      where: { candidateId, reporterUserId: userId, reason: input.reason, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
    if (repeat === 0) {
      await prisma.report.create({
        data: { targetType: "CANDIDATE", candidateId, reason: input.reason, details: input.details || null, reporterUserId: userId },
      });
    }
    return { received: true };
  }
}
