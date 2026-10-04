import { z } from "zod";

// Discovery (a drive near you), commitment (you said you'd come today) and
// release (the employer isn't going ahead with you, so don't travel) are
// different messages to different people, so they are different keys.
export type TemplateKey = "drive_48h" | "drive_morning_of" | "application_rejected";

export type Recipient = {
  candidateId: string;
  phone: string;
  telegramChatId: string | null;
};

export type TemplatedMessage = {
  templateKey: TemplateKey;
  text: string;
  url: string;
};

export type SendResult = {
  providerMessageId: string | null;
};

// The seam that keeps delivery provider-agnostic: the queue only ever talks
// to this, so moving from Telegram to WhatsApp is a new implementation and a
// resolver order change, not a change to fanout, retries or bookkeeping.
export interface NotificationChannel {
  readonly name: string;
  isAvailable(recipient: Recipient): boolean;
  send(recipient: Recipient, message: TemplatedMessage): Promise<SendResult>;
}

export class NotImplementedError extends Error {
  name = "NotImplementedError";
}

// Permanent for this recipient on this channel (blocked the bot, deleted the
// chat): retrying cannot succeed.
export class RecipientUnreachableError extends Error {
  name = "RecipientUnreachableError";
}

// The provider asked us to slow down. Not the recipient's fault, so it should
// pause the whole queue rather than spend one of this job's attempts.
export class ChannelRateLimitedError extends Error {
  name = "ChannelRateLimitedError";
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
  }
}

// The request may or may not have reached the provider (a timeout, a
// connection dropped mid-request). Retrying could double-send, which is the
// one thing alerts must never do, so this is surfaced rather than retried.
export class DeliveryOutcomeUnknownError extends Error {
  name = "DeliveryOutcomeUnknownError";
}

export const TELEGRAM_LINK_TTL_SECONDS = 600;

export function telegramLinkKey(token: string): string {
  return `telegram-link:${token}`;
}

export const telegramLinkSchema = z.object({
  token: z.string(),
  deepLink: z.string(),
  expiresInSeconds: z.number().int(),
});

export type TelegramLink = z.infer<typeof telegramLinkSchema>;
