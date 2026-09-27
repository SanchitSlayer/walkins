import type { Api } from "node-telegram-bot-api";
import { NetworkError, TelegramApiError, TimeoutError } from "node-telegram-bot-api";
import {
  ChannelRateLimitedError,
  DeliveryOutcomeUnknownError,
  type NotificationChannel,
  type Recipient,
  RecipientUnreachableError,
  type SendResult,
  type TemplatedMessage,
} from "@walkins/shared";

// Failures where the connection was never opened, so the request cannot
// have reached Telegram and sending again is safe.
const NEVER_CONNECTED = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);

function causeCodes(err: unknown): string[] {
  const codes: string[] = [];
  for (let current = err; current instanceof Error; current = current.cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
  }
  return codes;
}

export class TelegramChannel implements NotificationChannel {
  readonly name = "telegram";

  // The Api passed in must be built with maxRetries: 0. The library otherwise
  // retries timeouts itself, underneath the queue, which could double-send.
  constructor(
    private readonly api: Pick<Api, "sendMessage">,
    private readonly onUnreachable: (recipient: Recipient) => Promise<void>,
  ) {}

  isAvailable(recipient: Recipient): boolean {
    return recipient.telegramChatId !== null;
  }

  async send(recipient: Recipient, message: TemplatedMessage): Promise<SendResult> {
    try {
      // Plain text on purpose: role titles, company names and addresses are
      // user-entered and would need escaping for Markdown or HTML parse modes.
      // The link is in the text rather than a URL button because Telegram
      // rejects button URLs on localhost.
      const sent = await this.api.sendMessage({
        chat_id: recipient.telegramChatId!,
        text: `${message.text}\n\n${message.url}`,
        link_preview_options: { is_disabled: true },
      });
      return { providerMessageId: String(sent.message_id) };
    } catch (err) {
      throw await this.classify(err, recipient);
    }
  }

  private async classify(err: unknown, recipient: Recipient): Promise<Error> {
    if (err instanceof TelegramApiError) {
      if (err.errorCode === 429) {
        return new ChannelRateLimitedError(err.description, (err.retryAfter ?? 1) * 1000);
      }
      if (err.errorCode === 403 || (err.errorCode === 400 && /chat not found/i.test(err.description))) {
        await this.onUnreachable(recipient);
        return new RecipientUnreachableError(err.description);
      }
      return err;
    }
    if (err instanceof TimeoutError) {
      return new DeliveryOutcomeUnknownError(`Telegram did not answer in time: ${err.message}`);
    }
    if (err instanceof NetworkError && !causeCodes(err).some((code) => NEVER_CONNECTED.has(code))) {
      return new DeliveryOutcomeUnknownError(`Connection to Telegram failed mid-request: ${err.message}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
