import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApplication, prisma, transitionApplication } from "@walkins/db";
import type { NotificationChannel, SendResult, TemplatedMessage } from "@walkins/shared";
import { AlertService } from "../src/alerts/alert-service";
import { processAlert, type ProcessDeps } from "../src/alerts/process-alert";
import { ChannelResolver } from "../src/channels/channel-resolver";
import { markNoShows } from "../src/maintenance/maintenance-jobs";
import { createAlertsQueue } from "../src/queues";
import { connection } from "../src/redis";

// Real rows, created here and removed afterwards: the paths under test read
// applications and move them through the transition function.
class RecordingChannel implements NotificationChannel {
  readonly name = "recording";
  sent: TemplatedMessage[] = [];

  isAvailable(): boolean {
    return true;
  }

  async send(_recipient: unknown, message: TemplatedMessage): Promise<SendResult> {
    this.sent.push(message);
    return { providerMessageId: String(this.sent.length) };
  }
}

const queue = createAlertsQueue(connection, `test-reminders-${process.pid}-${Date.now()}`);
const ids = { company: "", users: [] as string[], confirmed: "", withdrawn: "", liveDrive: "", endedDrive: "", liveSlot: "", endedSlot: "" };
let channel: RecordingChannel;
let deps: ProcessDeps;

function randomPhone() {
  return `8${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
}

beforeAll(async () => {
  const city = await prisma.city.findFirstOrThrow({ where: { name: "Bengaluru" } });
  const role = await prisma.role.findFirstOrThrow();
  const company = await prisma.company.create({
    data: { name: "Reminder Test Company", contactPhone: randomPhone(), cityId: city.id, verificationStatus: "VERIFIED" },
  });
  const makeCandidate = async (name: string) => {
    const user = await prisma.user.create({ data: { phone: randomPhone(), name, role: "CANDIDATE" } });
    ids.users.push(user.id);
    const candidate = await prisma.candidate.create({
      data: { userId: user.id, cityId: city.id, homeLat: city.centerLat, homeLng: city.centerLng, maxTravelKm: 10, experienceYears: 1 },
    });
    return { userId: user.id, candidateId: candidate.id };
  };
  const confirmed = await makeCandidate("Reminder Test Confirmed");
  const withdrawn = await makeCandidate("Reminder Test Withdrawn");

  const driveData = (startsAt: Date, status: "LIVE" | "EXPIRED") => ({
    companyId: company.id,
    roleId: role.id,
    cityId: city.id,
    salaryMin: 15000,
    salaryMax: 20000,
    venueAddress: "Reminder Test Venue",
    venueLat: city.centerLat + 0.01,
    venueLng: city.centerLng,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3 * 3600_000),
    capacity: 5,
    experienceMin: 0,
    experienceMax: 5,
    status,
    slots: { create: [{ startsAt, capacity: 5 }] },
  });
  const liveDrive = await prisma.drive.create({
    data: driveData(new Date(Date.now() + 2 * 3600_000), "LIVE"),
    include: { slots: true },
  });
  const endedDrive = await prisma.drive.create({
    data: driveData(new Date(Date.now() - 6 * 3600_000), "EXPIRED"),
    include: { slots: true },
  });

  const asCandidate = (userId: string) => ({ kind: "candidate" as const, userId });
  await prisma.$transaction(async (tx) => {
    await createApplication(tx, {
      driveId: liveDrive.id,
      candidateId: confirmed.candidateId,
      to: "CONFIRMED",
      slotId: liveDrive.slots[0].id,
      actor: asCandidate(confirmed.userId),
    });
    const second = await createApplication(tx, {
      driveId: liveDrive.id,
      candidateId: withdrawn.candidateId,
      to: "CONFIRMED",
      slotId: liveDrive.slots[0].id,
      actor: asCandidate(withdrawn.userId),
    });
    await transitionApplication(tx, { applicationId: second.id, to: "WITHDRAWN", actor: asCandidate(withdrawn.userId) });
    await createApplication(tx, {
      driveId: endedDrive.id,
      candidateId: confirmed.candidateId,
      to: "CONFIRMED",
      slotId: endedDrive.slots[0].id,
      actor: asCandidate(confirmed.userId),
    });
  });

  Object.assign(ids, {
    company: company.id,
    confirmed: confirmed.candidateId,
    withdrawn: withdrawn.candidateId,
    liveDrive: liveDrive.id,
    endedDrive: endedDrive.id,
    liveSlot: liveDrive.slots[0].id,
    endedSlot: endedDrive.slots[0].id,
  });
});

beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { driveId: { in: [ids.liveDrive, ids.endedDrive] } } });
  channel = new RecordingChannel();
  deps = { resolver: new ChannelResolver([channel]), webUrl: "http://localhost:3000", onRateLimited: async () => new Error("rate limited") };
});

afterAll(async () => {
  const driveIds = [ids.liveDrive, ids.endedDrive];
  const applications = await prisma.application.findMany({ where: { driveId: { in: driveIds } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: applications.map((a) => a.id) } } });
  await prisma.notification.deleteMany({ where: { driveId: { in: driveIds } } });
  await prisma.application.deleteMany({ where: { driveId: { in: driveIds } } });
  await prisma.driveSlot.deleteMany({ where: { driveId: { in: driveIds } } });
  await prisma.drive.deleteMany({ where: { id: { in: driveIds } } });
  await prisma.candidate.deleteMany({ where: { id: { in: [ids.confirmed, ids.withdrawn] } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  await prisma.company.delete({ where: { id: ids.company } });
  await queue.obliterate({ force: true });
  await queue.close();
  await prisma.$disconnect();
  connection.disconnect();
});

describe("alerts once candidates apply", () => {
  it("skips a queued discovery alert for someone who has since applied", async () => {
    const job = { driveId: ids.liveDrive, candidateId: ids.confirmed, templateKey: "drive_48h" as const };

    await expect(processAlert({ data: job, attemptsMade: 0 }, deps)).resolves.toBe("skipped: candidate has since applied");
    expect(channel.sent).toHaveLength(0);
  });

  it("reminds a confirmed candidate on the day, in the reminder's own words and with their slot", async () => {
    const job = { driveId: ids.liveDrive, candidateId: ids.confirmed, templateKey: "drive_morning_of" as const };

    await expect(processAlert({ data: job, attemptsMade: 0 }, deps)).resolves.toBe("sent via recording");

    const [message] = channel.sent;
    expect(message.templateKey).toBe("drive_morning_of");
    expect(message.text).toMatch(/^Reminder: your walk-in interview is today/);
    expect(message.text).toMatch(/Your slot: \d\d:\d\d/);
    expect(message.text).toContain("because you confirmed you'd attend");
    expect(message.text).not.toContain("New walk-in near you");
  });

  it("sends no reminder to someone who withdrew", async () => {
    const job = { driveId: ids.liveDrive, candidateId: ids.withdrawn, templateKey: "drive_morning_of" as const };

    await expect(processAlert({ data: job, attemptsMade: 0 }, deps)).resolves.toBe("skipped: candidate is no longer confirmed");
    expect(channel.sent).toHaveLength(0);
  });

  it("queues reminders only for confirmed candidates", async () => {
    const alerts = new AlertService(queue);

    await expect(alerts.remindConfirmed(ids.liveDrive)).resolves.toBe(1);
    const jobs = await queue.getJobs(["waiting"]);
    expect(jobs.map((job) => job.id)).toEqual([`alert.${ids.liveDrive}.${ids.confirmed}.drive_morning_of`]);
  });
});

describe("marking no-shows after a drive", () => {
  it("moves unattended confirmations through the state machine and keeps the booked count", async () => {
    const result = await markNoShows();

    expect(result.noShows).toBe(1);
    const application = await prisma.application.findFirstOrThrow({
      where: { driveId: ids.endedDrive, candidateId: ids.confirmed },
    });
    expect(application.state).toBe("NO_SHOW");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: application.id, action: "CONFIRMED->NO_SHOW" } });
    expect(audit.actorUserId).toBeNull();
    expect(audit.after).toMatchObject({ actor: "system" });
    const slot = await prisma.driveSlot.findUniqueOrThrow({ where: { id: ids.endedSlot } });
    expect(slot.bookedCount).toBe(1);
  });
});
