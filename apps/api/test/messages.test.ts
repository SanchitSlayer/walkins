import type { HttpException } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@walkins/db";
import { moneyRequestSignals } from "@walkins/shared";
import { ApplicationsService } from "../src/applications/applications.service";
import type { JobsService } from "../src/common/jobs.service";
import type { LiveGateway } from "../src/live/live.gateway";
import { MessagesService } from "../src/messages/messages.service";
import { ModerationService } from "../src/trust/moderation.service";
import { addPerson, createFixture, type Fixture, removeFixture } from "./fixtures";

const live = { publish: vi.fn(async () => {}) } as unknown as LiveGateway;
const jobs = { message: vi.fn(async () => {}), alertBooked: vi.fn(async () => {}) } as unknown as JobsService;
const messages = new MessagesService(jobs);
const applications = new ApplicationsService(live);
const moderation = new ModerationService(jobs, live);

let fixture: Fixture;
let candidate = 0;

function code(err: unknown): string | undefined {
  return ((err as HttpException).getResponse?.() as { code?: string } | undefined)?.code;
}

const refusedWith = (expected: string) => (err: unknown) => code(err) === expected;

// A candidate with a booking, and the application their thread hangs off.
// Message reports on this file's own drive. Other files report messages in
// the same database at the same time, so an unscoped lookup can pick theirs.
function flaggedHere() {
  return { targetType: "MESSAGE" as const, message: { thread: { application: { driveId: fixture.drive.id } } } };
}

async function booked() {
  const person = fixture.candidates[candidate++];
  const application = await applications.apply(person.userId, fixture.drive.id, fixture.roomySlot.id, {});
  return { ...person, applicationId: application.id };
}

beforeAll(async () => {
  fixture = await createFixture("Messages Test", 14);
});

beforeEach(() => vi.mocked(jobs.message).mockClear());

afterAll(async () => {
  await removeFixture(fixture);
});

describe("the money-request tripwire", () => {
  it("catches the usual wording of a fee demand", () => {
    expect(moneyRequestSignals("Pay the registration fee of ₹500 before Monday")).toContain("feeWithAmount");
    expect(moneyRequestSignals("Send to ramesh.hr@okaxis")).toContain("upiHandle");
    expect(moneyRequestSignals("GPay karo 1000 rupaye")).toContain("paymentApp");
    expect(moneyRequestSignals("A/c no 123456789012, IFSC SBIN0001234")).toEqual(expect.arrayContaining(["accountNumber", "ifsc"]));
    expect(moneyRequestSignals("रजिस्ट्रेशन फीस 500 जमा करें")).toContain("feeWithAmount");
  });

  // फ़ is written two ways (फ + nukta, or one precomposed letter), and the
  // glossary's own spelling has the nukta; an amount usually comes first.
  it("catches a Hindi fee demand however फ़ीस is typed, and with the amount first", () => {
    for (const fee of ["फीस", "\u092B\u093C\u0940\u0938", "\u095E\u0940\u0938"]) {
      expect(moneyRequestSignals(`${fee} 500 दें`)).toContain("feeWithAmount");
    }
    expect(moneyRequestSignals("500 रुपये फ़ीस दें")).toContain("feeWithAmount");
    expect(moneyRequestSignals("1000 rupaye registration fee")).toContain("feeWithAmount");
  });

  it("leaves pay, times and ordinary contact details alone", () => {
    expect(moneyRequestSignals("Pay is ₹15,000 a month. Come at 10:30 with your Aadhaar.")).toEqual([]);
    expect(moneyRequestSignals("Email hr@company.com if you're running late")).toEqual([]);
    expect(moneyRequestSignals("सैलरी 15000 रुपये महीना, सुबह 10:30 बजे आएँ")).toEqual([]);
  });

  // Written down so nobody mistakes it for a screen.
  it("is defeated by a plain request with no fee words, which is why it only decides when to warn", () => {
    expect(moneyRequestSignals("send me 500 on the number you have")).toEqual([]);
  });
});

describe("a thread", () => {
  it("is started by either side, stored before anyone is told, and counted unread for the other side", async () => {
    const { userId, applicationId } = await booked();

    const sent = await messages.companySend(fixture.employer.id, applicationId, "Please bring two photos.");
    expect(sent.messages).toEqual([expect.objectContaining({ seq: 1, side: "COMPANY", body: "Please bring two photos.", delivery: "inAppOnly" })]);
    expect(sent.telegramLinked).toBe(false);
    expect(jobs.message).toHaveBeenCalledWith({ driveId: fixture.drive.id, candidateId: expect.any(String), messageId: sent.messages[0].id });

    const theirs = await messages.candidateThread(userId, applicationId);
    expect(theirs).toMatchObject({ unread: 1, canSend: true, telegramLinked: null, lastReadBy: null });
    expect(theirs.messages[0].delivery).toBeNull();
    await messages.candidateRead(userId, applicationId, 1);
    expect((await messages.candidateThreads(userId)).unread).toBe(0);

    await messages.candidateSend(userId, applicationId, "Thank you, I will.");
    expect(jobs.message).toHaveBeenCalledTimes(1);
    expect((await messages.companyThreads(fixture.employer.id)).threads.find((t) => t.applicationId === applicationId)?.unread).toBe(1);
  });

  it("keeps one order everyone sees when people send at the same moment", async () => {
    const { userId, applicationId } = await booked();
    const recruiter = await addPerson(fixture, "Messages Test Recruiter", "RECRUITER");

    await Promise.all([
      ...Array.from({ length: 4 }, (_, i) => messages.companySend(fixture.employer.id, applicationId, `owner ${i}`)),
      ...Array.from({ length: 4 }, (_, i) => messages.companySend(recruiter.id, applicationId, `recruiter ${i}`)),
      ...Array.from({ length: 4 }, (_, i) => messages.candidateSend(userId, applicationId, `candidate ${i}`)),
    ]);

    const thread = await messages.companyThread(fixture.employer.id, applicationId);
    expect(thread.messages.map((m) => m.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(new Set(thread.messages.map((m) => m.body)).size).toBe(12);
  });

  it("shares the company's read marker, notes who read it, and never marks past what was seen", async () => {
    const { userId, applicationId } = await booked();
    const recruiter = await addPerson(fixture, "Messages Test Reader", "RECRUITER");
    await messages.candidateSend(userId, applicationId, "first");
    await messages.candidateSend(userId, applicationId, "second");

    await messages.companyRead(recruiter.id, applicationId, 1);

    const forOwner = await messages.companyThread(fixture.employer.id, applicationId);
    expect(forOwner.unread).toBe(1);
    expect(forOwner.lastReadBy?.person).toMatchObject({ userId: recruiter.id, current: true });
    await messages.companyRead(fixture.employer.id, applicationId, 99);
    expect((await messages.companyThread(fixture.employer.id, applicationId)).unread).toBe(1);
  });

  it("lets a viewer read but not send", async () => {
    const { applicationId } = await booked();
    const viewer = await addPerson(fixture, "Messages Test Viewer", "VIEWER");
    expect((await messages.companyThread(viewer.id, applicationId)).blockedBy).toEqual(["viewOnly"]);
    await expect(messages.companySend(viewer.id, applicationId, "hi")).rejects.toSatisfy(refusedWith("errors.messages.blocked.viewOnly"));
  });
});

describe("when a thread stops taking messages", () => {
  it("closes for both sides when the application is withdrawn, and stays open when it is rejected", async () => {
    const withdrawn = await booked();
    await messages.companySend(fixture.employer.id, withdrawn.applicationId, "See you tomorrow.");
    await applications.release(withdrawn.userId, withdrawn.applicationId);
    await expect(messages.candidateSend(withdrawn.userId, withdrawn.applicationId, "hi")).rejects.toSatisfy(
      refusedWith("errors.messages.blocked.applicationClosed"),
    );
    const kept = await messages.companyThread(fixture.employer.id, withdrawn.applicationId);
    expect(kept).toMatchObject({ canSend: false, blockedBy: ["applicationClosed"] });
    expect(kept.messages).toHaveLength(1);

    const rejected = await booked();
    await prisma.application.update({ where: { id: rejected.applicationId }, data: { state: "REJECTED" } });
    await expect(messages.companySend(fixture.employer.id, rejected.applicationId, "We have another role for you.")).resolves.toBeTruthy();
  });

  it("stops the company, not the candidate, while the drive is suspended", async () => {
    const { userId, applicationId } = await booked();
    await prisma.drive.update({ where: { id: fixture.drive.id }, data: { status: "SUSPENDED" } });
    await expect(messages.companySend(fixture.employer.id, applicationId, "hi")).rejects.toSatisfy(refusedWith("errors.messages.blocked.driveSuspended"));
    await expect(messages.candidateSend(userId, applicationId, "Is it still on?")).resolves.toBeTruthy();
    await prisma.drive.update({ where: { id: fixture.drive.id }, data: { status: "LIVE" } });
  });

  it("closes for both 30 days after the drive ends, whatever else is true, and reports every reason", async () => {
    const { userId, applicationId } = await booked();
    const endsAt = fixture.drive.endsAt;
    await prisma.drive.update({ where: { id: fixture.drive.id }, data: { endsAt: new Date(Date.now() - 31 * 24 * 3600_000) } });
    await prisma.application.update({ where: { id: applicationId }, data: { state: "WITHDRAWN" } });

    expect((await messages.candidateThread(userId, applicationId)).blockedBy).toEqual(["closed", "applicationClosed"]);
    await expect(messages.companySend(fixture.employer.id, applicationId, "hi")).rejects.toSatisfy(refusedWith("errors.messages.blocked.closed"));
    await prisma.drive.update({ where: { id: fixture.drive.id }, data: { endsAt } });
  });
});

describe("a money request in a thread", () => {
  it("is delivered with a flag, files a report, and is shown to the company's owner until reviewed", async () => {
    const { applicationId } = await booked();
    const recruiter = await addPerson(fixture, "Messages Test Rogue", "RECRUITER");

    const thread = await messages.companySend(recruiter.id, applicationId, "Pay ₹500 registration fee to hr.jobs@ybl to confirm your seat");

    const [message] = thread.messages;
    expect(message.moneyFlag).toBe(true);
    expect(jobs.message).toHaveBeenCalled();
    expect(await prisma.report.findFirst({ where: { messageId: message.id } })).toMatchObject({
      targetType: "MESSAGE",
      reason: "ASKS_FOR_MONEY",
      reporterUserId: null,
      reporterNetwork: null,
    });

    const flagged = await messages.flagged(fixture.employer.id);
    expect(flagged).toEqual([expect.objectContaining({ messageId: message.id, sender: expect.objectContaining({ userId: recruiter.id }) })]);
    await expect(messages.flagged(recruiter.id)).rejects.toSatisfy(refusedWith("errors.people.cannot.managePeople"));
    await messages.reviewFlag(fixture.employer.id, message.id);
    expect(await messages.flagged(fixture.employer.id)).toEqual([]);
  });

  it("isn't flagged when the candidate asks about a fee: that is a warning about the employer, not the candidate", async () => {
    const { userId, applicationId } = await booked();
    const thread = await messages.candidateSend(userId, applicationId, "Do I need to pay the ₹500 registration fee?");
    expect(thread.messages[0].moneyFlag).toBe(false);
  });
});

describe("reporting and moderation", () => {
  it("lets the candidate report the company's message, not their own, into the moderation queue as a thread", async () => {
    const { userId, applicationId } = await booked();
    await messages.companySend(fixture.employer.id, applicationId, "You were rude at the desk.");
    const mine = await messages.candidateSend(userId, applicationId, "I was not.");
    const [theirs, own] = mine.messages;

    await messages.report(userId, theirs.id, { reason: "ABUSIVE" });
    await expect(messages.report(userId, own.id, { reason: "ABUSIVE" })).rejects.toSatisfy(refusedWith("errors.messages.reportOwnSide"));

    const thread = await prisma.messageThread.findUniqueOrThrow({ where: { applicationId } });
    const target = (await moderation.queue()).targets.find((t) => t.targetId === thread.id)!;
    expect(target).toMatchObject({ targetType: "THREAD", accountReporters: 1 });
    expect(target.reports[0].message).toEqual({ side: "COMPANY", body: "You were rude at the desk.", sender: fixture.employer.name });
  });

  it("opens a thread to an admin only once something in it is reported, and audits each opening", async () => {
    const quiet = await booked();
    await messages.companySend(fixture.employer.id, quiet.applicationId, "See you at 10.");
    const quietThread = await prisma.messageThread.findUniqueOrThrow({ where: { applicationId: quiet.applicationId } });
    await expect(messages.adminThread(fixture.employer.id, quietThread.id)).rejects.toSatisfy(refusedWith("errors.messages.notReported"));

    const reported = await prisma.report.findFirstOrThrow({ where: { ...flaggedHere(), reporterUserId: null } });
    const message = await prisma.message.findUniqueOrThrow({ where: { id: reported.messageId! } });
    await messages.adminThread(fixture.employer.id, message.threadId);
    expect(await prisma.auditLog.count({ where: { entityId: message.threadId, action: "viewed_by_admin" } })).toBe(1);
  });

  it("warns the company when what was reported in a thread was the company's", async () => {
    const reported = await prisma.report.findFirstOrThrow({ where: { ...flaggedHere(), reporterUserId: null, resolvedAt: null } });
    const { threadId } = await prisma.message.findUniqueOrThrow({ where: { id: reported.messageId! } });
    await moderation.act(fixture.employer.id, { kind: "WARN", targetType: "THREAD", targetId: threadId });
    expect(await prisma.warning.findFirst({ where: { companyId: fixture.company.id, reason: "ASKS_FOR_MONEY" } })).not.toBeNull();
    expect((await prisma.report.findUniqueOrThrow({ where: { id: reported.id } })).outcome).toBe("ACTIONED");
  });
});
