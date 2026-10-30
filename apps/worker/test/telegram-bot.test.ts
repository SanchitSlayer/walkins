import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Bot } from "node-telegram-bot-api";
import type { Redis } from "ioredis";
import { prisma } from "@walkins/db";
import { registerBotCommands } from "../src/bot/telegram-bot";

type Handler = (ctx: { chatId?: number; match?: string; reply: (text: string) => Promise<void> }) => Promise<void>;

const handlers: Record<string, Handler> = {};
const bot = { command: (name: string, handler: Handler) => (handlers[name] = handler), catch: () => {} } as unknown as Bot;
registerBotCommands(bot, {} as Redis, "http://localhost:3000");

async function send(command: string, chatId: number): Promise<string[]> {
  const replies: string[] = [];
  await handlers[command]({ chatId, match: "", reply: async (text) => void replies.push(text) });
  return replies;
}

const chatId = Number(String(Date.now()).slice(-9));
const ids = { user: "", candidate: "" };

beforeAll(async () => {
  const city = await prisma.city.findFirstOrThrow({ where: { name: "Bengaluru" } });
  const user = await prisma.user.create({ data: { phone: `96${String(Date.now()).slice(-8)}`, name: "Bot Test", role: "CANDIDATE", locale: "hi" } });
  const candidate = await prisma.candidate.create({
    data: { userId: user.id, cityId: city.id, homeLat: city.centerLat, homeLng: city.centerLng, maxTravelKm: 1, experienceYears: 0, telegramChatId: String(chatId) },
  });
  Object.assign(ids, { user: user.id, candidate: candidate.id });
});

afterAll(async () => {
  await prisma.candidate.deleteMany({ where: { id: ids.candidate } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.$disconnect();
});

describe("the bot's language", () => {
  it("answers a chat it can't place once, in English, while the reply has no Hindi", async () => {
    const [reply, ...more] = await send("start", chatId + 1);
    expect(more).toHaveLength(0);
    expect(reply).toContain("http://localhost:3000/profile");
    expect(reply).not.toContain("/hi/");
  });

  it("links a Hindi reader to the Hindi pages", async () => {
    const [jobs] = await send("jobs", chatId);
    expect(jobs).toMatch(/http:\/\/localhost:3000\/hi\/(profile|drives\/)/);

    const [stopped] = await send("stop", chatId);
    expect(stopped).toContain("http://localhost:3000/hi/profile");
  });
});
