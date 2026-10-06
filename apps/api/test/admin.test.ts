import { BadRequestException } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ledgerAccount, PLATFORM_ACCOUNT, postTransaction, prisma } from "@walkins/db";
import { AdminService } from "../src/admin/admin.service";
import { MockVerificationProvider } from "../src/admin/verification-provider";
import { ApplicationsService } from "../src/applications/applications.service";
import { CheckInTokenService } from "../src/check-in/check-in-token.service";
import { CheckInService } from "../src/check-in/check-in.service";
import type { JobsService } from "../src/common/jobs.service";
import { RateLimiterService } from "../src/common/rate-limiter.service";
import { redis } from "../src/common/redis";
import type { LiveGateway } from "../src/live/live.gateway";
import { createFixture, type Fixture, removeFixture } from "./fixtures";

const live = { publish: vi.fn(async () => {}) } as unknown as LiveGateway;
const jobs = { charge: vi.fn(async () => {}), queues: () => [] } as unknown as JobsService;
const admin = new AdminService(new MockVerificationProvider(), jobs);
const tokens = new CheckInTokenService();
const checkIns = new CheckInService(tokens, live, new RateLimiterService(), jobs);
const applications = new ApplicationsService(live);
const IP = "admin-test";
let fixture: Fixture;
let adminId: string;
let pendingDriveId: string;
let candidate = 0;

async function grant(amountPaise: number, tag: string) {
  await prisma.$transaction(async (tx) =>
    postTransaction(tx, {
      txnId: `test:grant:${fixture.company.id}:${tag}`,
      reason: "PROMO_GRANT",
      legs: [
        { accountId: await ledgerAccount(tx, "PLATFORM", PLATFORM_ACCOUNT.promotions), direction: "DEBIT", amountPaise },
        { accountId: await ledgerAccount(tx, "COMPANY", fixture.company.id), direction: "CREDIT", amountPaise },
      ],
    }),
  );
}

beforeAll(async () => {
  fixture = await createFixture("Admin Test", 6);
  const phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  adminId = (await prisma.user.create({ data: { phone, name: "Admin Test", role: "ADMIN" } })).id;
  const pending = await prisma.drive.create({
    data: {
      companyId: fixture.company.id,
      roleId: fixture.drive.roleId,
      cityId: fixture.drive.cityId,
      salaryMin: 15000,
      salaryMax: 20000,
      venueAddress: "Admin Test Venue",
      venueLat: fixture.venue.lat,
      venueLng: fixture.venue.lng,
      startsAt: new Date(Date.now() + 24 * 3600_000),
      endsAt: new Date(Date.now() + 27 * 3600_000),
      capacity: 10,
      experienceMin: 0,
      experienceMax: 2,
      status: "PENDING",
    },
  });
  pendingDriveId = pending.id;
});

beforeEach(() => vi.mocked(jobs.charge).mockClear());

afterAll(async () => {
  const limiterKeys = await redis.keys("ratelimit:checkin-code:*");
  const mine = limiterKeys.filter((key) => key.endsWith(IP) || fixture.candidates.some(({ userId }) => key.endsWith(`:user:${userId}`)));
  if (mine.length) await redis.del(...mine);
  if (pendingDriveId) {
    await prisma.auditLog.deleteMany({ where: { entityId: pendingDriveId } });
    await prisma.drive.delete({ where: { id: pendingDriveId } });
  }
  if (fixture) await removeFixture(fixture);
  if (adminId) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
    await prisma.user.delete({ where: { id: adminId } });
  }
  await prisma.$disconnect();
  redis.disconnect();
});

describe("the mock verification provider", () => {
  const provider = new MockVerificationProvider();

  it("passes a well-formed GSTIN and says it looked nothing up", async () => {
    await expect(provider.verify({ name: "x", gstin: "29ABCDE1234F1Z5" })).resolves.toEqual({
      status: "VERIFIED",
      reason: "GSTIN is well formed (mock check: no registry lookup)",
    });
  });

  it("rejects a missing, malformed or impossible GSTIN with the reason", async () => {
    await expect(provider.verify({ name: "x", gstin: null })).resolves.toMatchObject({ status: "REJECTED", reason: "No GSTIN on file" });
    await expect(provider.verify({ name: "x", gstin: "27ABC1234" })).resolves.toMatchObject({ status: "REJECTED" });
    await expect(provider.verify({ name: "x", gstin: "99ABCDE1234F1Z5" })).resolves.toMatchObject({ status: "REJECTED", reason: "99 is not an Indian state code" });
  });
});

describe("approving a drive", () => {
  it("lists every blocker, refuses to approve, and leaves the drive pending", async () => {
    await prisma.company.update({ where: { id: fixture.company.id }, data: { verificationStatus: "PENDING", gstin: "29ABCDE1234F1Z5" } });

    const listed = (await admin.drives()).find((d) => d.id === pendingDriveId)!;
    expect(listed.blockers).toHaveLength(2);
    expect(listed.blockers[0]).toMatch(/isn't verified/);
    expect(listed.blockers[1]).toMatch(/balance is ₹0, below the ₹200 cost of one check-in/);

    await expect(admin.moderateDrive(adminId, pendingDriveId, { decision: "approve" })).rejects.toBeInstanceOf(BadRequestException);
    expect((await prisma.drive.findUniqueOrThrow({ where: { id: pendingDriveId } })).status).toBe("PENDING");
  });

  it("verifies through the provider and records who did it", async () => {
    const outcome = await admin.verifyCompany(adminId, fixture.company.id, "check");
    expect(outcome.company.verificationStatus).toBe("VERIFIED");
    expect(outcome.provider).toMatchObject({ name: "mock-gstin", status: "VERIFIED" });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: fixture.company.id, action: "PENDING->VERIFIED" } });
    expect(audit.actorUserId).toBe(adminId);
  });

  it("still refuses a verified company below the price of one check-in", async () => {
    await grant(199_00, "short");
    await expect(admin.moderateDrive(adminId, pendingDriveId, { decision: "approve" })).rejects.toThrow(/below the ₹200 cost/);
  });

  it("approves once the balance covers a check-in, and the drive goes live", async () => {
    await grant(1_00, "topped");
    const approved = await admin.moderateDrive(adminId, pendingDriveId, { decision: "approve" });
    expect(approved.status).toBe("LIVE");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: pendingDriveId, action: "PENDING->LIVE" } });
    expect(audit.actorUserId).toBe(adminId);
  });
});

describe("charging from the check-in flow", () => {
  function nextCandidate() {
    return fixture.candidates[candidate++];
  }

  it("queues a charge for a verified scan", async () => {
    const { userId } = nextCandidate();
    await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});
    const result = await checkIns.checkIn(userId, IP, { code: (await tokens.issueCode(fixture.drive.id)).code, lat: fixture.venue.lat, lng: fixture.venue.lng, accuracy: 20 });
    expect(result.outcome).toBe("checked_in");
    if (result.outcome !== "checked_in") return;
    expect(jobs.charge).toHaveBeenCalledExactlyOnceWith({ checkInId: result.checkIn.id });
  });

  it("doesn't charge a flagged check-in until the employer confirms it", async () => {
    const { userId } = nextCandidate();
    await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});
    const result = await checkIns.checkIn(userId, IP, { code: (await tokens.issueCode(fixture.drive.id)).code, lat: fixture.venue.lat, lng: fixture.venue.lng, accuracy: 150 });
    if (result.outcome !== "checked_in") throw new Error(`expected a check-in, got ${result.outcome}`);
    expect(result.checkIn.isValid).toBe(false);
    expect(jobs.charge).not.toHaveBeenCalled();

    await checkIns.confirmFlagged(fixture.company.id, fixture.employer.id, result.checkIn.id);
    expect(jobs.charge).toHaveBeenCalledExactlyOnceWith({ checkInId: result.checkIn.id });
  });

  it("charges a check-in the employer marks by hand", async () => {
    const { userId } = nextCandidate();
    const application = await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});
    const result = await checkIns.markPresent(fixture.company.id, fixture.employer.id, application.id);
    if (result.outcome !== "checked_in") throw new Error(`expected a check-in, got ${result.outcome}`);
    expect(jobs.charge).toHaveBeenCalledExactlyOnceWith({ checkInId: result.checkIn.id });
  });

  it("still checks the person in when queueing the charge fails", async () => {
    vi.mocked(jobs.charge).mockRejectedValueOnce(new Error("redis is down"));
    const { userId } = nextCandidate();
    await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});
    const result = await checkIns.checkIn(userId, IP, { code: (await tokens.issueCode(fixture.drive.id)).code, lat: fixture.venue.lat, lng: fixture.venue.lng, accuracy: 20 });
    expect(result.outcome).toBe("checked_in");
  });

  it("doesn't wait for the charge to be queued", async () => {
    // A queue that never answers, as BullMQ does while Redis is unreachable.
    vi.mocked(jobs.charge).mockReturnValueOnce(new Promise(() => {}));
    const { userId } = nextCandidate();
    await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});
    const result = await checkIns.checkIn(userId, IP, { code: (await tokens.issueCode(fixture.drive.id)).code, lat: fixture.venue.lat, lng: fixture.venue.lng, accuracy: 20 });
    expect(result.outcome).toBe("checked_in");
  });
});
