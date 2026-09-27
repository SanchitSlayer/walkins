import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@walkins/db";
import {
  DeliveryOutcomeUnknownError,
  type NotificationChannel,
  RecipientUnreachableError,
  type SendResult,
  type TemplatedMessage,
} from "@walkins/shared";
import { processAlert, type ProcessDeps } from "../src/alerts/process-alert";
import { ChannelResolver } from "../src/channels/channel-resolver";
import type { AlertJob } from "../src/queues";

// Runs against the real database because the claim index is the guarantee
// under test; the fixtures below are created here and removed afterwards.
class RecordingChannel implements NotificationChannel {
  readonly name = "recording";
  sent: TemplatedMessage[] = [];
  failures: Error[] = [];

  isAvailable(): boolean {
    return true;
  }

  async send(_recipient: unknown, message: TemplatedMessage): Promise<SendResult> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push(message);
    return { providerMessageId: String(this.sent.length) };
  }
}

const ids = { company: "", user: "", candidate: "", drive: "" };
let channel: RecordingChannel;
let deps: ProcessDeps;
let job: AlertJob;

beforeAll(async () => {
  const city = await prisma.city.findFirstOrThrow({ where: { name: "Bengaluru" } });
  const role = await prisma.role.findFirstOrThrow();
  const company = await prisma.company.create({
    data: { name: "Alerts Test Company", contactPhone: "9000000001", cityId: city.id, verificationStatus: "VERIFIED" },
  });
  const user = await prisma.user.create({ data: { phone: `99${Date.now()}`, name: "Alerts Test", role: "CANDIDATE" } });
  const candidate = await prisma.candidate.create({
    data: {
      userId: user.id,
      cityId: city.id,
      homeLat: city.centerLat,
      homeLng: city.centerLng,
      maxTravelKm: 10,
      experienceYears: 1,
    },
  });
  const startsAt = new Date(Date.now() + 24 * 3600_000);
  const drive = await prisma.drive.create({
    data: {
      companyId: company.id,
      roleId: role.id,
      cityId: city.id,
      salaryMin: 15000,
      salaryMax: 20000,
      venueAddress: "Alerts Test Venue",
      venueLat: city.centerLat + 0.01,
      venueLng: city.centerLng,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 3600_000),
      capacity: 10,
      experienceMin: 0,
      experienceMax: 5,
      status: "LIVE",
    },
  });
  Object.assign(ids, { company: company.id, user: user.id, candidate: candidate.id, drive: drive.id });
  job = { driveId: drive.id, candidateId: candidate.id, templateKey: "drive_48h" };
});

beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { driveId: ids.drive } });
  await prisma.drive.update({ where: { id: ids.drive }, data: { status: "LIVE" } });
  channel = new RecordingChannel();
  deps = {
    resolver: new ChannelResolver([channel]),
    webUrl: "http://localhost:3000",
    onRateLimited: async () => new Error("rate limited"),
  };
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { driveId: ids.drive } });
  await prisma.drive.delete({ where: { id: ids.drive } });
  await prisma.candidate.delete({ where: { id: ids.candidate } });
  await prisma.user.delete({ where: { id: ids.user } });
  await prisma.company.delete({ where: { id: ids.company } });
  await prisma.$disconnect();
});

function rows() {
  return prisma.notification.findMany({ where: { driveId: ids.drive }, orderBy: { attempt: "asc" } });
}

describe("processAlert", () => {
  it("does not send again when a job is retried after a successful send", async () => {
    await expect(processAlert({ data: job, attemptsMade: 0 }, deps)).resolves.toBe("sent via recording");
    await expect(processAlert({ data: job, attemptsMade: 1 }, deps)).resolves.toBe("already sent");

    expect(channel.sent).toHaveLength(1);
    expect((await rows()).map((r) => r.status)).toEqual(["SENT"]);
  });

  it("sends once when two attempts race each other", async () => {
    await Promise.all([processAlert({ data: job, attemptsMade: 0 }, deps), processAlert({ data: job, attemptsMade: 0 }, deps)]);

    expect(channel.sent).toHaveLength(1);
    expect((await rows()).filter((r) => r.status === "SENT")).toHaveLength(1);
  });

  it("releases the claim after a definite failure so the retry sends exactly once", async () => {
    channel.failures.push(new Error("provider returned 500"));

    await expect(processAlert({ data: job, attemptsMade: 0 }, deps)).rejects.toThrow("provider returned 500");
    await expect(processAlert({ data: job, attemptsMade: 1 }, deps)).resolves.toBe("sent via recording");

    expect(channel.sent).toHaveLength(1);
    expect((await rows()).map((r) => [r.attempt, r.status])).toEqual([
      [1, "FAILED"],
      [2, "SENT"],
    ]);
  });

  it("keeps the claim and dead-letters the job when delivery is uncertain", async () => {
    channel.failures.push(new DeliveryOutcomeUnknownError("timed out"));

    await expect(processAlert({ data: job, attemptsMade: 0 }, deps)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(processAlert({ data: job, attemptsMade: 1 }, deps)).resolves.toBe("already sent");

    expect(channel.sent).toHaveLength(0);
    const [row] = await rows();
    expect(row.status).toBe("PENDING");
    expect(row.error).toContain("timed out");
  });

  it("does not retry a recipient the channel can no longer reach", async () => {
    channel.failures.push(new RecipientUnreachableError("bot was blocked by the user"));

    await expect(processAlert({ data: job, attemptsMade: 0 }, deps)).rejects.toBeInstanceOf(UnrecoverableError);
    expect((await rows()).map((r) => r.status)).toEqual(["FAILED"]);
  });

  it("skips and records a drive that is no longer live", async () => {
    await prisma.drive.update({ where: { id: ids.drive }, data: { status: "CANCELLED" } });

    await expect(processAlert({ data: job, attemptsMade: 0 }, deps)).resolves.toBe("skipped: drive is cancelled");
    expect(channel.sent).toHaveLength(0);
    expect((await rows()).map((r) => [r.status, r.error])).toEqual([["SKIPPED", "drive is cancelled"]]);
  });

  it("puts the role, company, pay, distance, venue and link in the message", async () => {
    await processAlert({ data: job, attemptsMade: 0 }, deps);

    const [message] = channel.sent;
    expect(message.text).toContain("at Alerts Test Company");
    expect(message.text).toContain("₹15,000–₹20,000");
    expect(message.text).toMatch(/Alerts Test Venue \(1\.1 km from your home\)/);
    expect(message.url).toBe(`http://localhost:3000/drives/${ids.drive}`);
  });
});
