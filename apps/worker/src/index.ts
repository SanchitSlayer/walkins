import { RateLimitError, Worker } from "bullmq";
import { Api, Bot } from "node-telegram-bot-api";
import { prisma } from "@walkins/db";
import {
  type AlertJob,
  ALERTS_QUEUE,
  EMBED_QUEUE,
  type EmbedJob,
  MAINTENANCE_QUEUE,
  type NotificationChannel,
  VOICE_JOB_OPTIONS,
  VOICE_QUEUE,
  type VoiceJob,
} from "@walkins/shared";
import { AlertService } from "./alerts/alert-service";
import { processAlert } from "./alerts/process-alert";
import { registerBotCommands } from "./bot/telegram-bot";
import { ChannelResolver } from "./channels/channel-resolver";
import { ConsoleChannel } from "./channels/console-channel";
import { processEmbed } from "./embed/process-embed";
import { TelegramChannel } from "./channels/telegram-channel";
import { WhatsAppChannel } from "./channels/whatsapp-channel";
import { backfillEmbeddings, registerSchedules, runMaintenance } from "./maintenance/maintenance-jobs";
import { embed, transcribe } from "./ml/sidecar";
import { createAlertsQueue, createEmbedQueue, createMaintenanceQueue } from "./queues";
import { connection } from "./redis";
import { listObjects, readObject, removeObject } from "./storage";
import { processVoice } from "./voice/process-voice";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;
const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";

// Telegram allows roughly 30 messages a second per bot; staying under it
// leaves room for the bot's own replies to /jobs and /start.
const ALERTS_PER_SECOND = 25;

function buildChannels(): NotificationChannel[] {
  if (!TELEGRAM_BOT_TOKEN) {
    return [new WhatsAppChannel(), new ConsoleChannel()];
  }
  const alertsApi = new Api(TELEGRAM_BOT_TOKEN, { maxRetries: 0, timeoutMs: 15_000 });
  const telegram = new TelegramChannel(alertsApi, async ({ candidateId }) => {
    await prisma.candidate.update({ where: { id: candidateId }, data: { telegramChatId: null } });
  });
  return [new WhatsAppChannel(), telegram];
}

async function main() {
  const alertsQueue = createAlertsQueue(connection);
  const maintenanceQueue = createMaintenanceQueue(connection);
  const embedQueue = createEmbedQueue(connection);
  const alertService = new AlertService(alertsQueue);
  const reembed = async (job: EmbedJob) => {
    await embedQueue.add(job.kind, job);
  };
  const resolver = new ChannelResolver(buildChannels());

  const alertsWorker: Worker<AlertJob, string> = new Worker(
    ALERTS_QUEUE,
    (job) =>
      processAlert(job, {
        resolver,
        webUrl: WEB_URL,
        onRateLimited: async (retryAfterMs) => {
          await alertsWorker.rateLimit(retryAfterMs);
          return new RateLimitError();
        },
      }),
    { connection, concurrency: 5, limiter: { max: ALERTS_PER_SECOND, duration: 1000 } },
  );
  const maintenanceWorker = new Worker(
    MAINTENANCE_QUEUE,
    (job) => runMaintenance(job.name, { alerts: alertService, listObjects, removeObject, reembed }),
    { connection, concurrency: 1 },
  );
  // One transcription at a time: the sidecar has a 1.5GB memory cap and
  // Whisper uses every thread it is given.
  const voiceWorker: Worker<VoiceJob, string> = new Worker(
    VOICE_QUEUE,
    (job) =>
      processVoice(
        { data: job.data, attemptsMade: job.attemptsMade, maxAttempts: job.opts.attempts ?? VOICE_JOB_OPTIONS.attempts },
        { read: readObject, transcribe, reembed },
      ),
    { connection, concurrency: 1, lockDuration: 5 * 60_000 },
  );
  const embedWorker: Worker<EmbedJob, string> = new Worker(EMBED_QUEUE, (job) => processEmbed(job, { embed }), {
    connection,
    concurrency: 1,
  });

  for (const worker of [alertsWorker, maintenanceWorker, voiceWorker, embedWorker]) {
    worker.on("completed", (job, result) => console.log(`worker: ${worker.name} ${job.id} ${result}`));
    worker.on("failed", (job, err) =>
      console.error(`worker: ${worker.name} ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`),
    );
  }

  await registerSchedules(maintenanceQueue);
  const missing = await backfillEmbeddings(reembed);
  if (missing > 0) console.log(`worker: queued embeddings for ${missing} candidates and drives`);

  let bot: Bot | null = null;
  if (TELEGRAM_BOT_TOKEN) {
    bot = new Bot(TELEGRAM_BOT_TOKEN);
    registerBotCommands(bot, connection, WEB_URL);
    bot.startPolling().catch((err) => console.error("worker: telegram polling stopped", err));
    console.log("worker: telegram bot polling");
  } else {
    console.log("worker: TELEGRAM_BOT_TOKEN not set, alerts go to the console channel");
  }

  const shutdown = async () => {
    bot?.stop();
    await Promise.all([alertsWorker.close(), maintenanceWorker.close(), voiceWorker.close(), embedWorker.close()]);
    await Promise.all([alertsQueue.close(), maintenanceQueue.close(), embedQueue.close()]);
    await prisma.$disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

connection.on("connect", () => {
  console.log("worker: connected to redis");
});

main().catch((err) => {
  console.error("worker: failed to start", err);
  process.exit(1);
});
