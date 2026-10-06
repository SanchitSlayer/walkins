import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyBalance, prisma } from "@walkins/db";
import { BillingService } from "../src/billing/billing.service";
import { MockGateway } from "../src/billing/mock-gateway";
import { type GatewayPayment, hmacHex, type IPaymentGateway } from "../src/billing/payment-gateway";
import { redis } from "../src/common/redis";
import { createFixture, type Fixture, removeFixture } from "./fixtures";

// Stands in for Razorpay with secrets the test knows, so it can sign any
// webhook it likes: duplicates, replays, events out of order, a payment for
// the wrong amount. The real MockGateway keeps its secrets to itself.
class TestGateway implements IPaymentGateway {
  readonly name = "razorpay" as const;
  readonly keyId = "rzp_test_key";
  readonly keySecret = "test-key-secret";
  readonly webhookSecret = "test-webhook-secret";
  payments = new Map<string, GatewayPayment>();

  async createOrder() {
    return { gatewayOrderId: `order_test_${randomUUID().slice(0, 12)}` };
  }
  verifyCheckout({ gatewayOrderId, paymentId, signature }: { gatewayOrderId: string; paymentId: string; signature: string }) {
    return hmacHex(this.keySecret, `${gatewayOrderId}|${paymentId}`) === signature;
  }
  async fetchPayment(paymentId: string) {
    return this.payments.get(paymentId)!;
  }
  verifyWebhook(rawBody: Buffer, signature: string) {
    return hmacHex(this.webhookSecret, rawBody) === signature;
  }

  webhook(event: string, payment: GatewayPayment) {
    const rawBody = Buffer.from(
      JSON.stringify({
        entity: "event",
        event,
        payload: {
          payment: {
            entity: {
              id: payment.paymentId,
              order_id: payment.gatewayOrderId,
              status: payment.status,
              amount: payment.amountPaise,
              currency: payment.currency,
              error_description: payment.error,
            },
          },
        },
      }),
    );
    return { rawBody, signature: hmacHex(this.webhookSecret, rawBody) };
  }
}

let fixture: Fixture;
let other: Fixture;
const gateway = new TestGateway();
const billing = new BillingService(gateway);

function payment(gatewayOrderId: string, amountPaise: number, status: GatewayPayment["status"] = "captured"): GatewayPayment {
  return { paymentId: `pay_test_${randomUUID().slice(0, 12)}`, gatewayOrderId, status, amountPaise, currency: "INR", error: status === "failed" ? "Card declined" : null };
}

async function topUp(amountPaise = 5_000_00, fx = fixture) {
  return billing.createTopUp(fx.company.id, fx.employer.id, amountPaise);
}

function deliver(event: string, p: GatewayPayment) {
  const { rawBody, signature } = gateway.webhook(event, p);
  return billing.handleWebhook("razorpay", rawBody, signature, `evt_${randomUUID()}`);
}

const balance = () => companyBalance(prisma, fixture.company.id);
const outcomes = (paymentId: string) =>
  prisma.paymentEvent.findMany({ where: { gatewayPaymentId: paymentId }, orderBy: { receivedAt: "asc" } }).then((rows) => rows.map((r) => r.outcome));

beforeAll(async () => {
  fixture = await createFixture("Billing Test", 0);
  other = await createFixture("Billing Other", 0);
});

afterAll(async () => {
  const orders = await prisma.paymentOrder.findMany({ where: { companyId: { in: [fixture.company.id, other.company.id] } } });
  for (const { gatewayOrderId } of orders) {
    await prisma.paymentEvent.deleteMany({ where: { rawBody: { contains: gatewayOrderId } } });
  }
  await removeFixture(fixture);
  await removeFixture(other);
  await prisma.$disconnect();
  redis.disconnect();
});

describe("webhook", () => {
  it("credits a captured payment once, however many times it is delivered", async () => {
    const before = await balance();
    const order = await topUp();
    const p = payment(order.gatewayOrderId, order.amountPaise);
    const { rawBody, signature } = gateway.webhook("payment.captured", p);

    await billing.handleWebhook("razorpay", rawBody, signature, "evt_1");
    await billing.handleWebhook("razorpay", rawBody, signature, "evt_1");
    await deliver("order.paid", p);

    expect(await balance()).toBe(before + order.amountPaise);
    expect(await outcomes(p.paymentId)).toEqual(["credited", "duplicate: already credited", "duplicate: already credited"]);
    expect(await prisma.ledgerEntry.count({ where: { txnId: `topup:${p.paymentId}` } })).toBe(2);
    expect(await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.orderId } })).toMatchObject({
      status: "CAPTURED",
      gatewayPaymentId: p.paymentId,
    });
  });

  it("credits once when two deliveries race", async () => {
    const before = await balance();
    const order = await topUp(1_000_00);
    const p = payment(order.gatewayOrderId, order.amountPaise);
    await Promise.all([deliver("payment.captured", p), deliver("payment.captured", p), deliver("order.paid", p)]);
    expect(await balance()).toBe(before + 1_000_00);
  });

  it("stores and refuses a delivery whose signature doesn't verify, crediting nothing", async () => {
    const before = await balance();
    const order = await topUp();
    const p = payment(order.gatewayOrderId, order.amountPaise);
    const { rawBody } = gateway.webhook("payment.captured", p);

    await expect(billing.handleWebhook("razorpay", rawBody, "0".repeat(64), "evt_forged")).rejects.toBeInstanceOf(BadRequestException);
    await expect(billing.handleWebhook("razorpay", rawBody, undefined, "evt_unsigned")).rejects.toBeInstanceOf(BadRequestException);
    // The real signature on edited bytes: the amount raised tenfold.
    const { signature } = gateway.webhook("payment.captured", p);
    const edited = Buffer.from(rawBody.toString().replace(`"amount":${p.amountPaise}`, `"amount":${p.amountPaise * 10}`));
    await expect(billing.handleWebhook("razorpay", edited, signature, "evt_edited")).rejects.toBeInstanceOf(BadRequestException);

    expect(await balance()).toBe(before);
    const stored = await prisma.paymentEvent.findMany({ where: { eventId: { in: ["evt_forged", "evt_unsigned", "evt_edited"] } } });
    expect(stored).toHaveLength(3);
    expect(stored.every((e) => !e.signatureValid && e.outcome === "refused: signature did not verify")).toBe(true);
  });

  it("never moves a captured order back to failed when events arrive out of order", async () => {
    const order = await topUp();
    const captured = payment(order.gatewayOrderId, order.amountPaise);
    await deliver("payment.captured", captured);
    await deliver("payment.failed", { ...payment(order.gatewayOrderId, order.amountPaise, "failed") });

    expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe("CAPTURED");
  });

  it("credits a later successful attempt after an earlier one failed", async () => {
    const before = await balance();
    const order = await topUp();
    await deliver("payment.failed", payment(order.gatewayOrderId, order.amountPaise, "failed"));
    expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe("FAILED");

    await deliver("payment.captured", payment(order.gatewayOrderId, order.amountPaise));
    expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe("CAPTURED");
    expect(await balance()).toBe(before + order.amountPaise);
  });

  it("refuses a capture whose amount differs from the order", async () => {
    const before = await balance();
    const order = await topUp(2_000_00);
    const p = payment(order.gatewayOrderId, 2_000_01);
    await deliver("payment.captured", p);
    expect(await outcomes(p.paymentId)).toEqual(["refused: amount or currency differs from the order"]);
    expect(await balance()).toBe(before);
  });

  it("refuses a second, different payment on an order already paid", async () => {
    const before = await balance();
    const order = await topUp();
    await deliver("payment.captured", payment(order.gatewayOrderId, order.amountPaise));
    const second = payment(order.gatewayOrderId, order.amountPaise);
    await deliver("payment.captured", second);
    expect(await outcomes(second.paymentId)).toEqual(["refused: order already paid by another payment"]);
    expect(await balance()).toBe(before + order.amountPaise);
  });
});

describe("confirming after checkout", () => {
  it("credits only after the signature verifies and the gateway says captured, and agrees with the webhook", async () => {
    const before = await balance();
    const order = await topUp();
    const p = payment(order.gatewayOrderId, order.amountPaise);
    gateway.payments.set(p.paymentId, p);
    const signature = hmacHex(gateway.keySecret, `${order.gatewayOrderId}|${p.paymentId}`);

    await expect(billing.confirmTopUp(fixture.company.id, order.orderId, { gatewayPaymentId: p.paymentId, signature: "f".repeat(64) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await balance()).toBe(before);

    const status = await billing.confirmTopUp(fixture.company.id, order.orderId, { gatewayPaymentId: p.paymentId, signature });
    expect(status).toMatchObject({ status: "CAPTURED", balancePaise: before + order.amountPaise });
    await deliver("payment.captured", p);
    expect(await balance()).toBe(before + order.amountPaise);
  });

  it("doesn't credit an authorised payment that hasn't been captured", async () => {
    const before = await balance();
    const order = await topUp();
    const p = payment(order.gatewayOrderId, order.amountPaise, "pending");
    gateway.payments.set(p.paymentId, p);
    const status = await billing.confirmTopUp(fixture.company.id, order.orderId, {
      gatewayPaymentId: p.paymentId,
      signature: hmacHex(gateway.keySecret, `${order.gatewayOrderId}|${p.paymentId}`),
    });
    expect(status.status).toBe("CREATED");
    expect(await balance()).toBe(before);
  });

  it("treats another company's top-up as missing", async () => {
    const order = await topUp(1_000_00, other);
    await expect(billing.topUpStatus(fixture.company.id, order.orderId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("the mock gateway, end to end with no network", () => {
  const mock = new BillingService(new MockGateway());

  it("credits a successful mock payment once, through both the webhook and the confirmation", async () => {
    const before = await balance();
    const order = await mock.createTopUp(fixture.company.id, fixture.employer.id, 3_000_00);
    const paid = await mock.mockCheckout(fixture.company.id, order.orderId, "success");
    const status = await mock.confirmTopUp(fixture.company.id, order.orderId, paid);

    expect(status).toMatchObject({ status: "CAPTURED", balancePaise: before + 3_000_00 });
    expect(await outcomes(paid.gatewayPaymentId)).toEqual(["credited"]);
    expect(await prisma.ledgerEntry.count({ where: { txnId: `topup:${paid.gatewayPaymentId}` } })).toBe(2);
  });

  it("records a declined mock payment as failed and credits nothing", async () => {
    const before = await balance();
    const order = await mock.createTopUp(fixture.company.id, fixture.employer.id, 3_000_00);
    const paid = await mock.mockCheckout(fixture.company.id, order.orderId, "failure");
    const status = await mock.confirmTopUp(fixture.company.id, order.orderId, paid);
    expect(status).toMatchObject({ status: "FAILED", failureReason: "Payment declined by the mock gateway", balancePaise: before });
  });

  it("refuses a webhook signed by anyone else", async () => {
    const order = await mock.createTopUp(fixture.company.id, fixture.employer.id, 3_000_00);
    const forged = gateway.webhook("payment.captured", payment(order.gatewayOrderId, 3_000_00));
    await expect(mock.handleWebhook("mock", forged.rawBody, forged.signature, "evt_mock_forged")).rejects.toBeInstanceOf(BadRequestException);
  });
});
