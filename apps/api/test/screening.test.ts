import { BadRequestException, ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@walkins/db";
import { evaluateKnockouts, type KnockoutQuestion } from "@walkins/shared";
import { ApplicantsService } from "../src/applications/applicants.service";
import { ApplicationsService } from "../src/applications/applications.service";
import { CheckInTokenService } from "../src/check-in/check-in-token.service";
import { CheckInService } from "../src/check-in/check-in.service";
import type { JobsService } from "../src/common/jobs.service";
import { RateLimiterService } from "../src/common/rate-limiter.service";
import { redis } from "../src/common/redis";
import type { StorageService } from "../src/common/storage.service";
import { LiveBoardService } from "../src/live/live-board.service";
import type { LiveGateway } from "../src/live/live.gateway";
import { createFixture, type Fixture, removeFixture } from "./fixtures";

const QUESTIONS: KnockoutQuestion[] = [
  {
    id: "licence",
    type: "BOOLEAN",
    prompt: "Do you have a two-wheeler licence?",
    requirement: "A valid two-wheeler licence",
    pass: { equals: true },
  },
  {
    id: "age",
    type: "NUMERIC",
    prompt: "How old are you?",
    unit: "years",
    requirement: "Aged 18 or over",
    pass: { min: 18 },
  },
  {
    id: "shift",
    type: "SINGLE_CHOICE",
    prompt: "Which shift can you work?",
    options: ["Day", "Night", "Either"],
    requirement: "Able to work nights",
    pass: { accepted: ["Night", "Either"] },
  },
];
const PASSING = { licence: true, age: 22, shift: "Either" };

const live = { publish: vi.fn(async () => {}) } as unknown as LiveGateway;
const jobs = { alert: vi.fn(async () => {}), reembed: vi.fn(async () => {}) } as unknown as JobsService;
const applications = new ApplicationsService(live);
const applicants = new ApplicantsService({} as StorageService, jobs, live);
const tokens = new CheckInTokenService();
const checkIns = new CheckInService(tokens, live, new RateLimiterService());
const IP = "screening-test";
let fixture: Fixture;
let candidate = 0;

function nextCandidate() {
  return fixture.candidates[candidate++];
}

function apply(userId: string, answers: Record<string, unknown>) {
  return applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, answers as never);
}

function bookedCount() {
  return prisma.driveSlot.findUniqueOrThrow({ where: { id: fixture.roomySlot.id } }).then((s) => s.bookedCount);
}

beforeAll(async () => {
  fixture = await createFixture("Screening Test", 12);
  await prisma.drive.update({ where: { id: fixture.drive.id }, data: { knockoutQuestions: QUESTIONS } });
});

afterAll(async () => {
  const limiterKeys = await redis.keys("ratelimit:checkin-code:*");
  const mine = limiterKeys.filter(
    (key) => key.endsWith(IP) || fixture.candidates.some(({ userId }) => key.endsWith(`:user:${userId}`)),
  );
  if (mine.length) await redis.del(...mine);
  await removeFixture(fixture);
  await prisma.$disconnect();
  redis.disconnect();
});

describe("evaluating screening questions", () => {
  it("passes answers that meet every requirement", () => {
    expect(evaluateKnockouts(QUESTIONS, PASSING)).toEqual({ passed: true });
  });

  it("gives the employer's requirement for the first unmet one", () => {
    expect(evaluateKnockouts(QUESTIONS, { ...PASSING, age: 17, shift: "Day" })).toEqual({
      passed: false,
      questionId: "age",
      reason: "Aged 18 or over",
    });
  });

  it("calls a malformed answer invalid rather than a failure", () => {
    expect(evaluateKnockouts(QUESTIONS, { ...PASSING, shift: "Weekends" })).toMatchObject({ passed: false, invalid: expect.any(String) });
    expect(evaluateKnockouts(QUESTIONS, { licence: true, age: 22 })).toMatchObject({ passed: false, invalid: expect.any(String) });
    expect(evaluateKnockouts(QUESTIONS, { ...PASSING, age: "22" })).toMatchObject({ passed: false, invalid: expect.any(String) });
  });
});

describe("applying with screening questions", () => {
  it("books a seat when every answer passes, and keeps the answers", async () => {
    const { userId } = nextCandidate();
    const before = await bookedCount();

    const application = await apply(userId, PASSING);

    expect(application.state).toBe("CONFIRMED");
    expect(await bookedCount()).toBe(before + 1);
    const row = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
    expect(row.knockoutAnswers).toEqual(PASSING);
  });

  it("screens out without a seat, keeps the reason, and refuses a second try", async () => {
    const { userId } = nextCandidate();
    const before = await bookedCount();

    const application = await apply(userId, { ...PASSING, licence: false });

    expect(application.state).toBe("SCREENED_OUT");
    expect(application.screenedOutReason).toBe("A valid two-wheeler licence");
    expect(application.slotStartsAt).toBeNull();
    expect(await bookedCount()).toBe(before);

    // Changing the answer after learning the requirement doesn't book.
    await expect(apply(userId, PASSING)).rejects.toThrow(ConflictException);
    await expect(apply(userId, PASSING)).rejects.toThrow(/A valid two-wheeler licence/);
    expect(await bookedCount()).toBe(before);
  });

  it("rejects a malformed answer without recording anything", async () => {
    const { userId, candidateId } = nextCandidate();
    await expect(apply(userId, { licence: true })).rejects.toThrow(BadRequestException);
    expect(await prisma.application.count({ where: { candidateId } })).toBe(0);
  });

  it("refuses a screened-out candidate's scan at the door, with the reason", async () => {
    const { userId } = nextCandidate();
    await apply(userId, { ...PASSING, shift: "Day" });
    const { code } = await tokens.issueCode(fixture.drive.id);

    await expect(
      checkIns.checkIn(userId, IP, { code, lat: fixture.venue.lat, lng: fixture.venue.lng, accuracy: 20 }),
    ).rejects.toThrow(/Able to work nights/);
  });

  it("lets the employer make an exception at the desk", async () => {
    const { userId } = nextCandidate();
    const application = await apply(userId, { ...PASSING, age: 16 });

    const result = await checkIns.markPresent(fixture.company.id, fixture.employer.id, application.id, "admitted at the desk");

    expect(result.outcome).toBe("checked_in");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: application.id, action: "SCREENED_OUT->CHECKED_IN" } });
    expect(audit.actorUserId).toBe(fixture.employer.id);
  });

  it("leaves screened-out candidates out of the expected count", async () => {
    const board = new LiveBoardService();
    const before = (await board.snapshot(fixture.drive.id)).counts.confirmed;
    const { userId } = nextCandidate();
    await apply(userId, { ...PASSING, licence: false });
    expect((await board.snapshot(fixture.drive.id)).counts.confirmed).toBe(before);
  });
});

describe("acting on applicants in bulk", () => {
  it("frees a booked seat on reject, tells the candidate, and skips what can't move", async () => {
    const booked = nextCandidate();
    const screened = nextCandidate();
    const bookedApp = await apply(booked.userId, PASSING);
    const screenedApp = await apply(screened.userId, { ...PASSING, licence: false });
    const before = await bookedCount();
    vi.mocked(jobs.alert).mockClear();

    const result = await applicants.act(fixture.company.id, fixture.employer.id, fixture.drive.id, {
      applicationIds: [bookedApp.id, screenedApp.id],
      action: "reject",
    });

    expect(result.updated).toBe(1);
    expect(result.skipped.map((s) => s.applicationId)).toEqual([screenedApp.id]);
    expect(await bookedCount()).toBe(before - 1);
    const row = await prisma.application.findUniqueOrThrow({ where: { id: bookedApp.id } });
    expect(row).toMatchObject({ state: "REJECTED", slotId: null });
    expect(jobs.alert).toHaveBeenCalledExactlyOnceWith({
      driveId: fixture.drive.id,
      candidateId: booked.candidateId,
      templateKey: "application_rejected",
    });
  });

  it("shortlists as a flag that leaves the state alone", async () => {
    const { userId } = nextCandidate();
    const application = await apply(userId, PASSING);

    await applicants.act(fixture.company.id, fixture.employer.id, fixture.drive.id, {
      applicationIds: [application.id],
      action: "shortlist",
    });

    const row = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
    expect(row).toMatchObject({ state: "CONFIRMED", shortlistedBy: fixture.employer.id });
    expect(row.shortlistedAt).not.toBeNull();
  });

  it("won't act on another company's applicants", async () => {
    const { userId } = nextCandidate();
    const application = await apply(userId, PASSING);
    const result = await applicants.act("another-company", fixture.employer.id, fixture.drive.id, {
      applicationIds: [application.id],
      action: "reject",
    });
    expect(result.updated).toBe(0);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).state).toBe("CONFIRMED");
  });
});

describe("ranking applicants", () => {
  // Unit vectors along two axes: the drive's own direction (similarity 1) and
  // one at right angles to it (similarity 0).
  const axis = (i: number) => `[${Array.from({ length: 384 }, (_, j) => (j === i ? 1 : 0)).join(",")}]`;
  const placed = [
    { key: "fit", km: 40, vector: axis(0) },
    { key: "near", km: 0, vector: axis(1) },
    { key: "unembedded", km: 10, vector: null },
  ];
  const ids = new Map<string, string>();
  let ranking: Fixture;

  beforeAll(async () => {
    ranking = await createFixture("Ranking Test", placed.length);
    await prisma.$executeRaw`UPDATE drives SET embedding = ${axis(0)}::vector WHERE id = ${ranking.drive.id}`;
    for (const [i, { key, km, vector }] of placed.entries()) {
      const { userId, candidateId } = ranking.candidates[i];
      await prisma.candidate.update({
        where: { id: candidateId },
        data: { homeLat: ranking.venue.lat + km / 111.2, homeLng: ranking.venue.lng },
      });
      if (vector) await prisma.$executeRaw`UPDATE candidates SET embedding = ${vector}::vector WHERE id = ${candidateId}`;
      const application = await applications.apply(userId, ranking.drive.id, ranking.roomySlot.id, {});
      ids.set(application.id, key);
    }
  });

  afterAll(async () => {
    await removeFixture(ranking);
  });

  async function order(weight: number) {
    const list = await applicants.list(ranking.company.id, ranking.drive.id, weight);
    return list.applicants.map((a) => ids.get(a.applicationId));
  }

  it("ranks nearest first at weight 0", async () => {
    expect(await order(0)).toEqual(["near", "unembedded", "fit"]);
  });

  it("ranks by profile fit alone at weight 1", async () => {
    expect(await order(1)).toEqual(["fit", "unembedded", "near"]);
  });

  it("gives someone with no embedding the median similarity, and says so", async () => {
    const list = await applicants.list(ranking.company.id, ranking.drive.id, 1);
    expect(list.medianSimilarity).toBeCloseTo(0.5);
    const byKey = new Map(list.applicants.map((a) => [ids.get(a.applicationId), a.match]));
    expect(byKey.get("unembedded")).toMatchObject({ basis: "distance_only", similarity: null });
    expect(byKey.get("unembedded")?.score).toBeCloseTo(0.5);
    expect(byKey.get("fit")?.basis).toBe("semantic");
  });
});
