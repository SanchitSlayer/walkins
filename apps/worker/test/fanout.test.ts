import { afterAll, describe, expect, it } from "vitest";
import type { findCandidatesForDrive } from "@walkins/db";
import { AlertService } from "../src/alerts/alert-service";
import { createAlertsQueue } from "../src/queues";
import { connection } from "../src/redis";

// A throwaway queue on the real Redis: this checks what BullMQ actually does
// with our job ids, which a fake queue could not.
const queue = createAlertsQueue(connection, `test-alerts-${process.pid}-${Date.now()}`);

const candidates = Array.from({ length: 5 }, (_, i) => ({
  candidateId: `c${i}`,
  distanceMeters: i * 100,
  telegramChatId: null,
}));

let targetingCalls = 0;
const fakeTargeting: typeof findCandidatesForDrive = async (_driveId, { after, limit = 500 } = {}) => {
  targetingCalls += 1;
  const start = after ? candidates.findIndex((c) => c.candidateId === after.candidateId) + 1 : 0;
  return candidates.slice(start, start + limit);
};

afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
  connection.disconnect();
});

describe("AlertService.fanOut", () => {
  it("queues exactly one job per targeted candidate, paging past the page size", async () => {
    const alerts = new AlertService(queue, fakeTargeting, 2);

    await expect(alerts.fanOut("d1", "drive_48h")).resolves.toBe(5);
    expect(targetingCalls).toBe(3);

    const ids = (await queue.getJobs(["waiting"])).map((job) => job.id).sort();
    expect(ids).toEqual(candidates.map((c) => `alert.d1.${c.candidateId}.drive_48h`));
  });

  it("queues nothing new when the same fanout runs again", async () => {
    const alerts = new AlertService(queue, fakeTargeting, 2);

    await alerts.fanOut("d1", "drive_48h");

    expect(await queue.count()).toBe(5);
  });
});
