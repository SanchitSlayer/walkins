import type { Queue } from "bullmq";
import { findCandidatesForDrive, prisma } from "@walkins/db";
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
  ) {}

  // Discovery: everyone the targeting rule matches, paged until a short page
  // so no fanout is capped. Returns how many were targeted; jobs that already
  // exist are dropped by their id, so it is not a count of new jobs.
  async fanOut(driveId: string, templateKey: TemplateKey): Promise<number> {
    let targeted = 0;
    let after: { distanceMeters: number; candidateId: string } | undefined;
    for (;;) {
      const page = await this.targeting(driveId, { after, limit: this.pageSize });
      await this.enqueue(page.map(({ candidateId }) => ({ driveId, candidateId, templateKey })));
      targeted += page.length;
      if (page.length < this.pageSize) return targeted;
      after = page[page.length - 1];
    }
  }

  // Commitment: only people who said they'd come. Targeting would be wrong
  // here twice over; it matches strangers, and leaves out applicants.
  async remindConfirmed(driveId: string): Promise<number> {
    const confirmed = await prisma.application.findMany({
      where: { driveId, state: "CONFIRMED" },
      select: { candidateId: true },
    });
    await this.enqueue(confirmed.map(({ candidateId }) => ({ driveId, candidateId, templateKey: "drive_morning_of" })));
    return confirmed.length;
  }

  private async enqueue(jobs: AlertJob[]) {
    if (jobs.length === 0) return;
    await this.queue.addBulk(jobs.map((data) => ({ name: data.templateKey, data, opts: { jobId: alertJobId(data) } })));
  }
}
