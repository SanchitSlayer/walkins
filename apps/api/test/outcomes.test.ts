import type { HttpException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@walkins/db";
import { addDays, dayKey, outcomeNeed } from "@walkins/shared";
import { ApplicationsService } from "../src/applications/applications.service";
import { OutcomesService } from "../src/applications/outcomes.service";
import { CheckInTokenService } from "../src/check-in/check-in-token.service";
import { CheckInService } from "../src/check-in/check-in.service";
import type { JobsService } from "../src/common/jobs.service";
import { RateLimiterService } from "../src/common/rate-limiter.service";
import { CompaniesService } from "../src/companies/companies.service";
import type { LiveGateway } from "../src/live/live.gateway";
import { addPerson, createFixture, type Fixture, removeFixture } from "./fixtures";

const live = { publish: vi.fn(async () => {}) } as unknown as LiveGateway;
const jobs = { charge: vi.fn(async () => {}), alertBooked: vi.fn(async () => {}) } as unknown as JobsService;
const applications = new ApplicationsService(live);
const outcomes = new OutcomesService();
const checkIns = new CheckInService(new CheckInTokenService(), live, new RateLimiterService(), jobs);
const companies = new CompaniesService();

const DAY = 24 * 3600_000;
let fixture: Fixture;
let candidate = 0;
const today = () => dayKey(new Date());

function code(err: unknown): string | undefined {
  return ((err as HttpException).getResponse?.() as { code?: string } | undefined)?.code;
}

const refusedWith = (expected: string) => (err: unknown) => code(err) === expected;

// Someone booked, marked present at the desk, interviewed and hired.
async function hire() {
  const person = fixture.candidates[candidate++];
  const application = await applications.apply(person.userId, fixture.drive.id, fixture.roomySlot.id, {});
  await checkIns.markPresent(fixture.employer.id, application.id);
  await applications.updateByEmployer(fixture.employer.id, application.id, { to: "INTERVIEWED" });
  await applications.updateByEmployer(fixture.employer.id, application.id, { to: "HIRED" });
  return { ...person, applicationId: application.id };
}

function rowFor(applicationId: string) {
  return outcomes.list(fixture.employer.id).then((o) => o.rows.find((r) => r.applicationId === applicationId)!);
}

beforeAll(async () => {
  fixture = await createFixture("Outcomes Test", 16);
});

afterAll(async () => {
  await removeFixture(fixture);
});

describe("what is due", () => {
  it("asks for each fact only once its answer could exist", () => {
    const t = "2026-11-10";
    expect(outcomeNeed({ joiningDate: null, started: null, startedOn: null, retained: null }, t)).toBe("joiningDate");
    expect(outcomeNeed({ joiningDate: "2026-11-12", started: null, startedOn: null, retained: null }, t)).toBeNull();
    expect(outcomeNeed({ joiningDate: "2026-11-10", started: null, startedOn: null, retained: null }, t)).toBe("started");
    expect(outcomeNeed({ joiningDate: "2026-11-01", started: true, startedOn: "2026-11-01", retained: null }, t)).toBeNull();
    expect(outcomeNeed({ joiningDate: "2026-10-01", started: true, startedOn: "2026-10-01", retained: null }, t)).toBe("retained");
    expect(outcomeNeed({ joiningDate: "2026-10-01", started: false, startedOn: null, retained: null }, t)).toBeNull();
  });
});

describe("recording an outcome", () => {
  it("opens with the hire, every fact unknown, and asks for the joining date first", async () => {
    const { applicationId } = await hire();
    expect(await prisma.hiringOutcome.findUnique({ where: { applicationId } })).toMatchObject({ joiningDate: null, started: null, retained: null });
    expect(await rowFor(applicationId)).toMatchObject({ need: "joiningDate", started: null });
  });

  it("goes from a joining date, to whether they started, to whether they stayed, each with who said it", async () => {
    const { applicationId } = await hire();

    await outcomes.record(fixture.employer.id, applicationId, { joiningDate: addDays(today(), 3) });
    expect(await rowFor(applicationId)).toMatchObject({ need: null, joiningDateBy: { userId: fixture.employer.id } });
    await expect(outcomes.record(fixture.employer.id, applicationId, { started: true })).rejects.toSatisfy(refusedWith("errors.outcomes.notYet"));

    await outcomes.record(fixture.employer.id, applicationId, { joiningDate: today() });
    expect((await rowFor(applicationId)).need).toBe("started");
    const recruiter = await addPerson(fixture, "Outcomes Test Recruiter", "RECRUITER");
    await outcomes.record(recruiter.id, applicationId, { started: true });
    expect(await rowFor(applicationId)).toMatchObject({ started: true, startedOn: today(), startedBy: { userId: recruiter.id }, need: null });
    await expect(outcomes.record(fixture.employer.id, applicationId, { retained: true })).rejects.toSatisfy(refusedWith("errors.outcomes.retainedNotYet"));

    // Thirty days on, staying becomes the question.
    await prisma.hiringOutcome.update({
      where: { applicationId },
      data: { hiredAt: new Date(Date.now() - 40 * DAY), joiningDate: new Date(addDays(today(), -31)), startedOn: new Date(addDays(today(), -31)) },
    });
    expect((await rowFor(applicationId)).need).toBe("retained");
    await outcomes.record(fixture.employer.id, applicationId, { retained: false });
    expect(await rowFor(applicationId)).toMatchObject({ retained: false, need: null });
    expect(await prisma.auditLog.count({ where: { entityId: applicationId, action: "outcome_recorded" } })).toBe(4);
  });

  it("forgets whether someone stayed when the start itself is corrected to 'did not start'", async () => {
    const { applicationId } = await hire();
    await prisma.hiringOutcome.update({
      where: { applicationId },
      data: { joiningDate: new Date(addDays(today(), -35)), started: true, startedOn: new Date(addDays(today(), -35)), retained: true },
    });
    await outcomes.record(fixture.employer.id, applicationId, { started: false });
    expect(await prisma.hiringOutcome.findUnique({ where: { applicationId } })).toMatchObject({ started: false, startedOn: null, retained: null });
  });

  it("stops taking corrections once the window has closed, and lets only people who run drives record", async () => {
    const { applicationId } = await hire();
    const viewer = await addPerson(fixture, "Outcomes Test Viewer", "VIEWER");
    await expect(outcomes.record(viewer.id, applicationId, { joiningDate: today() })).rejects.toSatisfy(refusedWith("errors.people.cannot.runDrives"));

    await prisma.hiringOutcome.update({ where: { applicationId }, data: { hiredAt: new Date(Date.now() - 200 * DAY), joiningDate: new Date(addDays(today(), -100)) } });
    await expect(outcomes.record(fixture.employer.id, applicationId, { started: true })).rejects.toSatisfy(refusedWith("errors.outcomes.tooLate"));
    expect((await outcomes.list(fixture.employer.id)).rows.some((r) => r.applicationId === applicationId)).toBe(false);
  });
});

describe("the candidate's own answer", () => {
  it("is asked only once the joining date has come, sits beside the employer's record, and never changes it", async () => {
    const { userId, applicationId } = await hire();
    await outcomes.record(fixture.employer.id, applicationId, { joiningDate: addDays(today(), 2) });
    await expect(outcomes.candidateAnswer(userId, applicationId, true)).rejects.toSatisfy(refusedWith("errors.outcomes.notYet"));
    const before = (await applications.listMine(userId)).past.concat((await applications.listMine(userId)).upcoming).find((a) => a.id === applicationId)!;
    expect(before.outcome).toMatchObject({ canAnswer: false, candidateStarted: null });

    await outcomes.record(fixture.employer.id, applicationId, { joiningDate: today() });
    await outcomes.record(fixture.employer.id, applicationId, { started: false });
    await outcomes.candidateAnswer(userId, applicationId, true);

    expect(await rowFor(applicationId)).toMatchObject({ started: false, candidateStarted: true });
  });
});

describe("the funnel", () => {
  async function funnel(driveId: string) {
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW drive_funnel`;
    return (await companies.analytics(fixture.employer.id)).drives.find((d) => d.driveId === driveId)!;
  }

  it("counts only who held a seat, keeps the screened-out and flagged apart, credits alerts that came first, and keeps hires hired", async () => {
    const drive = fixture.drive.id;
    const start = await funnel(drive);

    const released = fixture.candidates[candidate++];
    const app = await applications.apply(released.userId, drive, fixture.roomySlot.id, {});
    await applications.release(released.userId, app.id);

    const screened = fixture.candidates[candidate++];
    await prisma.application.create({ data: { driveId: drive, candidateId: screened.candidateId, state: "SCREENED_OUT" } });

    const flagged = fixture.candidates[candidate++];
    const flaggedApp = await applications.apply(flagged.userId, drive, fixture.roomySlot.id, {});
    await prisma.$transaction([
      prisma.application.update({ where: { id: flaggedApp.id }, data: { state: "CHECKED_IN" } }),
      prisma.checkIn.create({ data: { applicationId: flaggedApp.id, method: "SCAN", isValid: false, flagReason: "test" } }),
    ]);

    const alerted = fixture.candidates[candidate++];
    await prisma.notification.create({
      data: { driveId: drive, candidateId: alerted.candidateId, templateKey: "drive_48h", status: "SENT", channel: "test", attempt: 1, jobId: "t", sentAt: new Date(Date.now() - 3600_000) },
    });
    const alertedApp = await applications.apply(alerted.userId, drive, fixture.roomySlot.id, {});
    await checkIns.markPresent(fixture.employer.id, alertedApp.id);

    const after = await funnel(drive);
    // The release, the screened-out applicant and the flagged arrival each
    // land where they belong rather than as booked-but-absent.
    expect(after.confirmed - start.confirmed).toBe(2);
    expect(after.checkedIn - start.checkedIn).toBe(1);
    expect(after.awaitingConfirmation - start.awaitingConfirmation).toBe(1);
    expect(after.screenedOut - start.screenedOut).toBe(1);
    expect(after.interested - start.interested).toBe(3);
    expect(after.attendedAfterAlert - start.attendedAfterAlert).toBe(1);
    // Earlier tests hired people and recorded outcomes for them; hired stays
    // a fact of the drive day, untouched by what came after.
    expect(after.hired).toBe(await prisma.application.count({ where: { driveId: drive, state: "HIRED" } }));
    expect(after.counted).toBe(true);
  });

  it("lists a cancelled drive but leaves it out of every rate", async () => {
    const cancelled = await prisma.drive.create({
      data: { ...(await prisma.drive.findUniqueOrThrow({ where: { id: fixture.drive.id }, select: { companyId: true, ownerId: true, roleId: true, cityId: true, salaryMin: true, salaryMax: true, venueAddress: true, venueLat: true, venueLng: true, startsAt: true, endsAt: true, capacity: true, experienceMin: true, experienceMax: true } })), status: "CANCELLED" },
    });
    const person = fixture.candidates[candidate++];
    await prisma.application.create({ data: { driveId: cancelled.id, candidateId: person.candidateId, state: "CONFIRMED" } });

    expect(await funnel(cancelled.id)).toMatchObject({ counted: false, showUpRate: null, confirmed: 1, checkedIn: 0 });
  });
});
