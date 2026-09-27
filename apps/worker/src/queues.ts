import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { TemplateKey } from "@walkins/shared";

export const ALERTS_QUEUE = "alerts";
export const MAINTENANCE_QUEUE = "maintenance";

export type AlertJob = {
  driveId: string;
  candidateId: string;
  templateKey: TemplateKey;
};

// BullMQ drops an add whose id already exists, which stops a re-run fanout
// from queueing the same alert twice. It is only a first line of defence:
// the id is forgotten once the job is removed, and the notifications claim
// index is what actually rules out a second send. Dots, because BullMQ
// rejects custom ids with more than two colons.
export function alertJobId({ driveId, candidateId, templateKey }: AlertJob): string {
  return `alert.${driveId}.${candidateId}.${templateKey}`;
}

// Completed jobs are kept for a week so their ids keep deduplicating across
// the whole 48-hour alert window. Jobs that exhaust their attempts are never
// removed: that failed set is the dead-letter list the dlq script prints.
export function createAlertsQueue(connection: Redis, name = ALERTS_QUEUE) {
  return new Queue<AlertJob>(name, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: false,
    },
  });
}

export function createMaintenanceQueue(connection: Redis) {
  return new Queue(MAINTENANCE_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: false,
    },
  });
}
