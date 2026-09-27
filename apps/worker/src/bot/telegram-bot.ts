import type { Bot, Context } from "node-telegram-bot-api";
import type { Redis } from "ioredis";
import { findLiveDrivesForCandidate, prisma } from "@walkins/db";
import { formatDistance, formatWhen, telegramLinkKey } from "@walkins/shared";

const JOBS_LIMIT = 5;

function chatIdOf(ctx: Context): string | null {
  return ctx.chatId === undefined ? null : String(ctx.chatId);
}

export function registerBotCommands(bot: Bot, redis: Redis, webUrl: string) {
  bot.command("start", async (ctx) => {
    const chatId = chatIdOf(ctx);
    const token = typeof ctx.match === "string" ? ctx.match : "";
    if (!chatId) return;
    if (!token) {
      await ctx.reply(`To get walk-in alerts here, open your profile on Walkins and choose Connect Telegram:\n${webUrl}/profile`);
      return;
    }

    // GETDEL reads and deletes in one step, so two /start messages racing
    // with the same token can't both claim it.
    const candidateId = await redis.getdel(telegramLinkKey(token));
    if (!candidateId) {
      await ctx.reply(`That link has expired or was already used. Open your profile to get a new one:\n${webUrl}/profile`);
      return;
    }

    // A chat belongs to one account: if it was linked elsewhere, it moves here.
    await prisma.$transaction([
      prisma.candidate.updateMany({ where: { telegramChatId: chatId, NOT: { id: candidateId } }, data: { telegramChatId: null } }),
      prisma.candidate.update({ where: { id: candidateId }, data: { telegramChatId: chatId } }),
    ]);
    await ctx.reply(
      "Connected. You'll get alerts here for walk-in drives within your travel distance.\n\nSend /jobs to see what's on now, or /stop to turn alerts off.",
    );
  });

  bot.command("jobs", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (!chatId) return;
    const candidate = await prisma.candidate.findUnique({ where: { telegramChatId: chatId } });
    if (!candidate) {
      await ctx.reply(`This chat isn't connected to a Walkins profile yet. Connect it from your profile:\n${webUrl}/profile`);
      return;
    }

    const reachable = await findLiveDrivesForCandidate(candidate.id, JOBS_LIMIT);
    if (reachable.length === 0) {
      await ctx.reply(
        `No live drives within your ${candidate.maxTravelKm} km travel distance right now. ` +
          `You can widen your travel distance on your profile:\n${webUrl}/profile`,
      );
      return;
    }

    const drives = await prisma.drive.findMany({
      where: { id: { in: reachable.map((r) => r.driveId) } },
      include: { role: true, company: true },
    });
    const byId = new Map(drives.map((d) => [d.id, d]));
    const now = new Date();
    const lines = reachable.flatMap(({ driveId, distanceMeters }, index) => {
      const drive = byId.get(driveId);
      if (!drive) return [];
      const when = formatWhen(drive.startsAt.toISOString(), drive.endsAt.toISOString(), now);
      return [
        `${index + 1}. ${drive.role.title} at ${drive.company.name}`,
        `${when.day}, ${when.time} · ${formatDistance(distanceMeters / 1000)}`,
        `${webUrl}/drives/${drive.id}`,
        "",
      ];
    });
    await ctx.reply([`Nearest live drives within ${candidate.maxTravelKm} km:`, "", ...lines].join("\n").trim(), {
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("stop", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (!chatId) return;
    await prisma.candidate.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null } });
    await ctx.reply(`Alerts are off and this chat is disconnected. You can connect again any time from your profile:\n${webUrl}/profile`);
  });

  bot.catch((err, ctx) => {
    console.error(`worker: telegram update ${ctx.update.update_id} failed`, err);
  });
}
