import { z } from "zod";

// Money crosses every boundary as whole paise. A schema that accepted 199.5
// would be how a float gets into the ledger, so each one insists on integers.
const paise = z.number().int().safe();

export const MIN_TOP_UP_PAISE = 100_00;
export const MAX_TOP_UP_PAISE = 50_000_00;

export const ledgerDirectionSchema = z.enum(["DEBIT", "CREDIT"]);
export const ledgerReasonSchema = z.enum(["TOP_UP", "CHECK_IN_CHARGE", "PROMO_GRANT"]);
export const paymentGatewayNameSchema = z.enum(["mock", "razorpay"]);

export const ledgerEntrySchema = z.object({
  id: z.string(),
  txnId: z.string(),
  direction: ledgerDirectionSchema,
  amountPaise: paise,
  reason: ledgerReasonSchema,
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  createdAt: z.string(),
});

export const walletSchema = z.object({
  balancePaise: paise,
  pricePerCheckInPaise: paise.nullable(),
  // Below the price of one check-in, no new drive can go live.
  canGoLive: z.boolean(),
  gateway: paymentGatewayNameSchema,
  entries: z.array(ledgerEntrySchema),
});

export const topUpRequestSchema = z.object({
  amountPaise: paise
    .min(MIN_TOP_UP_PAISE, "The smallest top-up is ₹100")
    .max(MAX_TOP_UP_PAISE, "The largest top-up is ₹50,000"),
});

// What the checkout needs. keyId is Razorpay's public key; it is null for the
// mock gateway, whose checkout is a panel on the page.
export const topUpOrderSchema = z.object({
  orderId: z.string(),
  gateway: paymentGatewayNameSchema,
  gatewayOrderId: z.string(),
  amountPaise: paise,
  currency: z.string(),
  keyId: z.string().nullable(),
});

// What checkout hands back to the page. It proves nothing on its own: the API
// verifies the signature and then asks the gateway itself before crediting.
export const topUpConfirmSchema = z.object({
  gatewayPaymentId: z.string().min(1),
  signature: z.string().min(1),
});

export const mockCheckoutSchema = z.object({ outcome: z.enum(["success", "failure"]) });

export const topUpStatusSchema = z.object({
  orderId: z.string(),
  status: z.enum(["CREATED", "CAPTURED", "FAILED"]),
  failureReason: z.string().nullable(),
  balancePaise: paise,
});

export const pricingRuleSchema = z.object({
  id: z.string(),
  event: z.string(),
  unit: z.string(),
  pricePaise: paise,
  effectiveFrom: z.string(),
  createdAt: z.string(),
});

export const createPricingRuleSchema = z.object({
  pricePaise: paise.min(0).max(1_000_000_00),
  // Defaults to now. Never earlier than now: a price is never applied to
  // check-ins that have already happened.
  effectiveFrom: z.string().datetime().optional(),
});

export type LedgerEntryView = z.infer<typeof ledgerEntrySchema>;
export type Wallet = z.infer<typeof walletSchema>;
export type TopUpRequest = z.infer<typeof topUpRequestSchema>;
export type TopUpOrder = z.infer<typeof topUpOrderSchema>;
export type TopUpConfirm = z.infer<typeof topUpConfirmSchema>;
export type MockCheckout = z.infer<typeof mockCheckoutSchema>;
export type TopUpStatus = z.infer<typeof topUpStatusSchema>;
export type PricingRuleView = z.infer<typeof pricingRuleSchema>;
export type CreatePricingRule = z.infer<typeof createPricingRuleSchema>;
export type PaymentGatewayName = z.infer<typeof paymentGatewayNameSchema>;
