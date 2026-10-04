import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import {
  ALERT_JOB_OPTIONS,
  type AlertJob,
  ALERTS_QUEUE,
  EMBED_JOB_OPTIONS,
  EMBED_QUEUE,
  type EmbedJob,
  MAINTENANCE_QUEUE,
  VOICE_JOB_OPTIONS,
  VOICE_QUEUE,
  type VoiceJob,
} from "@walkins/shared";

// Names, ids and options live in @walkins/shared, because the API adds jobs
// to these queues too. The alerts queue's failed set is the dead-letter list
// the dlq script prints.
export function createAlertsQueue(connection: Redis, name = ALERTS_QUEUE) {
  return new Queue<AlertJob>(name, { connection, defaultJobOptions: ALERT_JOB_OPTIONS });
}

export function createVoiceQueue(connection: Redis, name = VOICE_QUEUE) {
  return new Queue<VoiceJob>(name, { connection, defaultJobOptions: VOICE_JOB_OPTIONS });
}

export function createEmbedQueue(connection: Redis, name = EMBED_QUEUE) {
  return new Queue<EmbedJob>(name, { connection, defaultJobOptions: EMBED_JOB_OPTIONS });
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
