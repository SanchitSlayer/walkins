import { Injectable } from "@nestjs/common";
import { prisma } from "@walkins/db";
import {
  type Analytics,
  ANALYTICS_DAYS,
  ANALYTICS_REFRESHED_KEY,
  analyticsSchema,
  type CompanySettings,
  companySettingsSchema,
  dayKey,
  type DriveStatus,
} from "@walkins/shared";
import { redis } from "../common/redis";

type FunnelRow = {
  driveId: string;
  roleTitle: string;
  startsAt: Date;
  status: DriveStatus;
  alerted: number;
  interested: number;
  confirmed: number;
  checkedIn: number;
  walkIns: number;
  hired: number;
};

@Injectable()
export class CompaniesService {
  async settings(companyId: string): Promise<CompanySettings> {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { readsLanguages: true } });
    return companySettingsSchema.parse(company);
  }

  async updateSettings(companyId: string, input: CompanySettings): Promise<CompanySettings> {
    const company = await prisma.company.update({
      where: { id: companyId },
      data: { readsLanguages: [...new Set(input.readsLanguages)] },
      select: { readsLanguages: true },
    });
    return companySettingsSchema.parse(company);
  }

  // Read from the materialised views the worker refreshes every 15 minutes,
  // never from the live tables, so a busy dashboard can't slow check-in.
  async analytics(companyId: string): Promise<Analytics> {
    const since = new Date(Date.now() - (ANALYTICS_DAYS - 1) * 24 * 3600_000);
    const [drives, daily, refreshedAt] = await Promise.all([
      prisma.$queryRaw<FunnelRow[]>`
        SELECT f."driveId", r.title AS "roleTitle", d."startsAt", d.status,
               f.alerted, f.interested, f.confirmed, f."checkedIn", f."walkIns", f.hired
        FROM drive_funnel f
        JOIN drives d ON d.id = f."driveId"
        JOIN roles r ON r.id = d."roleId"
        WHERE f."companyId" = ${companyId} AND d.status <> 'DRAFT'
        ORDER BY d."startsAt" DESC
      `,
      prisma.$queryRaw<{ day: Date; checkIns: number; hires: number }[]>`
        SELECT day, "checkIns", hires FROM company_daily
        WHERE "companyId" = ${companyId} AND day >= ${dayKey(since)}::date
      `,
      redis.get(ANALYTICS_REFRESHED_KEY),
    ]);

    // Every day in the window, including the empty ones, so the chart's
    // gaps are real zeros rather than missing points.
    const byDay = new Map(daily.map((d) => [d.day.toISOString().slice(0, 10), d]));
    const days = Array.from({ length: ANALYTICS_DAYS }, (_, i) => dayKey(new Date(since.getTime() + i * 24 * 3600_000)));
    return analyticsSchema.parse({
      refreshedAt,
      drives: drives.map((d) => ({
        ...d,
        startsAt: d.startsAt.toISOString(),
        showUpRate: d.confirmed > 0 ? d.checkedIn / d.confirmed : null,
      })),
      daily: days.map((day) => ({ day, checkIns: byDay.get(day)?.checkIns ?? 0, hires: byDay.get(day)?.hires ?? 0 })),
    });
  }
}
