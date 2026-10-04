import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  ALERT_JOB_OPTIONS,
  type AlertJob,
  alertJobId,
  ALERTS_QUEUE,
  EMBED_JOB_OPTIONS,
  EMBED_QUEUE,
  type EmbedJob,
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

  async transcribe(job: VoiceJob) {
    await this.voice.add("transcribe", job, { jobId: voiceJobId(job) });
  }

  async reembed(job: EmbedJob) {
    await this.embed.add(job.kind, job);
  }

  async alert(job: AlertJob) {
    await this.alerts.add(job.templateKey, job, { jobId: alertJobId(job) });
  }

  async onModuleDestroy() {
    await Promise.all([this.alerts.close(), this.voice.close(), this.embed.close()]);
    this.connection.disconnect();
  }
}
