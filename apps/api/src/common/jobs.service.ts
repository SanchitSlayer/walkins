import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  ALERT_JOB_OPTIONS,
  type AlertJob,
  alertJobId,
  ALERTS_QUEUE,
  CHARGE_JOB_OPTIONS,
  CHARGE_QUEUE,
  type ChargeJob,
  chargeJobId,
  EMBED_JOB_OPTIONS,
  EMBED_QUEUE,
  type EmbedJob,
  MAINTENANCE_QUEUE,
  VOICE_JOB_OPTIONS,
  VOICE_QUEUE,
  type VoiceJob,
  voiceJobId,
} from "@walkins/shared";

// The API adds jobs; the worker runs them. Names, ids and options come from
// @walkins/shared so the two sides can't disagree about any of them.
@Injectable()
export class JobsService implements OnModuleDestroy {
  // BullMQ needs a connection that retries forever rather than failing a
  // command, which the API's shared Redis client doesn't do.
  private readonly connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  private readonly alerts = new Queue<AlertJob>(ALERTS_QUEUE, { connection: this.connection, defaultJobOptions: ALERT_JOB_OPTIONS });
  private readonly voice = new Queue<VoiceJob>(VOICE_QUEUE, { connection: this.connection, defaultJobOptions: VOICE_JOB_OPTIONS });
  private readonly embed = new Queue<EmbedJob>(EMBED_QUEUE, { connection: this.connection, defaultJobOptions: EMBED_JOB_OPTIONS });
  private readonly charges = new Queue<ChargeJob>(CHARGE_QUEUE, { connection: this.connection, defaultJobOptions: CHARGE_JOB_OPTIONS });
  // Never added to from here; held so the admin panel can read its failures.
  private readonly maintenance = new Queue(MAINTENANCE_QUEUE, { connection: this.connection });

  async transcribe(job: VoiceJob) {
    await this.voice.add("transcribe", job, { jobId: voiceJobId(job) });
  }

  async reembed(job: EmbedJob) {
    await this.embed.add(job.kind, job);
  }

  async alert(job: AlertJob) {
    await this.alerts.add(job.templateKey, job, { jobId: alertJobId(job) });
  }

  async charge(job: ChargeJob) {
    await this.charges.add("charge", job, { jobId: chargeJobId(job) });
  }

  // Every queue's failed set is its dead-letter list.
  queues(): Queue[] {
    return [this.alerts, this.voice, this.embed, this.charges, this.maintenance];
  }

  async onModuleDestroy() {
    await Promise.all(this.queues().map((q) => q.close()));
    this.connection.disconnect();
  }
}
