import type { HttpException } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@walkins/db";
import { ApplicationsService } from "../src/applications/applications.service";
import type { JobsService } from "../src/common/jobs.service";
import { DrivesService } from "../src/drives/drives.service";
import type { GeocodingService } from "../src/drives/geocoding.service";
import type { LiveGateway } from "../src/live/live.gateway";
import { createFixture, type Fixture, removeFixture } from "./fixtures";

const live = { publish: vi.fn(async () => {}) } as unknown as LiveGateway;
const jobs = { alertBooked: vi.fn(async () => {}), reembed: vi.fn(async () => {}) } as unknown as JobsService;
const drives = new DrivesService({} as GeocodingService, jobs);
const applications = new ApplicationsService(live);

const HOUR = 3600_000;
let fixture: Fixture;
let candidate = 0;

function nextCandidate() {
  return fixture.candidates[candidate++];
}

function code(err: unknown): string | undefined {
  return ((err as HttpException).getResponse?.() as { code?: string } | undefined)?.code;
}

const refusedWith = (expected: string) => (err: unknown) => code(err) === expected;

// A LIVE drive tomorrow, three one-hour slots of two seats each.
async function tomorrowsDrive() {
  const start = new Date(Date.now() + 24 * HOUR);
  start.setMinutes(0, 0, 0);
  return prisma.drive.create({
    data: {
      companyId: fixture.company.id,
      ownerId: fixture.employer.id,
      roleId: fixture.drive.roleId,
      cityId: fixture.drive.cityId,
      salaryMin: 15000,
      salaryMax: 20000,
      venueAddress: "Reschedule Test Venue",
      venueLat: fixture.venue.lat,
      venueLng: fixture.venue.lng,
      startsAt: start,
      endsAt: new Date(start.getTime() + 3 * HOUR),
      capacity: 6,
      experienceMin: 0,
      experienceMax: 5,
      status: "LIVE",
      slots: { create: [0, 1, 2].map((i) => ({ startsAt: new Date(start.getTime() + i * HOUR), capacity: 2 })) },
    },
    include: { slots: { orderBy: { startsAt: "asc" } } },
  });
}

function slotsOf(driveId: string) {
  return prisma.driveSlot.findMany({ where: { driveId }, orderBy: { startsAt: "asc" } });
}

beforeAll(async () => {
  fixture = await createFixture("Reschedule Test", 16);
});

beforeEach(() => vi.mocked(jobs.alertBooked).mockClear());

afterAll(async () => {
  await removeFixture(fixture);
});

describe("rescheduling a drive that hasn't started", () => {
  it("moves the drive and its slots together, records the change, and tells everyone booked", async () => {
    const drive = await tomorrowsDrive();
    const booked = await applications.apply(nextCandidate().userId, drive.id, drive.slots[1].id, {});
    const to = new Date(drive.startsAt.getTime() + 24 * HOUR);

    const moved = await drives.reschedule(fixture.employer.id, drive.id, { startsAt: to, endsAt: new Date(to.getTime() + 3 * HOUR) });

    expect(moved.startsAt).toEqual(to);
    expect((await slotsOf(drive.id)).map((s) => s.startsAt.getTime() - to.getTime())).toEqual([0, HOUR, 2 * HOUR]);
    const application = await prisma.application.findUniqueOrThrow({ where: { id: booked.id }, include: { slot: true } });
    expect(application.slot?.startsAt).toEqual(new Date(to.getTime() + HOUR));
    expect(moved.reschedules[0]).toMatchObject({ fromStartsAt: drive.startsAt.toISOString(), toStartsAt: to.toISOString(), by: { userId: fixture.employer.id } });
    expect((await prisma.drive.findUniqueOrThrow({ where: { id: drive.id } })).scheduleVersion).toBe(1);
    expect(jobs.alertBooked).toHaveBeenCalledWith(drive.id, "drive_rescheduled", 1);
  });

  it("gives a longer window new slots with the same seats", async () => {
    const drive = await tomorrowsDrive();
    const moved = await drives.reschedule(fixture.employer.id, drive.id, { startsAt: drive.startsAt, endsAt: new Date(drive.startsAt.getTime() + 4 * HOUR) });
    expect((await slotsOf(drive.id)).map((s) => s.capacity)).toEqual([2, 2, 2, 2]);
    expect(moved.capacity).toBe(8);
  });

  it("moves people out of dropped slots into the nearest remaining slot with room", async () => {
    const drive = await tomorrowsDrive();
    const [early, late1, late2] = [nextCandidate(), nextCandidate(), nextCandidate()];
    await applications.apply(early.userId, drive.id, drive.slots[1].id, {});
    const a1 = await applications.apply(late1.userId, drive.id, drive.slots[2].id, {});
    const a2 = await applications.apply(late2.userId, drive.id, drive.slots[2].id, {});

    await drives.reschedule(fixture.employer.id, drive.id, { startsAt: drive.startsAt, endsAt: new Date(drive.startsAt.getTime() + 2 * HOUR) });

    const [first, second] = await slotsOf(drive.id);
    const moved = await prisma.application.findMany({ where: { id: { in: [a1.id, a2.id] } } });
    // Slot 2 had one seat left, so one goes there and the other to slot 1.
    expect(moved.map((a) => a.slotId).sort()).toEqual([first.id, second.id].sort());
    expect([first.bookedCount, second.bookedCount]).toEqual([1, 2]);
    expect((await prisma.driveReschedule.findFirstOrThrow({ where: { driveId: drive.id } })).reseated).toBe(2);
  });

  it("refuses, naming who would be stranded, when the remaining slots can't hold everyone", async () => {
    const drive = await tomorrowsDrive();
    const people = Array.from({ length: 5 }, () => nextCandidate());
    for (const [i, person] of people.entries()) await applications.apply(person.userId, drive.id, drive.slots[Math.min(2, Math.floor(i / 2))].id, {});

    const refusal = await drives
      .reschedule(fixture.employer.id, drive.id, { startsAt: drive.startsAt, endsAt: new Date(drive.startsAt.getTime() + 2 * HOUR) })
      .catch((err: HttpException) => err);

    expect(code(refusal)).toBe("errors.drive.rescheduleStrands");
    const body = (refusal as HttpException).getResponse() as { message: string; stranded: string[] };
    expect(body.stranded).toEqual(["Reschedule Test Candidate " + (candidate - 1)]);
    expect(body.message).toContain("cancel it instead");
    expect(await slotsOf(drive.id)).toHaveLength(3);
    expect((await prisma.drive.findUniqueOrThrow({ where: { id: drive.id } })).scheduleVersion).toBe(0);
  });

  it("refuses a window the slots don't divide, and a time in the past", async () => {
    const drive = await tomorrowsDrive();
    await expect(
      drives.reschedule(fixture.employer.id, drive.id, { startsAt: drive.startsAt, endsAt: new Date(drive.startsAt.getTime() + 2.5 * HOUR) }),
    ).rejects.toSatisfy(refusedWith("errors.drive.slotsUneven"));
    await expect(
      drives.reschedule(fixture.employer.id, drive.id, { startsAt: new Date(Date.now() - 2 * HOUR), endsAt: new Date(Date.now() + HOUR) }),
    ).rejects.toSatisfy(refusedWith("errors.drive.rescheduleIntoPast"));
  });

  it("refuses a drive whose slots don't fill its window from the start, rather than reseat on a guess", async () => {
    // The fixture's slots start an hour after its doors open.
    const before = await slotsOf(fixture.drive.id);
    await expect(
      drives.reschedule(fixture.employer.id, fixture.drive.id, { startsAt: fixture.drive.startsAt, endsAt: new Date(fixture.drive.endsAt.getTime() + HOUR) }),
    ).rejects.toSatisfy(refusedWith("errors.drive.slotsDontTile"));

    const drive = await tomorrowsDrive();
    await prisma.driveSlot.update({ where: { id: drive.slots[1].id }, data: { startsAt: new Date(drive.slots[1].startsAt.getTime() + 15 * 60_000) } });
    await expect(
      drives.reschedule(fixture.employer.id, drive.id, { startsAt: drive.startsAt, endsAt: new Date(drive.startsAt.getTime() + 2 * HOUR) }),
    ).rejects.toSatisfy(refusedWith("errors.drive.slotsDontTile"));
    expect(await slotsOf(fixture.drive.id)).toEqual(before);
  });

  it("won't change a drive's time through the edit form, which used to leave the slots behind", async () => {
    const drive = await tomorrowsDrive();
    await prisma.drive.update({ where: { id: drive.id }, data: { status: "DRAFT" } });
    await expect(drives.update(fixture.employer.id, drive.id, { startsAt: new Date(drive.startsAt.getTime() + HOUR) })).rejects.toSatisfy(
      refusedWith("errors.drive.useReschedule"),
    );
    await expect(drives.update(fixture.employer.id, drive.id, { startsAt: drive.startsAt, salaryMax: 21000 })).resolves.toMatchObject({ salaryMax: 21000 });
  });
});

describe("rescheduling a drive already under way", () => {
  // Started ten minutes ago, laid out as create() lays drives out: three
  // one-hour slots from the start, the first already running.
  async function todaysDrive() {
    const start = new Date(Date.now() - 10 * 60_000);
    return prisma.drive.create({
      data: {
        companyId: fixture.company.id,
        ownerId: fixture.employer.id,
        roleId: fixture.drive.roleId,
        cityId: fixture.drive.cityId,
        salaryMin: 15000,
        salaryMax: 20000,
        venueAddress: "Reschedule Test Venue",
        venueLat: fixture.venue.lat,
        venueLng: fixture.venue.lng,
        startsAt: start,
        endsAt: new Date(start.getTime() + 3 * HOUR),
        capacity: 6,
        experienceMin: 0,
        experienceMax: 5,
        status: "LIVE",
        slots: { create: [0, 1, 2].map((i) => ({ startsAt: new Date(start.getTime() + i * HOUR), capacity: 2 })) },
      },
      include: { slots: { orderBy: { startsAt: "asc" } } },
    });
  }

  it("keeps its start fixed", async () => {
    const drive = await todaysDrive();
    await expect(
      drives.reschedule(fixture.employer.id, drive.id, { startsAt: new Date(drive.startsAt.getTime() + HOUR), endsAt: new Date(drive.endsAt.getTime() + HOUR) }),
    ).rejects.toSatisfy(refusedWith("errors.drive.startLocked"));
  });

  it("can end earlier, moving people from a dropped slot into one that hasn't started, never one already running", async () => {
    const drive = await todaysDrive();
    const booked = await applications.apply(nextCandidate().userId, drive.id, drive.slots[2].id, {});

    await drives.reschedule(fixture.employer.id, drive.id, { startsAt: drive.startsAt, endsAt: new Date(drive.startsAt.getTime() + 2 * HOUR) });

    const application = await prisma.application.findUniqueOrThrow({ where: { id: booked.id } });
    expect(application).toMatchObject({ slotId: drive.slots[1].id, state: "CONFIRMED" });
  });

  it("refuses to end earlier when the only slot left with room has already started", async () => {
    const drive = await todaysDrive();
    await prisma.driveSlot.update({ where: { id: drive.slots[1].id }, data: { bookedCount: 2 } });
    await applications.apply(nextCandidate().userId, drive.id, drive.slots[2].id, {});

    await expect(
      drives.reschedule(fixture.employer.id, drive.id, { startsAt: drive.startsAt, endsAt: new Date(drive.startsAt.getTime() + 2 * HOUR) }),
    ).rejects.toSatisfy(refusedWith("errors.drive.rescheduleStrands"));
  });

  it("can run later, adding a slot", async () => {
    const drive = await todaysDrive();
    await drives.reschedule(fixture.employer.id, drive.id, { startsAt: drive.startsAt, endsAt: new Date(drive.startsAt.getTime() + 4 * HOUR) });
    expect(await slotsOf(drive.id)).toHaveLength(4);
  });
});
