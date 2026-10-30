import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@walkins/db";
import {
  type AlertJob,
  formatWhen,
  OFFERED_LOCALES,
  DeliveryOutcomeUnknownError,
  type NotificationChannel,
  RecipientUnreachableError,
  type SendResult,
  type TemplatedMessage,
} from "@walkins/shared";
import { processAlert, type ProcessDeps } from "../src/alerts/process-alert";
import { ChannelResolver } from "../src/channels/channel-resolver";
import { sweepMessages } from "../src/maintenance/maintenance-jobs";

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

const ids = { company: "", owner: "", user: "", candidate: "", drive: "" };
let channel: RecordingChannel;
let deps: ProcessDeps;
let job: AlertJob;

beforeAll(async () => {
  const city = await prisma.city.findFirstOrThrow({ where: { name: "Bengaluru" } });
  const role = await prisma.role.findFirstOrThrow();
  const company = await prisma.company.create({
    data: { name: "Alerts Test Company", contactPhone: "9000000001", cityId: city.id, verificationStatus: "VERIFIED" },
  });
  const owner = await prisma.user.create({
    data: { phone: `98${Date.now()}`, name: "Alerts Test Owner", role: "EMPLOYER", companyId: company.id, companyRole: "OWNER" },
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
      ownerId: owner.id,
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
  Object.assign(ids, { company: company.id, owner: owner.id, user: user.id, candidate: candidate.id, drive: drive.id });
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
  await prisma.application.deleteMany({ where: { driveId: ids.drive } });
  await prisma.drive.delete({ where: { id: ids.drive } });
  await prisma.candidate.delete({ where: { id: ids.candidate } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.user, ids.owner] } } });
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

  it("tells a rejected candidate not to travel, and points them to other drives", async () => {
    const rejected: AlertJob = { ...job, templateKey: "application_rejected" };
    const application = await prisma.application.create({
      data: { driveId: ids.drive, candidateId: ids.candidate, state: "CONFIRMED" },
    });

    await expect(processAlert({ data: rejected, attemptsMade: 0 }, deps)).resolves.toBe("skipped: application is no longer rejected");

    await prisma.notification.deleteMany({ where: { driveId: ids.drive } });
    await prisma.application.update({ where: { id: application.id }, data: { state: "REJECTED" } });
    await expect(processAlert({ data: rejected, attemptsMade: 0 }, deps)).resolves.toBe("sent via recording");

    const [message] = channel.sent;
    expect(message.text).toContain("isn't taking your application forward");
    expect(message.text).toContain("please don't travel");
    expect(message.url).toBe("http://localhost:3000/");
    await prisma.application.delete({ where: { id: application.id } });
  });

  it("ends every alert with the never-pay warning and where to report", async () => {
    await processAlert({ data: job, attemptsMade: 0 }, deps);

    const [message] = channel.sent;
    expect(message.text).toContain("Walkins never charges candidates");
    expect(message.text).toContain(`http://localhost:3000/drives/${ids.drive}#report`);
  });

  // The language is read when the alert is sent, from the person: nothing in
  // the queued job carries it. The links matter even before the wording is
  // translated, since offline nothing can redirect a Hindi reader. A saved
  // Hindi choice reads as English until Hindi is offered; the gate is read
  // once, at start, so run with WALKINS_OFFER_HINDI=1 as well.
  const hindi = OFFERED_LOCALES.includes("hi") ? "/hi" : "";
  it(`sends the links of a reader who saved Hindi to the ${hindi ? "Hindi" : "English"} pages while Hindi is ${hindi ? "" : "not "}offered`, async () => {
    await prisma.user.update({ where: { id: ids.user }, data: { locale: "hi" } });
    await processAlert({ data: job, attemptsMade: 0 }, deps);
    await prisma.user.update({ where: { id: ids.user }, data: { locale: "en" } });

    const [message] = channel.sent;
    expect(message.url).toBe(`http://localhost:3000${hindi}/drives/${ids.drive}`);
    expect(message.text).toContain(`http://localhost:3000${hindi}/drives/${ids.drive}#report`);
  });

  it("tells a booked candidate a suspended drive is paused, and not anyone once it is back on", async () => {
    const suspended: AlertJob = { ...job, templateKey: "drive_suspended" };
    const application = await prisma.application.create({ data: { driveId: ids.drive, candidateId: ids.candidate, state: "CONFIRMED" } });

    await expect(processAlert({ data: suspended, attemptsMade: 0 }, deps)).resolves.toBe("skipped: drive is live");

    await prisma.notification.deleteMany({ where: { driveId: ids.drive } });
    await prisma.drive.update({ where: { id: ids.drive }, data: { status: "SUSPENDED" } });
    await expect(processAlert({ data: suspended, attemptsMade: 0 }, deps)).resolves.toBe("sent via recording");

    const [message] = channel.sent;
    expect(message.text).toContain("paused while Walkins checks it");
    expect(message.text).toContain("You haven't done anything wrong");
    expect(message.text).toContain("Walkins never charges candidates");
    await prisma.application.delete({ where: { id: application.id } });
  });

  it("tells a booked candidate a cancelled drive won't count against them, and nobody who released their seat", async () => {
    const cancelled: AlertJob = { ...job, templateKey: "drive_cancelled" };
    await prisma.drive.update({ where: { id: ids.drive }, data: { status: "CANCELLED" } });
    const application = await prisma.application.create({ data: { driveId: ids.drive, candidateId: ids.candidate, state: "WITHDRAWN" } });

    await expect(processAlert({ data: cancelled, attemptsMade: 0 }, deps)).resolves.toBe("skipped: candidate is no longer confirmed");

    await prisma.notification.deleteMany({ where: { driveId: ids.drive } });
    await prisma.application.update({ where: { id: application.id }, data: { state: "CONFIRMED" } });
    await expect(processAlert({ data: cancelled, attemptsMade: 0 }, deps)).resolves.toBe("sent via recording");

    const [message] = channel.sent;
    expect(message.text).toContain("won't count against you");
    expect(message.url).toBe("http://localhost:3000/");
    await prisma.application.delete({ where: { id: application.id } });
  });

  it("asks a hired candidate whether they started, after the joining date, and not once they've answered", async () => {
    await prisma.drive.update({ where: { id: ids.drive }, data: { status: "EXPIRED" } });
    const application = await prisma.application.create({ data: { driveId: ids.drive, candidateId: ids.candidate, state: "HIRED" } });
    const outcome = await prisma.hiringOutcome.create({
      data: { applicationId: application.id, hiredAt: new Date(), joiningDate: new Date(Date.now() - 24 * 3600_000) },
    });
    const ask: AlertJob = { ...job, templateKey: "joining_check" };

    await expect(processAlert({ data: ask, attemptsMade: 0 }, deps)).resolves.toBe("sent via recording");
    expect(channel.sent[0].text).toContain("Did you start?");
    expect(channel.sent[0].text).toContain("doesn't count towards anything else");
    expect(channel.sent[0].url).toBe("http://localhost:3000/my-drives");

    await prisma.notification.deleteMany({ where: { driveId: ids.drive } });
    await prisma.hiringOutcome.update({ where: { id: outcome.id }, data: { candidateStarted: true } });
    await expect(processAlert({ data: ask, attemptsMade: 0 }, deps)).resolves.toBe("skipped: candidate has already answered");

    await prisma.hiringOutcome.delete({ where: { id: outcome.id } });
    await prisma.application.delete({ where: { id: application.id } });
  });

  describe("a message's Telegram copy", () => {
    let thread: { id: string };
    let applicationId: string;

    beforeAll(async () => {
      const application = await prisma.application.create({ data: { driveId: ids.drive, candidateId: ids.candidate, state: "CONFIRMED" } });
      applicationId = application.id;
      thread = await prisma.messageThread.create({ data: { applicationId } });
    });

    afterAll(async () => {
      await prisma.report.deleteMany({ where: { message: { threadId: thread.id } } });
      await prisma.notification.deleteMany({ where: { messageId: { not: null }, driveId: ids.drive } });
      await prisma.message.deleteMany({ where: { threadId: thread.id } });
      await prisma.messageThread.delete({ where: { id: thread.id } });
      await prisma.application.delete({ where: { id: applicationId } });
    });

    async function message(seq: number, body: string, moneyFlag = false) {
      return prisma.message.create({ data: { threadId: thread.id, seq, side: "COMPANY", senderId: ids.owner, body, moneyFlag } });
    }

    const copyOf = (messageId: string): AlertJob => ({ driveId: ids.drive, candidateId: ids.candidate, templateKey: "message", messageId });

    it("sends each message once, however often its job runs, without colliding with the next message", async () => {
      const first = await message(1, "Bring two photos.");
      const second = await message(2, "And your Aadhaar.");

      await expect(processAlert({ data: copyOf(first.id), attemptsMade: 0 }, deps)).resolves.toBe("sent via recording");
      await expect(processAlert({ data: copyOf(first.id), attemptsMade: 1 }, deps)).resolves.toBe("already sent");
      await expect(processAlert({ data: copyOf(second.id), attemptsMade: 0 }, deps)).resolves.toBe("sent via recording");

      expect(channel.sent.map((m) => m.text)).toEqual([expect.stringContaining("Bring two photos."), expect.stringContaining("And your Aadhaar.")]);
      expect(channel.sent[0].text).toContain("Alerts Test Owner at Alerts Test Company");
      expect(channel.sent[0].text).toContain("Walkins never charges candidates");
    });

    it("dead-letters a copy whose delivery is uncertain and never sends it again", async () => {
      const uncertain = await message(3, "See you at 10.");
      channel.failures.push(new DeliveryOutcomeUnknownError("timed out"));

      await expect(processAlert({ data: copyOf(uncertain.id), attemptsMade: 0 }, deps)).rejects.toBeInstanceOf(UnrecoverableError);
      await expect(processAlert({ data: copyOf(uncertain.id), attemptsMade: 1 }, deps)).resolves.toBe("already sent");
      expect(channel.sent).toHaveLength(0);
    });

    it("puts the warning first on a flagged message", async () => {
      const flagged = await message(4, "Pay ₹500 registration fee", true);
      await processAlert({ data: copyOf(flagged.id), attemptsMade: 0 }, deps);
      expect(channel.sent[0].text.startsWith("Warning: this message seems to ask for money")).toBe(true);
    });

    it("is swept up if it was never queued, and left alone once attempted", async () => {
      const lost = await prisma.message.create({
        data: { threadId: thread.id, seq: 5, side: "COMPANY", senderId: ids.owner, body: "Queued nowhere", createdAt: new Date(Date.now() - 5 * 60_000) },
      });
      const queued: string[] = [];
      const alerts = { deliverMessages: async (jobs: { messageId: string }[]) => void queued.push(...jobs.map((j) => j.messageId)) };

      await expect(sweepMessages(alerts, [thread.id])).resolves.toBe(1);
      expect(queued).toEqual([lost.id]);

      await processAlert({ data: copyOf(lost.id), attemptsMade: 0 }, deps);
      await expect(sweepMessages(alerts, [thread.id])).resolves.toBe(0);
    });
  });

  describe("after a reschedule", () => {
    const DAY = 24 * 3600_000;
    let original: { startsAt: Date; endsAt: Date };

    // Two changes in quick succession, both after the candidate booked.
    async function rescheduleTwice() {
      const drive = await prisma.drive.findUniqueOrThrow({ where: { id: ids.drive } });
      original = { startsAt: drive.startsAt, endsAt: drive.endsAt };
      const shift = (n: number) => ({ startsAt: new Date(drive.startsAt.getTime() + n * DAY), endsAt: new Date(drive.endsAt.getTime() + n * DAY) });
      await prisma.driveReschedule.createMany({
        data: [
          { driveId: ids.drive, version: 1, fromStartsAt: original.startsAt, fromEndsAt: original.endsAt, toStartsAt: shift(1).startsAt, toEndsAt: shift(1).endsAt, byId: ids.owner },
          { driveId: ids.drive, version: 2, fromStartsAt: shift(1).startsAt, fromEndsAt: shift(1).endsAt, toStartsAt: shift(2).startsAt, toEndsAt: shift(2).endsAt, byId: ids.owner },
        ],
      });
      await prisma.drive.update({ where: { id: ids.drive }, data: { ...shift(2), scheduleVersion: 2 } });
    }

    afterAll(async () => {
      await prisma.driveReschedule.deleteMany({ where: { driveId: ids.drive } });
      await prisma.drive.update({ where: { id: ids.drive }, data: { ...original, scheduleVersion: 0 } });
    });

    it("skips a notice about a superseded time, and says the time the candidate last knew in the latest", async () => {
      const application = await prisma.application.create({
        data: { driveId: ids.drive, candidateId: ids.candidate, state: "CONFIRMED", stateChangedAt: new Date(Date.now() - 60_000) },
      });
      await rescheduleTwice();

      await expect(processAlert({ data: { ...job, templateKey: "drive_rescheduled", scheduleVersion: 1 }, attemptsMade: 0 }, deps)).resolves.toBe(
        "skipped: the drive has been rescheduled since",
      );
      await expect(processAlert({ data: { ...job, templateKey: "drive_rescheduled", scheduleVersion: 2 }, attemptsMade: 0 }, deps)).resolves.toBe(
        "sent via recording",
      );

      const [message] = channel.sent;
      const when = (startsAt: Date, endsAt: Date) => {
        const w = formatWhen(startsAt.toISOString(), endsAt.toISOString(), new Date());
        return `${w.day}, ${w.time}`;
      };
      const drive = await prisma.drive.findUniqueOrThrow({ where: { id: ids.drive } });
      // "Was" is the original time, never the in-between one they weren't told.
      expect(message.text).toContain(`Was: ${when(original.startsAt, original.endsAt)}`);
      expect(message.text).toContain(`Now: ${when(drive.startsAt, drive.endsAt)}`);
      expect(message.text).toContain("won't count against you");
      await prisma.application.delete({ where: { id: application.id } });
    });

    it("sends the morning reminder for the new day even though one went out for the old day", async () => {
      const application = await prisma.application.create({ data: { driveId: ids.drive, candidateId: ids.candidate, state: "CONFIRMED" } });
      await prisma.notification.create({
        data: { driveId: ids.drive, candidateId: ids.candidate, templateKey: "drive_morning_of", status: "SENT", channel: "recording", attempt: 1, jobId: "old-day" },
      });

      const reminder: AlertJob = { ...job, templateKey: "drive_morning_of", scheduleVersion: 2 };
      await expect(processAlert({ data: reminder, attemptsMade: 0 }, deps)).resolves.toBe("sent via recording");
      await expect(processAlert({ data: reminder, attemptsMade: 1 }, deps)).resolves.toBe("already sent");
      await prisma.application.delete({ where: { id: application.id } });
    });
  });
});
