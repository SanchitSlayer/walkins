import { fromRazorpayPayment, type GatewayPayment, hmacHex, type IPaymentGateway, signatureMatches } from "./payment-gateway";

const API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 15_000;

// Razorpay over its REST API with fetch, so no SDK. Test-mode keys behave
// exactly like live ones against Razorpay's test environment.
export class RazorpayGateway implements IPaymentGateway {
  readonly name = "razorpay" as const;
  readonly keyId: string;
  private readonly keySecret: string;
  // A different secret from the key secret, set on the webhook in Razorpay's
  // dashboard. Mixing the two up makes every webhook fail verification.
  private readonly webhookSecret: string;

  constructor() {
    const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = process.env;
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !RAZORPAY_WEBHOOK_SECRET) {
      throw new Error("PAYMENT_GATEWAY=razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET");
    }
    this.keyId = RAZORPAY_KEY_ID;
    this.keySecret = RAZORPAY_KEY_SECRET;
    this.webhookSecret = RAZORPAY_WEBHOOK_SECRET;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Razorpay ${init.method ?? "GET"} ${path} returned ${response.status}: ${body.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  }

  async createOrder({ amountPaise, currency, receipt }: { amountPaise: number; currency: string; receipt: string }) {
    const order = await this.call<{ id: string }>("/orders", {
      method: "POST",
      body: JSON.stringify({ amount: amountPaise, currency, receipt }),
    });
    return { gatewayOrderId: order.id };
  }

  verifyCheckout({ gatewayOrderId, paymentId, signature }: { gatewayOrderId: string; paymentId: string; signature: string }) {
    return signatureMatches(hmacHex(this.keySecret, `${gatewayOrderId}|${paymentId}`), signature);
  }

  async fetchPayment(paymentId: string): Promise<GatewayPayment> {
    return fromRazorpayPayment(await this.call(`/payments/${encodeURIComponent(paymentId)}`));
  }

  verifyWebhook(rawBody: Buffer, signature: string) {
    return signatureMatches(hmacHex(this.webhookSecret, rawBody), signature);
  }
}
