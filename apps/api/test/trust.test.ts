import type { HttpException } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@walkins/db";
import { UNVERIFIED_ALERT_LIMIT } from "@walkins/shared";
import { ApplicationsService } from "../src/applications/applications.service";
import { CheckInTokenService } from "../src/check-in/check-in-token.service";
import { CheckInService } from "../src/check-in/check-in.service";
import type { JobsService } from "../src/common/jobs.service";
import { RateLimiterService } from "../src/common/rate-limiter.service";
import { redis } from "../src/common/redis";
import type { StorageService } from "../src/common/storage.service";
import { DrivesService } from "../src/drives/drives.service";
import type { GeocodingService } from "../src/drives/geocoding.service";
import type { LiveGateway } from "../src/live/live.gateway";
import { ModerationService } from "../src/trust/moderation.service";
import { ANONYMOUS_REPORTS_PER_DRIVE_PER_DAY, networkOf, overflowKey, ReportsService } from "../src/trust/reports.service";
import { MockVerificationProvider } from "../src/trust/verification-provider";
import { VerificationService } from "../src/trust/verification.service";
import { addPerson, createFixture, type Fixture, removeFixture } from "./fixtures";

// Stands in for MinIO: a document "exists" once the test says it was
// uploaded, which is all the service asks of storage.
const uploaded = new Set<string>();
const storage = {
  presignUpload: async () => ({ url: "/storage/test", fields: {} }),
  size: async (key: string) => (uploaded.has(key) ? 1024 : null),
  presignPlayback: async (key: string) => `/storage/${key}`,
} as unknown as StorageService;

const live = { publish: vi.fn(async () => {}), evict: vi.fn() } as unknown as LiveGateway;
const jobs = { alertBooked: vi.fn(async () => {}), reembed: vi.fn(async () => {}), charge: vi.fn(async () => {}), alert: vi.fn(async () => {}) } as unknown as JobsService;
const verification = new VerificationService(new MockVerificationProvider(), storage);
const reports = new ReportsService();
const moderation = new ModerationService(jobs, live);
const drives = new DrivesService({} as GeocodingService, jobs);
const applications = new ApplicationsService(live);
const tokens = new CheckInTokenService();
const checkIns = new CheckInService(tokens, live, new RateLimiterService(), jobs);

let fixture: Fixture;
let adminId: string;
let candidate = 0;

function nextCandidate() {
  return fixture.candidates[candidate++];
}

function code(err: unknown): string | undefined {
  return ((err as HttpException).getResponse?.() as { code?: string } | undefined)?.code;
}

const refusedWith = (expected: string) => (err: unknown) => code(err) === expected;

async function upload(userId: string) {
  const { key } = await verification.startDocumentUpload(userId, { contentType: "application/pdf", bytes: 1000 });
  uploaded.add(key);
  return key;
}

function driveStatus() {
  return prisma.drive.findUniqueOrThrow({ where: { id: fixture.drive.id } }).then((d) => d.status);
}

beforeAll(async () => {
  fixture = await createFixture("Trust Test", 8);
  const admin = await addPerson(fixture, "Trust Test Admin", null);
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  adminId = admin.id;
});

beforeEach(() => vi.mocked(jobs.alertBooked).mockClear());

afterAll(async () => {
  await redis.del(overflowKey(fixture.drive.id));
  await removeFixture(fixture);
});

describe("the mock verification provider", () => {
  const provider = new MockVerificationProvider();

  it("calls a well-formed GSTIN plausible, as a code the admin page words", async () => {
    await expect(provider.verify({ name: "x", gstin: "29ABCDE1234F1Z5" })).resolves.toEqual({ status: "VERIFIED", code: "wellFormed", params: {} });
  });

  it("rejects a malformed GSTIN or an impossible state code", async () => {
    await expect(provider.verify({ name: "x", gstin: "27ABC1234" })).resolves.toMatchObject({ status: "REJECTED", code: "malformed" });
    await expect(provider.verify({ name: "x", gstin: "99ABCDE1234F1Z5" })).resolves.toEqual({ status: "REJECTED", code: "badState", params: { state: "99" } });
  });
});

describe("verification", () => {
  beforeAll(async () => {
    await prisma.company.update({ where: { id: fixture.company.id }, data: { verificationStatus: "UNSUBMITTED" } });
  });

  it("lets only an owner submit, and only documents the company uploaded", async () => {
    const viewer = await addPerson(fixture, "Trust Test Viewer", "VIEWER");
    await expect(verification.startDocumentUpload(viewer.id, { contentType: "application/pdf", bytes: 1000 })).rejects.toSatisfy(
      refusedWith("errors.people.cannot.manageCompany"),
    );

    const elsewhere = await addPerson(fixture, "Trust Test Other Owner", "OWNER", true);
    const theirs = await upload(elsewhere.id);
    await expect(verification.submit(fixture.employer.id, { gstin: "29ABCDE1234F1Z5", documentKeys: [theirs] })).rejects.toSatisfy(
      refusedWith("errors.verification.documentMissing"),
    );
  });

  it("goes from submitted, to rejected with a reason, to resubmitted, to verified, recording who decided", async () => {
    const first = await verification.submit(fixture.employer.id, { gstin: "29ABCDE1234F1Z5", documentKeys: [await upload(fixture.employer.id)] });
    expect(first).toMatchObject({ verificationStatus: "PENDING", canSubmit: false });
    await expect(verification.submit(fixture.employer.id, { gstin: "29ABCDE1234F1Z5", documentKeys: [await upload(fixture.employer.id)] })).rejects.toSatisfy(
      refusedWith("errors.verification.alreadyWaiting"),
    );

    const [queued] = (await verification.queue()).filter((s) => s.companyId === fixture.company.id);
    expect(queued.provider).toEqual({ name: "mock-gstin", code: "wellFormed", params: {} });
    expect(queued.documents).toHaveLength(1);

    const rejected = await verification.decide(adminId, queued.id, { decision: "reject", reason: "DOCUMENT_UNREADABLE", note: "The scan is blurred." });
    expect(rejected).toMatchObject({ status: "REJECTED", rejectionReason: "DOCUMENT_UNREADABLE", decidedBy: "Trust Test Admin" });
    await expect(verification.decide(adminId, queued.id, { decision: "approve" })).rejects.toSatisfy(refusedWith("errors.verification.alreadyDecided"));
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: fixture.company.id, action: "PENDING->REJECTED" } });
    expect(audit).toMatchObject({ actorUserId: adminId, after: { reason: "DOCUMENT_UNREADABLE", note: "The scan is blurred." } });

    const standing = await verification.standing(fixture.employer.id);
    expect(standing).toMatchObject({ verificationStatus: "REJECTED", canSubmit: true });
    expect(standing.submissions[0]).toMatchObject({ rejectionReason: "DOCUMENT_UNREADABLE", decisionNote: "The scan is blurred." });

    await verification.submit(fixture.employer.id, { gstin: "29ABCDE1234F1Z5", documentKeys: [await upload(fixture.employer.id)] });
    const [again] = (await verification.queue()).filter((s) => s.companyId === fixture.company.id && s.status === "AWAITING_REVIEW");
    expect(again.history).toHaveLength(1);
    await verification.decide(adminId, again.id, { decision: "approve" });
    expect((await verification.standing(fixture.employer.id)).verificationStatus).toBe("VERIFIED");
  });
});

describe("reach", () => {
  it("limits a company awaiting review to the nearest few, and tells the employer", async () => {
    await prisma.company.update({ where: { id: fixture.company.id }, data: { verificationStatus: "PENDING" } });
    expect((await verification.reach(fixture.employer.id, fixture.drive.id)).limit).toBe(UNVERIFIED_ALERT_LIMIT);
    await prisma.company.update({ where: { id: fixture.company.id }, data: { verificationStatus: "VERIFIED" } });
    expect((await verification.reach(fixture.employer.id, fixture.drive.id)).limit).toBeNull();
  });
});

describe("reporting a drive", () => {
  const IP = "203.0.113.7";

  it("keeps a logged-out report under a network hash, never the address", async () => {
    await reports.reportDrive(fixture.drive.id, { reason: "ASKS_FOR_MONEY", details: "Asked for ₹500 registration" }, null, IP);
    const [row] = await prisma.report.findMany({ where: { driveId: fixture.drive.id, reason: "ASKS_FOR_MONEY" } });
    expect(row.reporterNetwork).toBe(networkOf(IP));
    expect(row.reporterNetwork).not.toContain(IP);
  });

  it("collapses a repeat, drops a honeypot, and never changes the drive by itself", async () => {
    await reports.reportDrive(fixture.drive.id, { reason: "ASKS_FOR_MONEY" }, null, IP);
    await reports.reportDrive(fixture.drive.id, { reason: "NOT_A_REAL_JOB", website: "http://spam.example" }, null, IP);
    expect(await prisma.report.count({ where: { driveId: fixture.drive.id } })).toBe(1);
    expect(await driveStatus()).toBe("LIVE");
  });

  it("counts logged-out reports past the daily cap instead of storing them", async () => {
    await prisma.report.createMany({
      data: Array.from({ length: ANONYMOUS_REPORTS_PER_DRIVE_PER_DAY }, (_, i) => ({
        targetType: "DRIVE" as const,
        driveId: fixture.drive.id,
        reason: "OTHER" as const,
        reporterNetwork: `flood-${i}`,
      })),
    });
    const before = await prisma.report.count({ where: { driveId: fixture.drive.id } });

    await expect(reports.reportDrive(fixture.drive.id, { reason: "MISLEADING_PAY" }, null, "198.51.100.1")).resolves.toEqual({ received: true });

    expect(await prisma.report.count({ where: { driveId: fixture.drive.id } })).toBe(before);
    expect(await redis.get(overflowKey(fixture.drive.id))).toBe("1");
    expect(await driveStatus()).toBe("LIVE");
    await prisma.report.deleteMany({ where: { driveId: fixture.drive.id, reporterNetwork: { startsWith: "flood-" } } });
  });

  it("lets an employer report only someone who applied to their own company", async () => {
    const { userId, candidateId } = nextCandidate();
    const applied = await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});
    await reports.reportCandidate(fixture.employer.id, { applicationId: applied.id, reason: "FAKE_PROFILE" });
    expect(await prisma.report.count({ where: { candidateId, reason: "FAKE_PROFILE", reporterUserId: fixture.employer.id } })).toBe(1);

    const stranger = await addPerson(fixture, "Trust Test Stranger", "OWNER", true);
    await expect(reports.reportCandidate(stranger.id, { applicationId: applied.id, reason: "ABUSIVE" })).rejects.toSatisfy(
      refusedWith("errors.application.notFound"),
    );
  });
});

describe("moderation", () => {
  it("groups reports by drive and shows each reporter's record", async () => {
    const serial = await addPerson(fixture, "Trust Test Serial Reporter", null);
    await reports.reportDrive(fixture.drive.id, { reason: "ABUSIVE" }, serial.id, "x");
    await moderation.act(adminId, { kind: "DISMISS", targetType: "DRIVE", targetId: fixture.drive.id });
    await reports.reportDrive(fixture.drive.id, { reason: "MISLEADING_PAY" }, serial.id, "x");

    const target = (await moderation.queue()).targets.find((t) => t.targetId === fixture.drive.id)!;
    expect(target).toMatchObject({ targetType: "DRIVE", accountReporters: 1, reasons: { MISLEADING_PAY: 1 } });
    expect(target.reports[0].reporter).toMatchObject({ kind: "account", name: "Trust Test Serial Reporter", total: 2, dismissed: 1, actioned: 0 });
    const dismissed = await prisma.report.findMany({ where: { reporterUserId: serial.id, outcome: "DISMISSED" } });
    expect(dismissed.map((r) => r.reason)).toEqual(["ABUSIVE"]);
  });

  it("warns a company, which sees it until someone acknowledges it", async () => {
    await moderation.act(adminId, { kind: "WARN", targetType: "DRIVE", targetId: fixture.drive.id, note: "Say the real pay in the listing." });
    const [warning] = (await verification.standing(fixture.employer.id)).warnings;
    expect(warning).toMatchObject({ reason: "MISLEADING_PAY", note: "Say the real pay in the listing." });
    await verification.acknowledgeWarning(fixture.employer.id, warning.id);
    expect((await verification.standing(fixture.employer.id)).warnings).toEqual([]);
  });

  it("suspends a live drive mid-day: no booking, no check-in, a read-only desk, and booked people told", async () => {
    const booked = nextCandidate();
    const application = await applications.apply(booked.userId, fixture.drive.id, fixture.roomySlot.id, {});
    await reports.reportDrive(fixture.drive.id, { reason: "ASKS_FOR_MONEY" }, null, "192.0.2.10");

    await moderation.act(adminId, { kind: "SUSPEND_DRIVE", targetType: "DRIVE", targetId: fixture.drive.id, note: "Fee reported" });

    expect(await prisma.drive.findUniqueOrThrow({ where: { id: fixture.drive.id } })).toMatchObject({ status: "SUSPENDED", suspendedFrom: "LIVE", suspendedCause: "DRIVE" });
    expect(jobs.alertBooked).toHaveBeenCalledWith(fixture.drive.id, "drive_suspended");
    expect(await prisma.report.count({ where: { driveId: fixture.drive.id, resolvedAt: null } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: fixture.drive.id, action: "moderation.suspend_drive" } });
    expect(audit.actorUserId).toBe(adminId);

    const next = nextCandidate();
    await expect(applications.apply(next.userId, fixture.drive.id, fixture.roomySlot.id, {})).rejects.toSatisfy(refusedWith("errors.application.suspended"));
    const { code: checkInCode } = await tokens.issueCode(fixture.drive.id);
    await expect(checkIns.checkIn(booked.userId, "trust-test", { code: checkInCode, ...fixture.venue, accuracy: 10 })).rejects.toSatisfy(
      refusedWith("errors.checkIn.suspended"),
    );
    await expect(checkIns.markPresent(fixture.employer.id, application.id)).rejects.toSatisfy(refusedWith("errors.drive.suspendedDesk"));
    await expect(drives.remove(fixture.employer.id, fixture.drive.id)).rejects.toSatisfy(refusedWith("errors.drive.suspendedDesk"));
    expect((await drives.findPublicOne(fixture.drive.id, null)).status).toBe("SUSPENDED");
    const search = await drives.search({ city: fixture.company.cityId, limit: 50 }, null);
    expect(search.items.map((d) => d.id)).not.toContain(fixture.drive.id);
    // The booking is kept, so lifting the suspension gives the seat back.
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).state).toBe("CONFIRMED");
  });

  it("puts a suspended drive back as it was, and tells the people booked", async () => {
    await moderation.act(adminId, { kind: "LIFT_DRIVE", targetType: "DRIVE", targetId: fixture.drive.id });
    expect(await driveStatus()).toBe("LIVE");
    expect(jobs.alertBooked).toHaveBeenCalledWith(fixture.drive.id, "drive_reinstated");
  });

  it("suspends a company: its desk turns read-only and its drives go with it until it is lifted", async () => {
    await moderation.act(adminId, { kind: "SUSPEND_COMPANY", targetType: "DRIVE", targetId: fixture.drive.id });

    expect(await prisma.drive.findUniqueOrThrow({ where: { id: fixture.drive.id } })).toMatchObject({ status: "SUSPENDED", suspendedCause: "COMPANY" });
    await expect(drives.update(fixture.employer.id, fixture.drive.id, {})).rejects.toSatisfy(refusedWith("errors.people.companySuspended"));
    await expect(drives.listMine(fixture.employer.id, undefined, 5)).resolves.toBeTruthy();
    await expect(moderation.act(adminId, { kind: "LIFT_DRIVE", targetType: "DRIVE", targetId: fixture.drive.id })).rejects.toSatisfy(
      refusedWith("errors.moderation.liftCompanyFirst"),
    );

    await moderation.act(adminId, { kind: "LIFT_COMPANY", targetType: "COMPANY", targetId: fixture.company.id });
    expect(await driveStatus()).toBe("LIVE");
    expect((await prisma.company.findUniqueOrThrow({ where: { id: fixture.company.id } })).suspendedAt).toBeNull();
  });

  it("leaves a drive that ended while suspended suspended for good", async () => {
    const endsAt = (await prisma.drive.findUniqueOrThrow({ where: { id: fixture.drive.id } })).endsAt;
    await moderation.act(adminId, { kind: "SUSPEND_DRIVE", targetType: "DRIVE", targetId: fixture.drive.id });
    await prisma.drive.update({ where: { id: fixture.drive.id }, data: { endsAt: new Date(Date.now() - 60_000) } });

    await expect(moderation.act(adminId, { kind: "LIFT_DRIVE", targetType: "DRIVE", targetId: fixture.drive.id })).rejects.toSatisfy(
      refusedWith("errors.moderation.endedWhileSuspended"),
    );
    expect(await driveStatus()).toBe("SUSPENDED");
    await prisma.drive.update({ where: { id: fixture.drive.id }, data: { endsAt, status: "LIVE", suspendedFrom: null, suspendedCause: null } });
  });
});

describe("cancelling a live drive", () => {
  it("tells everyone booked not to come", async () => {
    await drives.remove(fixture.employer.id, fixture.drive.id);
    expect(jobs.alertBooked).toHaveBeenCalledWith(fixture.drive.id, "drive_cancelled");
    await expect(drives.remove(fixture.employer.id, fixture.drive.id)).rejects.toSatisfy(refusedWith("errors.drive.notCancellable"));
  });
});
