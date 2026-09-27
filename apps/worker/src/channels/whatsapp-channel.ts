import { type NotificationChannel, NotImplementedError, type Recipient, type SendResult, type TemplatedMessage } from "@walkins/shared";

// Would send through the Meta WhatsApp Cloud API:
//   POST https://graph.facebook.com/v21.0/{phone-number-id}/messages
// with a pre-approved message template, since a business may only start a
// conversation with a template (free-form text is allowed only inside the
// 24-hour window after the user last wrote to us). Before that endpoint
// accepts production traffic, the sending business must complete Meta
// Business Verification (legal name, address and documents checked by Meta),
// register a dedicated phone number to a WhatsApp Business Account, and get
// each template approved. Recipient.phone is already the address it needs;
// once that exists, implementing send() and making isAvailable() true is the
// whole change, because the resolver already asks this channel first.
export class WhatsAppChannel implements NotificationChannel {
  readonly name = "whatsapp";

  isAvailable(): boolean {
    return false;
  }

  async send(_recipient: Recipient, _message: TemplatedMessage): Promise<SendResult> {
    throw new NotImplementedError("WhatsApp delivery needs Meta business verification and approved templates");
  }
}
