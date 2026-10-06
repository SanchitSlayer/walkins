import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentGatewayName } from "@walkins/shared";

// A payment as the gateway reports it. "pending" covers everything short of
// money having moved (created, authorized but not captured).
export type GatewayPayment = {
  paymentId: string;
  gatewayOrderId: string;
  status: "captured" | "failed" | "pending";
  amountPaise: number;
  currency: string;
  error: string | null;
};

export type WebhookEvent = { type: string; payment: GatewayPayment | null };

// Same pattern as the notification channels: the billing service only ever
// talks to this, and PAYMENT_GATEWAY picks the implementation.
export interface IPaymentGateway {
  readonly name: PaymentGatewayName;
  // Public key the browser's checkout needs; null for the mock.
  readonly keyId: string | null;
  createOrder(input: { amountPaise: number; currency: string; receipt: string }): Promise<{ gatewayOrderId: string }>;
  // The signature checkout returns to the page, proving the gateway issued
  // this payment id for this order.
  verifyCheckout(input: { gatewayOrderId: string; paymentId: string; signature: string }): boolean;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}

export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");

export function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

// Constant time, so a forger can't learn the signature a byte at a time from
// how long each wrong guess takes to reject.
export function signatureMatches(expectedHex: string, givenHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const given = Buffer.from(givenHex, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type RazorpayPaymentEntity = {
  id: string;
  order_id: string;
  status: string;
  amount: number;
  currency: string;
  error_description?: string | null;
};

export function fromRazorpayPayment(entity: RazorpayPaymentEntity): GatewayPayment {
  return {
    paymentId: entity.id,
    gatewayOrderId: entity.order_id,
    status: entity.status === "captured" ? "captured" : entity.status === "failed" ? "failed" : "pending",
    amountPaise: entity.amount,
    currency: entity.currency,
    error: entity.error_description ?? null,
  };
}

// Razorpay's webhook body, which the mock imitates exactly so that a demo
// runs the same parsing code. Only payment events carry a payment; anything
// else is recorded and ignored.
export function parseRazorpayWebhook(rawBody: Buffer): WebhookEvent {
  const body = JSON.parse(rawBody.toString("utf8")) as {
    event?: string;
    payload?: { payment?: { entity?: RazorpayPaymentEntity } };
  };
  const entity = body.payload?.payment?.entity;
  return { type: body.event ?? "unknown", payment: entity ? fromRazorpayPayment(entity) : null };
}
