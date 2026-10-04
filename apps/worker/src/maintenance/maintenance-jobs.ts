import type { Queue } from "bullmq";
import { prisma, StaleTransitionError, transitionApplication } from "@walkins/db";
import { dayKey, type EmbedJob } from "@walkins/shared";
import type { AlertService } from "../alerts/alert-service";

export type MaintenanceDeps = {
  alerts: AlertService;
  removeObject: (key: string) => Promise<void>;
  reembed: (job: EmbedJob) => Promise<void>;
};

// Every drive is in India, so "daily at 07:00" means 07:00 there, whatever
// zone the worker's host happens to run in.
const SCHEDULE_TZ = "Asia/Kolkata";
const ALERT_WINDOW_MS = 48 * 3600_000;
const VOICE_RETENTION_MS = 180 * 24 * 3600_000;

const SCHEDULES = [
  { name: "scan-upcoming-drives", pattern: "*/15 * * * *" },
  { name: "morning-reminders", pattern: "0 7 * * *" },
  { name: "expire-drives", pattern: "30 0 * * *" },
  { name: "recompute-reliability", pattern: "0 1 * * *" },
];

// Upserting by a fixed id keeps exactly one scheduler per job however many
// times the worker restarts.
export async function registerSchedules(queue: Queue) {
  for (const { name, pattern } of SCHEDULES) {
    await queue.upsertJobScheduler(name, { pattern, tz: SCHEDULE_TZ }, { name });
  }
}

// Includes drives already under way but not over, and ones approved with
// less than 48 hours to go: a late alert still gets someone to a walk-in.
async function scanUpcomingDrives(alerts: AlertService): Promise<string> {
  const now = new Date();
  const drives = await prisma.drive.findMany({
    where: {
      status: "LIVE",
      endsAt: { gt: now },
      startsAt: { lte: new Date(now.getTime() + ALERT_WINDOW_MS) },
      notifications: { none: { templateKey: "drive_48h" } },
    },
    select: { id: true },
  });
  let targeted = 0;
  for (const { id } of drives) targeted += await alerts.fanOut(id, "drive_48h");
  return `${drives.length} drives, ${targeted} candidates targeted`;
}

async function sendMorningReminders(alerts: AlertService): Promise<string> {
  const now = new Date();
  const startOfToday = new Date(`${dayKey(now)}T00:00:00+05:30`);
  const drives = await prisma.drive.findMany({
    where: {
      status: "LIVE",
      endsAt: { gt: now },
      startsAt: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 24 * 3600_000) },
    },
    select: { id: true },
  });
  let targeted = 0;
  for (const { id } of drives) targeted += await alerts.remindConfirmed(id);
  return `${drives.length} drives, ${targeted} confirmed candidates to remind`;
}

// Each no-show goes through the same transition function as every other
// state change, one transaction apiece, so each gets its audit row and a
// candidate checked in by the desk at the last second is skipped rather than
// overwritten. bookedCount is left alone: it is the record of what was
// booked, which is what an employer looking back at a drive needs to see.
export async function markNoShows(): Promise<{ noShows: number; changedMeanwhile: number }> {
  const unattended = await prisma.application.findMany({
    where: { state: "CONFIRMED", checkIn: { is: null }, drive: { status: "EXPIRED" } },
    select: { id: true },
  });

  let noShows = 0;
  let changedMeanwhile = 0;
  for (const { id } of unattended) {
    try {
      await prisma.$transaction((tx) =>
        transitionApplication(tx, { applicationId: id, to: "NO_SHOW", actor: { kind: "system", userId: null } }),
      );
      noShows += 1;
    } catch (err) {
      if (!(err instanceof StaleTransitionError)) throw err;
      changedMeanwhile += 1;
    }
  }
  return { noShows, changedMeanwhile };
}

// A recording is someone's voice, so it is kept only while it is their
// current intro, and never past 180 days. The object goes first: a row left
// behind by a crash is retried tomorrow, an object left behind would not be.
export async function purgeVoiceIntros(deps: Pick<MaintenanceDeps, "removeObject" | "reembed">, now = new Date()) {
  const expired = await prisma.voiceIntro.findMany({
    where: { OR: [{ replacedAt: { not: null } }, { createdAt: { lt: new Date(now.getTime() - VOICE_RETENTION_MS) } }] },
    select: { id: true, candidateId: true, objectKey: true, replacedAt: true },
  });
  for (const intro of expired) {
    await deps.removeObject(intro.objectKey);
    await prisma.voiceIntro.delete({ where: { id: intro.id } });
    // Their transcript was part of their embedding; without it they are
    // placed by roles and experience alone again.
    if (!intro.replacedAt) await deps.reembed({ kind: "candidate", id: intro.candidateId });
  }
  return expired.length;
}

// Rows created before matching existed, or whose embed job ran out of
// attempts, have no vector and rank by distance only until this runs.
export async function backfillEmbeddings(reembed: MaintenanceDeps["reembed"]): Promise<number> {
  const [candidates, drives] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`SELECT id FROM candidates WHERE embedding IS NULL`,
    prisma.$queryRaw<{ id: string }[]>`SELECT id FROM drives WHERE embedding IS NULL`,
  ]);
  for (const { id } of candidates) await reembed({ kind: "candidate", id });
  for (const { id } of drives) await reembed({ kind: "drive", id });
  return candidates.length + drives.length;
}

async function expireDrives(deps: MaintenanceDeps): Promise<string> {
  const drives = await prisma.drive.updateMany({
    where: { status: "LIVE", endsAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  const { noShows, changedMeanwhile } = await markNoShows();
  const recordings = await purgeVoiceIntros(deps);
  return `${drives.count} drives expired, ${noShows} confirmed applications marked no-show, ${changedMeanwhile} changed meanwhile, ${recordings} voice recordings deleted`;
}

// REJECTED is left out of both counts: it can come before or after an
// interview, so it can't be read as attended or not, and a smaller sample
// beats a score that means two things.
async function recomputeReliability(): Promise<string> {
  const updated = await prisma.$executeRaw`
    WITH counts AS (
      SELECT
        a."candidateId",
        count(*) FILTER (WHERE a.state IN ('CHECKED_IN', 'INTERVIEWED', 'HIRED')) AS attended,
        count(*) FILTER (
          WHERE a.state IN ('CHECKED_IN', 'INTERVIEWED', 'HIRED', 'NO_SHOW')
             OR (a.state = 'CONFIRMED' AND d."endsAt" <= (now() AT TIME ZONE 'UTC'))
        ) AS confirmed
      FROM applications a
      JOIN drives d ON d.id = a."driveId"
      GROUP BY a."candidateId"
    )
    UPDATE candidates c
    SET reliability = CASE WHEN counts.confirmed > 0 THEN counts.attended::float / counts.confirmed END,
        "reliabilityUpdatedAt" = now() AT TIME ZONE 'UTC'
    FROM counts
    WHERE counts."candidateId" = c.id
  `;
  return `${updated} candidates rescored`;
}

export function runMaintenance(name: string, deps: MaintenanceDeps): Promise<string> {
  switch (name) {
    case "scan-upcoming-drives":
      return scanUpcomingDrives(deps.alerts);
    case "morning-reminders":
      return sendMorningReminders(deps.alerts);
    case "expire-drives":
      return expireDrives(deps);
    case "recompute-reliability":
      return recomputeReliability();
    default:
      throw new Error(`Unknown maintenance job "${name}"`);
  }
}
