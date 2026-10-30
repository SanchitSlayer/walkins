import type { Bot, Context } from "node-telegram-bot-api";
import type { Redis } from "ioredis";
import { findLiveDrivesForCandidate, prisma } from "@walkins/db";
import {
  DEFAULT_LOCALE,
  formatFor,
  isTranslated,
  type Locale,
  localePath,
  type MessageKey,
  type MessageValues,
  OFFERED_LOCALES,
  servedLocale,
  telegramLinkKey,
  translate,
} from "@walkins/shared";

const JOBS_LIMIT = 5;

// The bot's wording is in the shared catalog (bot.*) with everything else a
// person reads. A linked chat is answered in its candidate's language. A
// chat Walkins can't place yet gets Hindi above English, the order the venue
// board uses, since nobody has said which they read. A key with no Hindi
// yet, or any key while Hindi isn't offered, is sent in English once.
const say = (locale: Locale, key: MessageKey, values?: MessageValues) => translate(locale, key, values);

function sayBoth(key: MessageKey, values: (locale: Locale) => MessageValues): string {
  const en = say(DEFAULT_LOCALE, key, values(DEFAULT_LOCALE));
  return OFFERED_LOCALES.includes("hi") && isTranslated("hi", key) ? `${say("hi", key, values("hi"))}\n\n${en}` : en;
}

function chatIdOf(ctx: Context): string | null {
  return ctx.chatId === undefined ? null : String(ctx.chatId);
}

export function registerBotCommands(bot: Bot, redis: Redis, webUrl: string) {
  const profile = (locale: Locale) => `${webUrl}${localePath("/profile", locale)}`;
  bot.command("start", async (ctx) => {
    const chatId = chatIdOf(ctx);
    const token = typeof ctx.match === "string" ? ctx.match : "";
    if (!chatId) return;
    if (!token) {
      await ctx.reply(sayBoth("bot.connectFirst", (locale) => ({ profile: profile(locale) })));
      return;
    }

    // GETDEL reads and deletes in one step, so two /start messages racing
    // with the same token can't both claim it.
    const candidateId = await redis.getdel(telegramLinkKey(token));
    if (!candidateId) {
      await ctx.reply(sayBoth("bot.linkUsed", (locale) => ({ profile: profile(locale) })));
      return;
    }

    // A chat belongs to one account: if it was linked elsewhere, it moves here.
    await prisma.$transaction([
      prisma.candidate.updateMany({ where: { telegramChatId: chatId, NOT: { id: candidateId } }, data: { telegramChatId: null } }),
      prisma.candidate.update({ where: { id: candidateId }, data: { telegramChatId: chatId } }),
    ]);
    const locale = servedLocale((await prisma.user.findFirstOrThrow({ where: { candidate: { id: candidateId } }, select: { locale: true } })).locale);
    await ctx.reply(`${say(locale, "bot.connected")}\n\n${say(locale, "bot.neverPay")}`);
  });

  bot.command("jobs", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (!chatId) return;
    const candidate = await prisma.candidate.findUnique({ where: { telegramChatId: chatId }, include: { user: { select: { locale: true } } } });
    if (!candidate) {
      await ctx.reply(sayBoth("bot.notConnected", (locale) => ({ profile: profile(locale) })));
      return;
    }
    const locale = servedLocale(candidate.user.locale);
    const format = formatFor(locale);

    const reachable = await findLiveDrivesForCandidate(candidate.id, JOBS_LIMIT);
    if (reachable.length === 0) {
      await ctx.reply(say(locale, "bot.noJobs", { km: candidate.maxTravelKm, profile: profile(locale) }));
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
      const when = format.formatWhen(drive.startsAt.toISOString(), drive.endsAt.toISOString(), now);
      return [
        say(locale, "bot.jobLine", { n: index + 1, role: drive.role.title, company: drive.company.name }),
        say(locale, "bot.jobWhen", { day: when.day, time: when.time, distance: format.formatDistance(distanceMeters / 1000) }),
        `${webUrl}${localePath(`/drives/${drive.id}`, locale)}`,
        "",
      ];
    });
    await ctx.reply([say(locale, "bot.jobsHeading", { km: candidate.maxTravelKm }), "", ...lines, say(locale, "bot.neverPay")].join("\n").trim(), {
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("stop", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (!chatId) return;
    // Read before unlinking: afterwards the chat is nobody's.
    const linked = await prisma.candidate.findUnique({ where: { telegramChatId: chatId }, select: { user: { select: { locale: true } } } });
    await prisma.candidate.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null } });
    const locale = linked && servedLocale(linked.user.locale);
    await ctx.reply(locale ? say(locale, "bot.stopped", { profile: profile(locale) }) : sayBoth("bot.stopped", (l) => ({ profile: profile(l) })));
  });

  bot.catch((err, ctx) => {
    console.error(`worker: telegram update ${ctx.update.update_id} failed`, err);
  });
}
