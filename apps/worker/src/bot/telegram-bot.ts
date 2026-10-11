import type { Bot, Context } from "node-telegram-bot-api";
import type { Redis } from "ioredis";
import { findLiveDrivesForCandidate, prisma } from "@walkins/db";
import { DEFAULT_LOCALE, formatDistance, formatWhen, type MessageKey, type MessageValues, telegramLinkKey, translate } from "@walkins/shared";

const JOBS_LIMIT = 5;

// The bot's wording is in the shared catalog (bot.*) with everything else a
// person reads. It answers in the default locale until a candidate's
// language is known.
const say = (key: MessageKey, values?: MessageValues) => translate(DEFAULT_LOCALE, key, values);

function chatIdOf(ctx: Context): string | null {
  return ctx.chatId === undefined ? null : String(ctx.chatId);
}

export function registerBotCommands(bot: Bot, redis: Redis, webUrl: string) {
  const profile = `${webUrl}/profile`;
  bot.command("start", async (ctx) => {
    const chatId = chatIdOf(ctx);
    const token = typeof ctx.match === "string" ? ctx.match : "";
    if (!chatId) return;
    if (!token) {
      await ctx.reply(say("bot.connectFirst", { profile }));
      return;
    }

    // GETDEL reads and deletes in one step, so two /start messages racing
    // with the same token can't both claim it.
    const candidateId = await redis.getdel(telegramLinkKey(token));
    if (!candidateId) {
      await ctx.reply(say("bot.linkUsed", { profile }));
      return;
    }

    // A chat belongs to one account: if it was linked elsewhere, it moves here.
    await prisma.$transaction([
      prisma.candidate.updateMany({ where: { telegramChatId: chatId, NOT: { id: candidateId } }, data: { telegramChatId: null } }),
      prisma.candidate.update({ where: { id: candidateId }, data: { telegramChatId: chatId } }),
    ]);
    await ctx.reply(say("bot.connected"));
  });

  bot.command("jobs", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (!chatId) return;
    const candidate = await prisma.candidate.findUnique({ where: { telegramChatId: chatId } });
    if (!candidate) {
      await ctx.reply(say("bot.notConnected", { profile }));
      return;
    }

    const reachable = await findLiveDrivesForCandidate(candidate.id, JOBS_LIMIT);
    if (reachable.length === 0) {
      await ctx.reply(say("bot.noJobs", { km: candidate.maxTravelKm, profile }));
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
        say("bot.jobLine", { n: index + 1, role: drive.role.title, company: drive.company.name }),
        say("bot.jobWhen", { day: when.day, time: when.time, distance: formatDistance(distanceMeters / 1000) }),
        `${webUrl}/drives/${drive.id}`,
        "",
      ];
    });
    await ctx.reply([say("bot.jobsHeading", { km: candidate.maxTravelKm }), "", ...lines].join("\n").trim(), {
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("stop", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (!chatId) return;
    await prisma.candidate.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null } });
    await ctx.reply(say("bot.stopped", { profile }));
  });

  bot.catch((err, ctx) => {
    console.error(`worker: telegram update ${ctx.update.update_id} failed`, err);
  });
}
