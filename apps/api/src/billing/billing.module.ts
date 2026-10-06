import { Module } from "@nestjs/common";
import { BillingController, PaymentWebhookController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { MockGateway } from "./mock-gateway";
import { PAYMENT_GATEWAY } from "./payment-gateway";
import { RazorpayGateway } from "./razorpay-gateway";

@Module({
  controllers: [BillingController, PaymentWebhookController],
  providers: [
    BillingService,
    {
      provide: PAYMENT_GATEWAY,
      // Mock by default, so the whole flow demos with no network and no keys,
      // as alerts do without a Telegram token.
      useFactory: () => ((process.env.PAYMENT_GATEWAY ?? "mock") === "razorpay" ? new RazorpayGateway() : new MockGateway()),
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
