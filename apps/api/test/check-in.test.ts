import { randomUUID } from "node:crypto";
import { BadRequestException, HttpException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@walkins/db";
import { CHECKIN_CODE_ALPHABET, type CheckInRequest } from "@walkins/shared";
import { ApplicationsService } from "../src/applications/applications.service";
import { checkInCodeKey, CheckInTokenService } from "../src/check-in/check-in-token.service";
import { CheckInService } from "../src/check-in/check-in.service";
import { RateLimiterService } from "../src/common/rate-limiter.service";
import { redis } from "../src/common/redis";
import { displayName, LiveBoardService } from "../src/live/live-board.service";
import { LiveGateway } from "../src/live/live.gateway";
import { createFixture, type Fixture, removeFixture } from "./fixtures";

const live = { publish: vi.fn(async () => {}) } as unknown as LiveGateway;
const tokens = new CheckInTokenService();
const checkIns = new CheckInService(tokens, live, new RateLimiterService());
// A fresh address per run, so repeated runs don't share the per-address
// limit on wrong codes; its limiter keys are removed afterwards.
const ip = `test-${randomUUID()}`;
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

function scan(userId: string, input: CheckInRequest) {
  return checkIns.checkIn(userId, ip, input);
}

async function freshCode() {
  return (await tokens.issueCode(fixture.drive.id)).code;
}

function randomTestCode() {
  return Array.from({ length: 8 }, () => CHECKIN_CODE_ALPHABET[Math.floor(Math.random() * 32)]).join("");
}

// Puts any token behind a code, for the cases the screen never issues: an
// expired token, or something that isn't a check-in token at all.
async function codeFor(token: string) {
  const code = randomTestCode();
  await redis.set(checkInCodeKey(code), token, "EX", 600);
  return code;
}

function codeExpiredMinutesAgo(minutes: number) {
  const signer = new JwtService({ secret: process.env.CHECKIN_JWT_SECRET });
  const exp = Math.floor(Date.now() / 1000) - minutes * 60;
  return codeFor(signer.sign({ driveId: fixture.drive.id, exp }, { audience: "checkin", jwtid: randomUUID() }));
}

async function bookSeat(userId: string) {
  return applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});
}

beforeAll(async () => {
  fixture = await createFixture("Check-in Test", 24);
});

afterAll(async () => {
  const limiterKeys = await redis.keys(`ratelimit:checkin-code:*`);
  const mine = limiterKeys.filter(
    (key) => key.endsWith(ip) || fixture.candidates.some(({ userId }) => key.endsWith(`:user:${userId}`)),
  );
  if (mine.length) await redis.del(...mine);
  await removeFixture(fixture);
  await prisma.$disconnect();
  redis.disconnect();
});

describe("scanning to check in", () => {
  it("returns the existing check-in when the same person scans twice", async () => {
    const { userId, candidateId } = nextCandidate();
    const application = await bookSeat(userId);
    const code = await freshCode();

    const first = await scan(userId, { code, ...nearVenue() });
    const second = await scan(userId, { code, ...nearVenue() });

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
    const code = await freshCode();

    const results = await Promise.all([
      scan(userId, { code, ...nearVenue() }),
      scan(userId, { code, ...nearVenue() }),
    ]);

    expect(results.map((r) => r.outcome).sort()).toEqual(["already_checked_in", "checked_in"]);
    expect(await prisma.checkIn.count({ where: { application: { candidateId } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: application.id, action: "CONFIRMED->CHECKED_IN" } })).toBe(1);
  });

  it("offers walk-in registration to someone who never applied, then checks them in without a seat", async () => {
    const { userId, candidateId } = nextCandidate();
    const seatsBefore = await prisma.driveSlot.aggregate({ where: { driveId: fixture.drive.id }, _sum: { bookedCount: true } });

    const offer = await scan(userId, { code: await freshCode(), ...nearVenue() });
    expect(offer.outcome).toBe("needs_registration");
    expect(await prisma.application.count({ where: { candidateId } })).toBe(0);

    const result = await scan(userId, { code: await freshCode(), ...nearVenue(), walkIn: true });
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
    const code = await freshCode();

    const results = await Promise.all([
      scan(userId, { code, ...nearVenue(), walkIn: true }),
      scan(userId, { code, ...nearVenue(), walkIn: true }),
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

    const err = await scan(userId, { code: await freshCode(), ...farFromVenue() }).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/You're 1\.1 km from the venue/);
    expect(await prisma.checkIn.count({ where: { application: { candidateId } } })).toBe(0);
    expect(await redis.keys(`checkin-nonce:*:${candidateId}`)).toHaveLength(0);
  });

  it("accepts a poor-accuracy reading but flags it for the employer", async () => {
    const { userId } = nextCandidate();
    await bookSeat(userId);

    const result = await scan(userId, { code: await freshCode(), ...farFromVenue(450) });

    expect(result.outcome).toBe("checked_in");
    if (result.outcome !== "checked_in") return;
    expect(result.checkIn.isValid).toBe(false);
    expect(result.checkIn.flagReason).toMatch(/only accurate to ±450 m/);
  });
});

describe("check-in codes", () => {
  it("does not accept an access token stored behind a code", async () => {
    const { userId } = nextCandidate();
    const accessToken = new JwtService({ secret: process.env.JWT_SECRET }).sign({ driveId: fixture.drive.id });

    await expect(scan(userId, { code: await codeFor(accessToken), ...nearVenue() })).rejects.toThrow(
      "That isn't a Walkins check-in code",
    );
  });

  it("reads a typed code in any case, with a space or dash, and O or L for 0 or 1", async () => {
    const { userId } = nextCandidate();
    await bookSeat(userId);
    const code = await freshCode();
    const typed = `${code.slice(0, 4)}-${code.slice(4)}`.replace(/0/g, "o").replace(/1/g, "l").toLowerCase();

    const result = await scan(userId, { code: ` ${typed} `, ...nearVenue() });

    expect(result.outcome).toBe("checked_in");
  });

  it("refuses a code that doesn't exist, and counts it as a wrong guess", async () => {
    const { userId } = nextCandidate();

    await expect(scan(userId, { code: randomTestCode(), ...nearVenue() })).rejects.toThrow(/That code isn't right/);
    expect(await redis.zcard(`ratelimit:checkin-code:user:${userId}`)).toBe(1);
  });

  it("stops looking codes up after ten wrong ones, even a right one", async () => {
    const { userId } = nextCandidate();
    await bookSeat(userId);
    for (let i = 0; i < 10; i++) {
      await expect(scan(userId, { code: randomTestCode(), ...nearVenue() })).rejects.toBeInstanceOf(BadRequestException);
    }

    const err = await scan(userId, { code: await freshCode(), ...nearVenue() }).catch((e) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(await prisma.checkIn.count({ where: { application: { candidate: { userId } } } })).toBe(0);
  });

  it("doesn't count a right code against the limit", async () => {
    const { userId } = nextCandidate();
    await bookSeat(userId);
    for (let i = 0; i < 9; i++) {
      await expect(scan(userId, { code: randomTestCode(), ...nearVenue() })).rejects.toBeInstanceOf(BadRequestException);
    }

    await expect(scan(userId, { code: await freshCode(), ...nearVenue() })).resolves.toMatchObject({ outcome: "checked_in" });
    expect(await redis.zcard(`ratelimit:checkin-code:user:${userId}`)).toBe(9);
  });

  it("refuses a code that expired more than 30 minutes ago", async () => {
    const { userId } = nextCandidate();
    await bookSeat(userId);

    await expect(scan(userId, { code: await codeExpiredMinutesAgo(31), ...nearVenue() })).rejects.toThrow(
      /This code has expired/,
    );
  });

  it("accepts an offline scan that syncs late, flagged with how late it was", async () => {
    const { userId } = nextCandidate();
    await bookSeat(userId);

    const result = await scan(userId, {
      code: await codeExpiredMinutesAgo(5),
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
    const flagged = await scan(userId, { code: await freshCode(), ...farFromVenue(300) });
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
    await expect(gateway.join(stranger, { driveId: fixture.drive.id, view: "desk" })).resolves.toEqual({ error: "Drive not found" });
    expect(stranger.join).not.toHaveBeenCalled();

    const owner = socket(fixture.company.id);
    await expect(gateway.join(owner, { driveId: fixture.drive.id, view: "somewhere" })).resolves.toEqual({ error: "Unknown view" });
    const desk = await gateway.join(owner, { driveId: fixture.drive.id, view: "desk" });
    expect(owner.join).toHaveBeenCalledWith(`drive:${fixture.drive.id}:desk`);
    expect(desk).toHaveProperty("awaiting");
    if (!("awaiting" in desk)) return;
    // Booked arrivals so far in this file: two duplicate-scan tests, the
    // poor-accuracy scan, the typed code, the right code after wrong ones, the
    // late sync, the manual mark and the confirmed flag. Refused scans add
    // none; walk-ins are counted apart.
    expect(desk.counts).toMatchObject({ checkedIn: 8, walkIns: 2, hired: 0 });
    expect(desk.arrivals.some((a) => a.flagReason !== null)).toBe(true);
  });

  it("gives the public board short names and nothing the desk alone should see", async () => {
    const gateway = new LiveGateway(new JwtService({ secret: process.env.JWT_SECRET }), new LiveBoardService());
    const owner = {
      data: { user: { userId: fixture.employer.id, role: "EMPLOYER" as const, companyId: fixture.company.id } },
      join: vi.fn(async () => {}),
    };

    const board = await gateway.join(owner, { driveId: fixture.drive.id, view: "board" });

    expect(owner.join).toHaveBeenCalledWith(`drive:${fixture.drive.id}:board`);
    expect(board).toHaveProperty("arrivals");
    if (!("arrivals" in board) || "awaiting" in board) throw new Error("expected the board projection");
    expect(board.counts).toMatchObject({ checkedIn: 8, walkIns: 2 });
    const serialised = JSON.stringify(board);
    for (const { candidateId } of fixture.candidates) {
      const user = await prisma.candidate.findUniqueOrThrow({ where: { id: candidateId }, include: { user: true } });
      expect(serialised).not.toContain(user.user.name);
    }
    expect(serialised).not.toMatch(/flagReason|distanceMeters|applicationId|accurate to/);
    // Fixture names are "Check-in Test Candidate 7", so the short form is "Check-in 7.".
    expect(board.arrivals[0].displayName).toMatch(/^Check-in \w+\.$/);
  });
});

describe("shortening names for the board", () => {
  it("keeps the first name and the last name's initial", () => {
    expect(displayName("Asha Kumari Rao")).toBe("Asha R.");
    expect(displayName("  Ravi   kumar ")).toBe("Ravi K.");
    expect(displayName("Mononym")).toBe("Mononym");
    expect(displayName("   ")).toBe("Candidate");
  });
});
