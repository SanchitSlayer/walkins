import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  CHECK_IN_PRICE_EVENT,
  companyBalance,
  isDuplicatePosting,
  ledgerAccount,
  PLATFORM_ACCOUNT,
  postTransaction,
  priceAt,
  prisma,
} from "@walkins/db";
import {
  type TopUpConfirm,
  type TopUpOrder,
  topUpOrderSchema,
  type TopUpStatus,
  topUpStatusSchema,
  type Wallet,
  walletSchema,
} from "@walkins/shared";
import { MockGateway } from "./mock-gateway";
import { type GatewayPayment, type IPaymentGateway, parseRazorpayWebhook, PAYMENT_GATEWAY } from "./payment-gateway";

const STATEMENT_LENGTH = 100;

// Events that say money moved or definitely didn't. order.paid repeats what
// payment.captured said; both are safe because crediting is keyed on the
// payment id.
const PAYMENT_EVENTS = new Set(["payment.captured", "payment.failed", "order.paid"]);

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(@Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway) {}

  async wallet(companyId: string): Promise<Wallet> {
    const [balancePaise, pricePerCheckInPaise, entries] = await Promise.all([
      companyBalance(prisma, companyId),
      priceAt(prisma, CHECK_IN_PRICE_EVENT, new Date()),
      prisma.ledgerEntry.findMany({
        where: { account: { ownerType: "COMPANY", ownerId: companyId } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: STATEMENT_LENGTH,
      }),
    ]);
    return walletSchema.parse({
      balancePaise,
      pricePerCheckInPaise,
      canGoLive: pricePerCheckInPaise === null || balancePaise >= pricePerCheckInPaise,
      gateway: this.gateway.name,
      entries: entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    });
  }

  async createTopUp(companyId: string, userId: string, amountPaise: number): Promise<TopUpOrder> {
    const id = randomUUID();
    const { gatewayOrderId } = await this.gateway.createOrder({ amountPaise, currency: "INR", receipt: id });
    await prisma.paymentOrder.create({
      data: { id, companyId, createdById: userId, gateway: this.gateway.name, gatewayOrderId, amountPaise },
    });
    return topUpOrderSchema.parse({
      orderId: id,
      gateway: this.gateway.name,
      gatewayOrderId,
      amountPaise,
      currency: "INR",
      keyId: this.gateway.keyId,
    });
  }

  // The second path to crediting, beside the webhook. The page's word is
  // never enough: the checkout signature must verify, and then the gateway is
  // asked directly whether the money was captured. It exists because a
  // webhook can't reach a laptop without a tunnel; both paths credit through
  // applyPayment, keyed on the payment id, so using both credits once.
  async confirmTopUp(companyId: string, orderId: string, input: TopUpConfirm): Promise<TopUpStatus> {
    const order = await this.ownedOrder(companyId, orderId);
    const verified = this.gateway.verifyCheckout({
      gatewayOrderId: order.gatewayOrderId,
      paymentId: input.gatewayPaymentId,
      signature: input.signature,
    });
    if (!verified) throw new BadRequestException("That payment couldn't be verified with the payment gateway");
    const payment = await this.gateway.fetchPayment(input.gatewayPaymentId);
    if (payment.gatewayOrderId !== order.gatewayOrderId) {
      throw new BadRequestException("That payment belongs to a different order");
    }
    await this.applyPayment(payment);
    return this.topUpStatus(companyId, orderId);
  }

  async mockCheckout(companyId: string, orderId: string, outcome: "success" | "failure") {
    if (!(this.gateway instanceof MockGateway)) throw new NotFoundException("Mock checkout is only available with the mock gateway");
    const order = await this.ownedOrder(companyId, orderId);
    const paid = await this.gateway.pay(order.gatewayOrderId, outcome);
    // Delivered the way the gateway would, through the public handler's own
    // code, before the page confirms: every mock top-up exercises both paths.
    await this.handleWebhook("mock", paid.webhook.rawBody, paid.webhook.signature, paid.webhook.eventId);
    return { gatewayPaymentId: paid.paymentId, signature: paid.signature };
  }

  async topUpStatus(companyId: string, orderId: string): Promise<TopUpStatus> {
    const order = await this.ownedOrder(companyId, orderId);
    return topUpStatusSchema.parse({
      orderId: order.id,
      status: order.status,
      failureReason: order.failureReason,
      balancePaise: await companyBalance(prisma, companyId),
    });
  }

  // Every delivery is stored first, exactly as received, valid or not. A bad
  // signature is refused with 400 and nothing else happens; Razorpay retrying
  // it is harmless. Replays and duplicates of a valid delivery reach
  // applyPayment again and change nothing there.
  async handleWebhook(gatewayName: string, rawBody: Buffer | undefined, signature: string | undefined, eventId: string | undefined) {
    if (gatewayName !== this.gateway.name) throw new NotFoundException(`No ${gatewayName} gateway is configured`);
    const body = rawBody ?? Buffer.alloc(0);
    const signatureValid = !!signature && body.length > 0 && this.gateway.verifyWebhook(body, signature);

    let event: ReturnType<typeof parseRazorpayWebhook> | null = null;
    try {
      event = parseRazorpayWebhook(body);
    } catch {
      event = null;
    }
    const stored = await prisma.paymentEvent.create({
      data: {
        gateway: gatewayName,
        eventId: eventId ?? null,
        eventType: event?.type ?? null,
        gatewayPaymentId: event?.payment?.paymentId ?? null,
        signatureValid,
        rawBody: body.toString("utf8"),
      },
    });

    let outcome: string;
    if (!signatureValid) outcome = "refused: signature did not verify";
    else if (!event) outcome = "refused: body is not JSON";
    else if (!PAYMENT_EVENTS.has(event.type) || !event.payment) outcome = `ignored: ${event.type}`;
    else outcome = await this.applyPayment(event.payment);

    await prisma.paymentEvent.update({ where: { id: stored.id }, data: { outcome } });
    if (!signatureValid) throw new BadRequestException("Webhook signature did not verify");
    return { received: true };
  }

  // The single place money comes in. Keyed on the gateway's payment id, so
  // the webhook, its retries and replays, and the checkout confirmation can
  // all arrive in any order and credit exactly once. A captured order never
  // moves back to FAILED, whatever arrives afterwards.
  private async applyPayment(payment: GatewayPayment): Promise<string> {
    const order = await prisma.paymentOrder.findUnique({ where: { gatewayOrderId: payment.gatewayOrderId } });
    if (!order) return "ignored: no order of ours";

    if (payment.status === "failed") {
      const { count } = await prisma.paymentOrder.updateMany({
        where: { id: order.id, status: "CREATED" },
        data: { status: "FAILED", failureReason: payment.error ?? "The payment failed" },
      });
      return count ? "marked failed" : `ignored: order already ${order.status.toLowerCase()}`;
    }
    if (payment.status !== "captured") return "ignored: not captured yet";

    if (payment.amountPaise !== order.amountPaise || payment.currency !== order.currency) {
      this.logger.error(
        `Payment ${payment.paymentId} captured ${payment.amountPaise} ${payment.currency} against order ${order.id} for ${order.amountPaise} ${order.currency}; not credited`,
      );
      return "refused: amount or currency differs from the order";
    }
    if (order.status === "CAPTURED" && order.gatewayPaymentId !== payment.paymentId) {
      this.logger.error(`Order ${order.id} was already paid by ${order.gatewayPaymentId}; ${payment.paymentId} needs a refund`);
      return "refused: order already paid by another payment";
    }

    try {
      const credited = await prisma.$transaction(async (tx) => {
        const posted = await postTransaction(tx, {
          txnId: `topup:${payment.paymentId}`,
          reason: "TOP_UP",
          refType: "payment_order",
          refId: order.id,
          legs: [
            { accountId: await ledgerAccount(tx, "PLATFORM", PLATFORM_ACCOUNT.gateway), direction: "DEBIT", amountPaise: order.amountPaise },
            { accountId: await ledgerAccount(tx, "COMPANY", order.companyId), direction: "CREDIT", amountPaise: order.amountPaise },
          ],
        });
        if (posted) {
          await tx.paymentOrder.update({
            where: { id: order.id },
            data: { status: "CAPTURED", gatewayPaymentId: payment.paymentId, capturedAt: new Date(), failureReason: null },
          });
        }
        return posted;
      });
      return credited ? "credited" : "duplicate: already credited";
    } catch (err) {
      if (isDuplicatePosting(err)) return "duplicate: already credited";
      throw err;
    }
  }

  private async ownedOrder(companyId: string, orderId: string) {
    const order = await prisma.paymentOrder.findFirst({ where: { id: orderId, companyId } });
    if (!order) throw new NotFoundException("Top-up not found");
    return order;
  }
}
