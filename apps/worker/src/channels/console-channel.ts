import type { NotificationChannel, Recipient, SendResult, TemplatedMessage } from "@walkins/shared";

// The development fallback when no bot token is configured: every alert is
// printed instead of delivered, so the full pipeline runs with no credentials.
export class ConsoleChannel implements NotificationChannel {
  readonly name = "console";

  isAvailable(): boolean {
    return true;
  }

  async send(recipient: Recipient, message: TemplatedMessage): Promise<SendResult> {
    console.log(`worker: [console channel] ${message.templateKey} to candidate ${recipient.candidateId}\n${message.text}\n${message.url}\n`);
    return { providerMessageId: null };
  }
}
