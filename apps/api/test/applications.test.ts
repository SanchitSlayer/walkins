import { ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { IllegalTransitionError, prisma, SlotFullError } from "@walkins/db";
import { ApplicationsService } from "../src/applications/applications.service";
import { redis } from "../src/common/redis";
import type { LiveGateway } from "../src/live/live.gateway";
import { createFixture, type Fixture, removeFixture } from "./fixtures";

const live = { publish: vi.fn(async () => {}) } as unknown as LiveGateway;
const applications = new ApplicationsService(live);
let fixture: Fixture;

beforeAll(async () => {
  fixture = await createFixture("Apply Test", 14);
});

afterAll(async () => {
  await removeFixture(fixture);
  await prisma.$disconnect();
  redis.disconnect();
});

function bookedCount(slotId: string) {
  return prisma.driveSlot.findUniqueOrThrow({ where: { id: slotId } }).then((slot) => slot.bookedCount);
}

describe("applying for a slot", () => {
  it("never sells the last seat twice when ten candidates take it at once", async () => {
    const racers = fixture.candidates.slice(0, 10);

    const results = await Promise.allSettled(
      racers.map(({ userId }) => applications.apply(userId, fixture.drive.id, fixture.lastSeatSlot.id, {})),
    );

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(9);
    expect(lost.every((r) => r.reason instanceof SlotFullError)).toBe(true);
    expect(await bookedCount(fixture.lastSeatSlot.id)).toBe(1);
    expect(await prisma.application.count({ where: { slotId: fixture.lastSeatSlot.id, state: "CONFIRMED" } })).toBe(1);
  });

  it("keeps one application and one seat when a candidate applies to two slots at once", async () => {
    const { userId, candidateId } = fixture.candidates[10];
    const roomyBefore = await bookedCount(fixture.roomySlot.id);

    const results = await Promise.allSettled([
      applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {}),
      applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {}),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [rejected] = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(await prisma.application.count({ where: { driveId: fixture.drive.id, candidateId } })).toBe(1);
    expect(await bookedCount(fixture.roomySlot.id)).toBe(roomyBefore + 1);
  });

  it("gives the seat back once on release, and takes it again on re-applying", async () => {
    const { userId, candidateId } = fixture.candidates[11];
    const before = await bookedCount(fixture.roomySlot.id);

    const applied = await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});
    expect(await bookedCount(fixture.roomySlot.id)).toBe(before + 1);

    const released = await applications.release(userId, applied.id);
    expect(released.state).toBe("WITHDRAWN");
    expect(released.slotStartsAt).toBeNull();
    expect(await bookedCount(fixture.roomySlot.id)).toBe(before);

    await expect(applications.release(userId, applied.id)).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(await bookedCount(fixture.roomySlot.id)).toBe(before);

    const reapplied = await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});
    expect(reapplied.id).toBe(applied.id);
    expect(reapplied.state).toBe("CONFIRMED");
    expect(await bookedCount(fixture.roomySlot.id)).toBe(before + 1);

    const trail = await prisma.auditLog.findMany({ where: { entityId: applied.id }, orderBy: { createdAt: "asc" } });
    expect(trail.map((row) => row.action)).toEqual(["NONE->CONFIRMED", "CONFIRMED->WITHDRAWN", "WITHDRAWN->CONFIRMED"]);
    expect(trail.every((row) => row.actorUserId === userId)).toBe(true);
    expect(await prisma.application.count({ where: { driveId: fixture.drive.id, candidateId } })).toBe(1);
  });

  it("refuses an illegal move and leaves the application untouched", async () => {
    const { userId } = fixture.candidates[12];
    const applied = await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});

    await expect(
      applications.updateByEmployer(fixture.company.id, fixture.employer.id, applied.id, { to: "HIRED" }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);

    const row = await prisma.application.findUniqueOrThrow({ where: { id: applied.id } });
    expect(row.state).toBe("CONFIRMED");
    expect(await prisma.auditLog.count({ where: { entityId: applied.id } })).toBe(1);
  });

  it("treats another company's application as missing", async () => {
    const { userId } = fixture.candidates[13];
    const applied = await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});

    await expect(
      applications.updateByEmployer("some-other-company", fixture.employer.id, applied.id, { to: "INTERVIEWED" }),
    ).rejects.toThrow("Application not found");
  });
});
