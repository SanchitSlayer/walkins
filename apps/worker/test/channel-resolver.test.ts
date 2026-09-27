import { describe, expect, it } from "vitest";
import { ChannelResolver } from "../src/channels/channel-resolver";
import { ConsoleChannel } from "../src/channels/console-channel";
import { TelegramChannel } from "../src/channels/telegram-channel";
import { WhatsAppChannel } from "../src/channels/whatsapp-channel";

const unusedApi = { sendMessage: async () => ({ message_id: 1 }) } as never;
const linked = { candidateId: "c1", phone: "9000000000", telegramChatId: "42" };
const unlinked = { ...linked, telegramChatId: null };

describe("ChannelResolver", () => {
  it("picks the first available channel in priority order", () => {
    const telegram = new TelegramChannel(unusedApi, async () => {});
    const resolver = new ChannelResolver([new WhatsAppChannel(), telegram, new ConsoleChannel()]);

    expect(resolver.resolve(linked)?.name).toBe("telegram");
    expect(resolver.resolve(unlinked)?.name).toBe("console");
  });

  it("returns null when no channel can reach the recipient", () => {
    const resolver = new ChannelResolver([new WhatsAppChannel(), new TelegramChannel(unusedApi, async () => {})]);

    expect(resolver.resolve(unlinked)).toBeNull();
  });
});
