import { NetworkError, TelegramApiError, TimeoutError } from "node-telegram-bot-api";
import { describe, expect, it, vi } from "vitest";
import { ChannelRateLimitedError, DeliveryOutcomeUnknownError, RecipientUnreachableError } from "@walkins/shared";
import { TelegramChannel } from "../src/channels/telegram-channel";

const recipient = { candidateId: "c1", phone: "9000000000", telegramChatId: "42" };
const message = { templateKey: "drive_48h" as const, text: "New walk-in near you", url: "http://localhost:3000/drives/d1" };

function channelFailingWith(err: unknown) {
  const onUnreachable = vi.fn(async () => {});
  const api = { sendMessage: async () => Promise.reject(err) } as never;
  return { channel: new TelegramChannel(api, onUnreachable), onUnreachable };
}

function withCode(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}

describe("TelegramChannel", () => {
  it("sends the text and link as plain text and returns the message id", async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 7 }));
    const channel = new TelegramChannel({ sendMessage } as never, async () => {});

    await expect(channel.send(recipient, message)).resolves.toEqual({ providerMessageId: "7" });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chat_id: "42", text: `${message.text}\n\n${message.url}` }),
    );
  });

  it("turns a 429 into a rate limit carrying Telegram's wait", async () => {
    const { channel } = channelFailingWith(new TelegramApiError(429, "Too Many Requests: retry after 3", { retry_after: 3 }));

    const err = await channel.send(recipient, message).catch((e) => e);
    expect(err).toBeInstanceOf(ChannelRateLimitedError);
    expect(err.retryAfterMs).toBe(3000);
  });

  it("treats a blocked bot as unreachable and lets the caller forget the chat", async () => {
    const { channel, onUnreachable } = channelFailingWith(new TelegramApiError(403, "Forbidden: bot was blocked by the user"));

    await expect(channel.send(recipient, message)).rejects.toBeInstanceOf(RecipientUnreachableError);
    expect(onUnreachable).toHaveBeenCalledWith(recipient);
  });

  it("reports a timeout as an unknown outcome rather than a retryable failure", async () => {
    const { channel } = channelFailingWith(new TimeoutError());

    await expect(channel.send(recipient, message)).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
  });

  it("reports a connection dropped mid-request as an unknown outcome", async () => {
    const { channel } = channelFailingWith(new NetworkError("fetch failed", { cause: withCode("socket hang up", "ECONNRESET") }));

    await expect(channel.send(recipient, message)).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
  });

  it("leaves a connection that never opened as an ordinary, retryable failure", async () => {
    const { channel } = channelFailingWith(new NetworkError("fetch failed", { cause: withCode("connect ECONNREFUSED", "ECONNREFUSED") }));

    const err = await channel.send(recipient, message).catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err).not.toBeInstanceOf(DeliveryOutcomeUnknownError);
  });
});
