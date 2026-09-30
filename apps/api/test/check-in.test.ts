import { randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@walkins/db";
import { ApplicationsService } from "../src/applications/applications.service";
import { CheckInTokenService } from "../src/check-in/check-in-token.service";
import { CheckInService } from "../src/check-in/check-in.service";
import { redis } from "../src/common/redis";
import { LiveBoardService } from "../src/live/live-board.service";
import { LiveGateway } from "../src/live/live.gateway";
import { createFixture, type Fixture, removeFixture } from "./fixtures";

const live = { publish: vi.fn(async () => {}) } as unknown as LiveGateway;
const tokens = new CheckInTokenService();
const checkIns = new CheckInService(tokens, live);
const applications = new ApplicationsService(live);
let fixture: Fixture;
let candidate = 0;

// Each test takes fresh candidates so their histories don't interact.
function nextCandidate() {
  return fixture.candidates[candidate++];
}

// About 55 m north of the venue: comfortably inside the 200 m fence.
function nearVenue(accuracy = 20) {
  return { lat: fixture.venue.lat + 0.0005, lng: fixture.venue.lng, accuracy };
}

// About 1.1 km north of the venue.
function farFromVenue(accuracy = 20) {
  return { lat: fixture.venue.lat + 0.01, lng: fixture.venue.lng, accuracy };
}

function freshToken() {
  return tokens.issue(fixture.drive.id).token;
}

function tokenExpiredMinutesAgo(minutes: number) {
  const signer = new JwtService({ secret: process.env.CHECKIN_JWT_SECRET });
  const exp = Math.floor(Date.now() / 1000) - minutes * 60;
  return signer.sign({ driveId: fixture.drive.id, exp }, { audience: "checkin", jwtid: randomUUID() });
}

async function bookSeat(userId: string) {
  return applications.apply(userId, fixture.drive.id, fixture.roomySlot.id);
}

beforeAll(async () => {
  fixture = await createFixture("Check-in Test", 16);
});

afterAll(async () => {
  await removeFixture(fixture);
  await prisma.$disconnect();
  redis.disconnect();
});

describe("scanning to check in", () => {
  it("returns the existing check-in when the same person scans twice", async () => {
    const { userId, candidateId } = nextCandidate();
    const application = await bookSeat(userId);
    const token = freshToken();

    const first = await checkIns.checkIn(userId, { token, ...nearVenue() });
    const second = await checkIns.checkIn(userId, { token, ...nearVenue() });

    expect(first.outcome).toBe("checked_in");
    expect(second.outcome).toBe("already_checked_in");
    if (first.outcome !== "checked_in" || second.outcome !== "already_checked_in") return;
    expect(second.checkIn.id).toBe(first.checkIn.id);
    expect(first.checkIn).toMatchObject({ method: "SCAN", isValid: true, flagReason: null });
    expect(await prisma.checkIn.count({ where: { application: { candidateId } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: application.id, action: "CONFIRMED->CHECKED_IN" } })).toBe(1);
    expect(await redis.keys(`checkin-nonce:*:${candidateId}`)).toHaveLength(1);
  });

  it("records one check-in when two scans from the same person land together", async () => {
    const { userId, candidateId } = nextCandidate();
    const application = await bookSeat(userId);
    const token = freshToken();

    const results = await Promise.all([
      checkIns.checkIn(userId, { token, ...nearVenue() }),
      checkIns.checkIn(userId, { token, ...nearVenue() }),
    ]);

    expect(results.map((r) => r.outcome).sort()).toEqual(["already_checked_in", "checked_in"]);
    expect(await prisma.checkIn.count({ where: { application: { candidateId } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: application.id, action: "CONFIRMED->CHECKED_IN" } })).toBe(1);
  });

  it("offers walk-in registration to someone who never applied, then checks them in without a seat", async () => {
    const { userId, candidateId } = nextCandidate();
    const seatsBefore = await prisma.driveSlot.aggregate({ where: { driveId: fixture.drive.id }, _sum: { bookedCount: true } });

    const offer = await checkIns.checkIn(userId, { token: freshToken(), ...nearVenue() });
    expect(offer.outcome).toBe("needs_registration");
    expect(await prisma.application.count({ where: { candidateId } })).toBe(0);

    const result = await checkIns.checkIn(userId, { token: freshToken(), ...nearVenue(), walkIn: true });
    expect(result.outcome).toBe("checked_in");
    if (result.outcome !== "checked_in") return;
    expect(result.checkIn.method).toBe("WALK_IN");

    const application = await prisma.application.findFirstOrThrow({ where: { candidateId } });
    expect(application).toMatchObject({ state: "CHECKED_IN", slotId: null });
    const seatsAfter = await prisma.driveSlot.aggregate({ where: { driveId: fixture.drive.id }, _sum: { bookedCount: true } });
    expect(seatsAfter._sum.bookedCount).toBe(seatsBefore._sum.bookedCount);
  });

  it("creates one walk-in when two walk-in scans land together", async () => {
    const { userId, candidateId } = nextCandidate();
    const token = freshToken();

    const results = await Promise.all([
      checkIns.checkIn(userId, { token, ...nearVenue(), walkIn: true }),
      checkIns.checkIn(userId, { token, ...nearVenue(), walkIn: true }),
    ]);

    expect(results.map((r) => r.outcome).sort()).toEqual(["already_checked_in", "checked_in"]);
    expect(await prisma.application.count({ where: { candidateId } })).toBe(1);
    expect(await prisma.checkIn.count({ where: { application: { candidateId } } })).toBe(1);
  });
});

describe("the geofence", () => {
  it("refuses a precise reading from outside 200 m and says how far away it was", async () => {
    const { userId, candidateId } = nextCandidate();
    await bookSeat(userId);

    const err = await checkIns.checkIn(userId, { token: freshToken(), ...farFromVenue() }).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/You're 1\.1 km from the venue/);
    expect(await prisma.checkIn.count({ where: { application: { candidateId } } })).toBe(0);
    expect(await redis.keys(`checkin-nonce:*:${candidateId}`)).toHaveLength(0);
  });

  it("accepts a poor-accuracy reading but flags it for the employer", async () => {
    const { userId } = nextCandidate();
    await bookSeat(userId);

    const result = await checkIns.checkIn(userId, { token: freshToken(), ...farFromVenue(450) });

    expect(result.outcome).toBe("checked_in");
    if (result.outcome !== "checked_in") return;
    expect(result.checkIn.isValid).toBe(false);
    expect(result.checkIn.flagReason).toMatch(/only accurate to ±450 m/);
  });
});

describe("check-in codes", () => {
  it("does not accept an access token as a check-in code", async () => {
    const { userId } = nextCandidate();
    const accessToken = new JwtService({ secret: process.env.JWT_SECRET }).sign({ driveId: fixture.drive.id });

    await expect(checkIns.checkIn(userId, { token: accessToken, ...nearVenue() })).rejects.toThrow(
      "That isn't a Walkins check-in code",
    );
  });

  it("refuses a code that expired more than 30 minutes ago", async () => {
    const { userId } = nextCandidate();
    await bookSeat(userId);

    await expect(checkIns.checkIn(userId, { token: tokenExpiredMinutesAgo(31), ...nearVenue() })).rejects.toThrow(
      /This code has expired/,
    );
  });

  it("accepts an offline scan that syncs late, flagged with how late it was", async () => {
    const { userId } = nextCandidate();
    await bookSeat(userId);

    const result = await checkIns.checkIn(userId, {
      token: tokenExpiredMinutesAgo(5),
      ...nearVenue(),
      capturedAt: new Date(Date.now() - 6 * 60_000),
    });

    expect(result.outcome).toBe("checked_in");
    if (result.outcome !== "checked_in") return;
    expect(result.checkIn.isValid).toBe(false);
    expect(result.checkIn.flagReason).toMatch(/Scanned offline, sent 5 min after the code expired/);
    expect(result.checkIn.capturedAt).not.toBeNull();
  });
});

describe("the employer's side", () => {
  it("marks someone present without a scan, recorded against the employer", async () => {
    const { userId } = nextCandidate();
    const application = await bookSeat(userId);

    const result = await checkIns.markPresent(fixture.company.id, fixture.employer.id, application.id, "no phone signal");

    expect(result.outcome).toBe("checked_in");
    if (result.outcome !== "checked_in") return;
    expect(result.checkIn).toMatchObject({ method: "MANUAL", isValid: true, distanceMeters: null });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: application.id, action: "CONFIRMED->CHECKED_IN" } });
    expect(audit.actorUserId).toBe(fixture.employer.id);
    expect(audit.after).toMatchObject({ actor: "employer", reason: "no phone signal" });
  });

  it("confirms a flagged check-in and records who confirmed it", async () => {
    const { userId } = nextCandidate();
    await bookSeat(userId);
    const flagged = await checkIns.checkIn(userId, { token: freshToken(), ...farFromVenue(300) });
    if (flagged.outcome !== "checked_in") throw new Error("expected a flagged check-in");

    const confirmed = await checkIns.confirmFlagged(fixture.company.id, fixture.employer.id, flagged.checkIn.id);

    expect(confirmed.isValid).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: flagged.checkIn.id, action: "confirmed" } });
    expect(audit.actorUserId).toBe(fixture.employer.id);
  });

  it("only lets an employer watch their own company's drive", async () => {
    const gateway = new LiveGateway(new JwtService({ secret: process.env.JWT_SECRET }), new LiveBoardService());
    const socket = (companyId: string) => ({
      data: { user: { userId: fixture.employer.id, role: "EMPLOYER" as const, companyId } },
      join: vi.fn(async () => {}),
    });

    const stranger = socket("some-other-company");
    await expect(gateway.join(stranger, fixture.drive.id)).resolves.toEqual({ error: "Drive not found" });
    expect(stranger.join).not.toHaveBeenCalled();

    const owner = socket(fixture.company.id);
    const board = await gateway.join(owner, fixture.drive.id);
    expect(owner.join).toHaveBeenCalledWith(`drive:${fixture.drive.id}`);
    expect(board).toHaveProperty("counts");
    if (!("counts" in board)) return;
    // Booked arrivals so far in this file: two duplicate-scan tests, the
    // poor-accuracy scan, the late sync, the manual mark and the confirmed
    // flag. The refused far-away scan adds none; walk-ins are counted apart.
    expect(board.counts).toMatchObject({ checkedIn: 6, walkIns: 2, hired: 0 });
  });
});
