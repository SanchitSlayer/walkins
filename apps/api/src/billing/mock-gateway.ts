import { randomBytes, randomUUID } from "node:crypto";
import { redis } from "../common/redis";
import { type GatewayPayment, hmacHex, type IPaymentGateway, signatureMatches } from "./payment-gateway";

const KEY_TTL_SECONDS = 24 * 3600;
const orderKey = (id: string) => `mock-gateway:order:${id}`;
const paymentKey = (id: string) => `mock-gateway:payment:${id}`;

export type MockPayment = {
  paymentId: string;
  signature: string;
  webhook: { rawBody: Buffer; signature: string; eventId: string };
};

// Behaves like Razorpay test mode with no network: orders, payments,
// checkout signatures and signed webhooks shaped exactly like Razorpay's, so
// a demo exercises the same verification and crediting code. Its state lives
// in Redis, standing in for the gateway's own records. The secrets are new
// each time the API starts, so nobody can sign a mock webhook from outside,
// and the mock refuses to run in production at all.
export class MockGateway implements IPaymentGateway {
  readonly name = "mock" as const;
  readonly keyId = null;
  private readonly keySecret = randomBytes(32).toString("hex");
  private readonly webhookSecret = randomBytes(32).toString("hex");

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("The mock payment gateway credits wallets for free; set PAYMENT_GATEWAY=razorpay in production");
    }
  }

  async createOrder(input: { amountPaise: number; currency: string; receipt: string }) {
    const gatewayOrderId = `order_mock_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    await redis.set(orderKey(gatewayOrderId), JSON.stringify(input), "EX", KEY_TTL_SECONDS);
    return { gatewayOrderId };
  }

  verifyCheckout({ gatewayOrderId, paymentId, signature }: { gatewayOrderId: string; paymentId: string; signature: string }) {
    return signatureMatches(hmacHex(this.keySecret, `${gatewayOrderId}|${paymentId}`), signature);
  }

  async fetchPayment(paymentId: string): Promise<GatewayPayment> {
    const raw = await redis.get(paymentKey(paymentId));
    if (!raw) throw new Error(`Mock gateway has no payment ${paymentId}`);
    return JSON.parse(raw);
  }

  verifyWebhook(rawBody: Buffer, signature: string) {
    return signatureMatches(hmacHex(this.webhookSecret, rawBody), signature);
  }

  // What the checkout window and the gateway would do when someone pays:
  // record the payment, hand the page a checkout signature, and produce the
  // signed webhook the gateway would send.
  async pay(gatewayOrderId: string, outcome: "success" | "failure"): Promise<MockPayment> {
    const raw = await redis.get(orderKey(gatewayOrderId));
    if (!raw) throw new Error(`Mock gateway has no order ${gatewayOrderId}`);
    const order: { amountPaise: number; currency: string } = JSON.parse(raw);
    const payment: GatewayPayment = {
      paymentId: `pay_mock_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
      gatewayOrderId,
      status: outcome === "success" ? "captured" : "failed",
      amountPaise: order.amountPaise,
      currency: order.currency,
      error: outcome === "success" ? null : "Payment declined by the mock gateway",
    };
    await redis.set(paymentKey(payment.paymentId), JSON.stringify(payment), "EX", KEY_TTL_SECONDS);

    const rawBody = Buffer.from(
      JSON.stringify({
        entity: "event",
        event: outcome === "success" ? "payment.captured" : "payment.failed",
        contains: ["payment"],
        payload: {
          payment: {
            entity: {
              id: payment.paymentId,
              order_id: gatewayOrderId,
              status: payment.status,
              amount: payment.amountPaise,
              currency: payment.currency,
              error_description: payment.error,
            },
          },
        },
        created_at: Math.floor(Date.now() / 1000),
      }),
    );
    return {
      paymentId: payment.paymentId,
      signature: hmacHex(this.keySecret, `${gatewayOrderId}|${payment.paymentId}`),
      webhook: { rawBody, signature: hmacHex(this.webhookSecret, rawBody), eventId: `evt_mock_${randomUUID()}` },
    };
  }
}
