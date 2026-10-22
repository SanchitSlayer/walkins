import type { Queue } from "bullmq";
import { alertLimitForDrive, findCandidatesForDrive, prisma } from "@walkins/db";
import { type AlertJob, alertJobId, type TemplateKey } from "@walkins/shared";

const PAGE_SIZE = 500;

// Decides who hears about a drive and queues one job each. It never sends:
// the alerts queue owns delivery, retries and throttling, the same way
// targeting owns who matches and knows nothing about how they're reached.
export class AlertService {
  constructor(
    private readonly queue: Queue<AlertJob>,
    private readonly targeting: typeof findCandidatesForDrive = findCandidatesForDrive,
    private readonly pageSize = PAGE_SIZE,
    private readonly limitFor: typeof alertLimitForDrive = alertLimitForDrive,
  ) {}

  // Discovery: everyone the targeting rule matches, nearest first, paged
  // until a short page. Only an unverified company's drive stops early, at
  // its limit. Returns how many were targeted; jobs that already exist are
  // dropped by their id, so it is not a count of new jobs.
  async fanOut(driveId: string, templateKey: TemplateKey): Promise<number> {
    const limit = (await this.limitFor(driveId)) ?? Infinity;
    let targeted = 0;
    let after: { distanceMeters: number; candidateId: string } | undefined;
    while (targeted < limit) {
      const size = Math.min(this.pageSize, limit - targeted);
      const page = await this.targeting(driveId, { after, limit: size });
      await this.enqueue(page.map(({ candidateId }) => ({ driveId, candidateId, templateKey })));
      targeted += page.length;
      if (page.length < size) break;
      after = page[page.length - 1];
    }
    return targeted;
  }

  // Commitment: only people who said they'd come. Targeting would be wrong
  // here twice over; it matches strangers, and leaves out applicants.
  // Versioned by the drive's schedule: the reminder for a drive moved to
  // another day is a new alert, not the one already sent for the old day.
  async remindConfirmed(driveId: string): Promise<number> {
    const [{ scheduleVersion }, confirmed] = await Promise.all([
      prisma.drive.findUniqueOrThrow({ where: { id: driveId }, select: { scheduleVersion: true } }),
      prisma.application.findMany({ where: { driveId, state: "CONFIRMED" }, select: { candidateId: true } }),
    ]);
    await this.enqueue(confirmed.map(({ candidateId }) => ({ driveId, candidateId, templateKey: "drive_morning_of", scheduleVersion })));
    return confirmed.length;
  }

  private async enqueue(jobs: AlertJob[]) {
    if (jobs.length === 0) return;
    await this.queue.addBulk(jobs.map((data) => ({ name: data.templateKey, data, opts: { jobId: alertJobId(data) } })));
  }
}
