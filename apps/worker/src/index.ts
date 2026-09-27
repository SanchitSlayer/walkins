import { RateLimitError, Worker } from "bullmq";
import { Api, Bot } from "node-telegram-bot-api";
import { prisma } from "@walkins/db";
import type { NotificationChannel } from "@walkins/shared";
import { AlertService } from "./alerts/alert-service";
import { processAlert } from "./alerts/process-alert";
import { registerBotCommands } from "./bot/telegram-bot";
import { ChannelResolver } from "./channels/channel-resolver";
import { ConsoleChannel } from "./channels/console-channel";
import { TelegramChannel } from "./channels/telegram-channel";
import { WhatsAppChannel } from "./channels/whatsapp-channel";
import { registerSchedules, runMaintenance } from "./maintenance/maintenance-jobs";
import { ALERTS_QUEUE, type AlertJob, createAlertsQueue, createMaintenanceQueue, MAINTENANCE_QUEUE } from "./queues";
import { connection } from "./redis";

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
  const alertService = new AlertService(alertsQueue);
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
  const maintenanceWorker = new Worker(MAINTENANCE_QUEUE, (job) => runMaintenance(job.name, alertService), {
    connection,
    concurrency: 1,
  });

  for (const worker of [alertsWorker, maintenanceWorker]) {
    worker.on("completed", (job, result) => console.log(`worker: ${worker.name} ${job.id} ${result}`));
    worker.on("failed", (job, err) =>
      console.error(`worker: ${worker.name} ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`),
    );
  }

  await registerSchedules(maintenanceQueue);

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
    await Promise.all([alertsWorker.close(), maintenanceWorker.close()]);
    await Promise.all([alertsQueue.close(), maintenanceQueue.close()]);
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
