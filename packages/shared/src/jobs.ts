import type { TemplateKey } from "./notifications";

// Queue names, job payloads, job ids and job options, shared because the API
// adds jobs that the worker processes. Options belong to whoever adds the
// job, so both sides read the same ones from here.
export const ALERTS_QUEUE = "alerts";
export const MAINTENANCE_QUEUE = "maintenance";
export const VOICE_QUEUE = "voice";
export const EMBED_QUEUE = "embed";

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
export const ALERT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: false,
} as const;

export type VoiceJob = { introId: string };

export function voiceJobId({ introId }: VoiceJob): string {
  return `voice.${introId}`;
}

// A recording the sidecar refuses (unreadable, too long) fails at once; only
// the sidecar being down or slow is worth retrying.
export const VOICE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 15_000 },
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: false,
} as const;

export type EmbedJob = { kind: "candidate" | "drive"; id: string };

// Embed jobs carry no id. A fixed id would also drop a job queued while the
// same one is running, which may already have read the old profile. Instead
// every change queues a job and one worker runs them in order, so the last
// job always reads the latest text.
export const EMBED_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 15_000 },
  removeOnComplete: true,
  removeOnFail: false,
} as const;

export const CHARGE_QUEUE = "charge";

export type ChargeJob = { checkInId: string };

// The job id only saves a duplicate run while one is queued; a second charge
// is ruled out by the ledger's unique txnId, not by this.
export function chargeJobId({ checkInId }: ChargeJob): string {
  return `charge.${checkInId}`;
}

// More attempts than other jobs and kept when they fail: an uncharged
// show-up is money the platform is owed, and the failed set is where an
// admin finds it. The 15-minute sweep queues it again regardless.
export const CHARGE_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: false,
} as const;
