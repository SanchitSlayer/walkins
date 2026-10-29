import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@walkins/db";
import { addDays, dayKey, OUTCOME_MIN_RECORDED } from "@walkins/shared";
import { AdminService } from "../src/admin/admin.service";
import { ApplicationsService } from "../src/applications/applications.service";
import type { JobsService } from "../src/common/jobs.service";
import { CompaniesService } from "../src/companies/companies.service";
import type { LiveGateway } from "../src/live/live.gateway";
import { createFixture, type Fixture, removeFixture } from "./fixtures";

const live = { publish: vi.fn(async () => {}) } as unknown as LiveGateway;
const companies = new CompaniesService();
const applications = new ApplicationsService(live);
const admin = new AdminService({ queues: () => [] } as unknown as JobsService);

const DAY = 24 * 3600_000;
let fixture: Fixture;

// Hires on the fixture's drive, with outcomes as given. The drive is LIVE,
// so it counts.
async function hires(outcomes: { started: boolean | null; retained: boolean | null; candidateStarted?: boolean }[]) {
  const ids: string[] = [];
  for (const [i, o] of outcomes.entries()) {
    const { candidateId } = fixture.candidates[i];
    const application = await prisma.application.create({ data: { driveId: fixture.drive.id, candidateId, state: "HIRED" } });
    // Five days after the drive day, counted in India's calendar as the view does.
    const startedOn = o.started ? addDays(dayKey(fixture.drive.startsAt), 5) : null;
    await prisma.hiringOutcome.create({
      data: {
        applicationId: application.id,
        hiredAt: new Date(),
        started: o.started,
        startedOn: startedOn ? new Date(startedOn) : null,
        retained: o.retained,
        candidateStarted: o.candidateStarted ?? null,
      },
    });
    ids.push(application.id);
  }
  return ids;
}

async function refresh() {
  await prisma.$executeRaw`REFRESH MATERIALIZED VIEW application_facts`;
}

beforeAll(async () => {
  fixture = await createFixture("Outcome Analytics Test", 14);
  // The drive day was 45 days ago, so starts five days later are 40 days old.
  await prisma.drive.update({ where: { id: fixture.drive.id }, data: { startsAt: new Date(Date.now() - 45 * DAY), endsAt: new Date(Date.now() + 3600_000) } });
  fixture.drive.startsAt = new Date(Date.now() - 45 * DAY);
});

afterAll(async () => {
  await removeFixture(fixture);
});

describe("outcome figures", () => {
  it("withholds the rate and the median until enough are recorded, but always shows the counts", async () => {
    // Nine recorded (6 stayed, 3 left), two never said.
    const ids = await hires([
      ...Array.from({ length: 6 }, () => ({ started: true, retained: true })),
      ...Array.from({ length: 3 }, () => ({ started: true, retained: false })),
      ...Array.from({ length: 2 }, () => ({ started: true, retained: null })),
    ]);
    await refresh();

    const { retentionByRole, timeToJoin } = await companies.analytics(fixture.employer.id);
    expect(retentionByRole).toEqual([
      expect.objectContaining({ eligible: 11, stayed: 6, left: 3, notRecorded: 2, rate: null }),
    ]);
    expect(timeToJoin).toMatchObject({ hires: 11, startRecorded: 11, started: 11, medianDays: 5 });

    // One more recorded crosses the minimum.
    await prisma.hiringOutcome.update({ where: { applicationId: ids[9] }, data: { retained: true } });
    await refresh();
    const [role] = (await companies.analytics(fixture.employer.id)).retentionByRole;
    expect(role.stayed + role.left).toBe(OUTCOME_MIN_RECORDED);
    expect(role).toMatchObject({ stayed: 7, left: 3, notRecorded: 1, rate: 0.7 });
  });

  it("never counts 'not recorded' as left, and counts the candidate's confirmation apart", async () => {
    const { retentionByRole, timeToJoin } = await companies.analytics(fixture.employer.id);
    expect(retentionByRole[0].left).toBe(3);
    expect(timeToJoin.confirmedByCandidate).toBe(0);
  });

  it("shows admins the same retention, by employer", async () => {
    const { byEmployer } = await admin.retention();
    expect(byEmployer.find((r) => r.key === fixture.company.name)).toMatchObject({ eligible: 11, stayed: 7, left: 3, rate: 0.7 });
  });

  it("slices show-up by role, city, distance and hour, counting only who held a seat", async () => {
    const [held] = await prisma.application.findMany({ where: { driveId: fixture.drive.id }, take: 1 });
    await prisma.checkIn.create({ data: { applicationId: held.id, method: "MANUAL", isValid: true } });
    await prisma.application.update({ where: { id: held.id }, data: { slotId: fixture.roomySlot.id } });
    await refresh();

    const { showUp } = await companies.analytics(fixture.employer.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { id: fixture.drive.roleId } });
    expect(showUp.byRole).toEqual([expect.objectContaining({ key: role.title, held: 11, attended: 1 })]);
    expect(showUp.byCity).toEqual([expect.objectContaining({ key: "Bengaluru", held: 11, attended: 1 })]);
    expect(showUp.byDistance.reduce((sum, b) => sum + b.held, 0)).toBe(11);
    expect(showUp.byHour).toHaveLength(1);
    expect(showUp.byHour[0]).toMatchObject({ held: 1, attended: 1 });
  });
});

describe("the candidate's own record", () => {
  it("shows what they applied to and what was recorded after the hire, and nothing about anyone else", async () => {
    const { userId, candidateId } = fixture.candidates[0];
    const [application] = await prisma.application.findMany({ where: { driveId: fixture.drive.id, candidateId } });
    await prisma.application.update({ where: { id: application.id }, data: { shortlistedAt: new Date(), shortlistedById: fixture.employer.id } });
    await prisma.report.create({ data: { targetType: "CANDIDATE", candidateId, reason: "ABUSIVE", details: "a private note", reporterUserId: fixture.employer.id } });
    await prisma.hiringOutcome.update({ where: { applicationId: application.id }, data: { candidateStarted: true } });

    const record = await applications.myRecord(userId);

    expect(record.entries).toEqual([
      expect.objectContaining({ hired: true, state: "attended", after: expect.objectContaining({ started: true, retained: true, yourAnswer: true }) }),
    ]);
    const text = JSON.stringify(record);
    for (const hidden of ["shortlist", "a private note", "ABUSIVE", "reliability", "match", fixture.employer.id]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("marks an absence it won't hold against them when the drive moved and the notice never reached them", async () => {
    const { userId, candidateId } = fixture.candidates[12];
    const application = await prisma.application.create({ data: { driveId: fixture.drive.id, candidateId, state: "NO_SHOW" } });
    await prisma.auditLog.create({
      data: { entityType: "application", entityId: application.id, action: "NONE->CONFIRMED", createdAt: new Date(Date.now() - 10 * DAY) },
    });
    await prisma.driveReschedule.create({
      data: { driveId: fixture.drive.id, version: 1, fromStartsAt: new Date(), fromEndsAt: new Date(), toStartsAt: new Date(), toEndsAt: new Date(), byId: fixture.employer.id },
    });
    await prisma.drive.update({ where: { id: fixture.drive.id }, data: { scheduleVersion: 1 } });

    expect((await applications.myRecord(userId)).entries[0].state).toBe("notAttendedExcused");

    await prisma.notification.create({
      data: { driveId: fixture.drive.id, candidateId, templateKey: "drive_rescheduled", scheduleVersion: 1, status: "SENT", channel: "test", attempt: 1, jobId: "t" },
    });
    expect((await applications.myRecord(userId)).entries[0].state).toBe("notAttended");
  });
});
