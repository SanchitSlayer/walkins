import { Body, Controller, Get, Headers, HttpCode, Param, Post, type RawBodyRequest, Req, UseGuards } from "@nestjs/common";
import {
  type AccessTokenPayload,
  type MockCheckout,
  mockCheckoutSchema,
  type TopUpConfirm,
  topUpConfirmSchema,
  type TopUpRequest,
  topUpRequestSchema,
} from "@walkins/shared";
import type { Request } from "express";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { requireCompanyId } from "../common/require-company";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { BillingService } from "./billing.service";

@Controller("billing")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EMPLOYER")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("wallet")
  wallet(@CurrentUser() user: AccessTokenPayload) {
    return this.billing.wallet(requireCompanyId(user));
  }

  @Post("top-ups")
  createTopUp(@CurrentUser() user: AccessTokenPayload, @Body(new ZodValidationPipe(topUpRequestSchema)) body: TopUpRequest) {
    return this.billing.createTopUp(requireCompanyId(user), user.userId, body.amountPaise);
  }

  @Get("top-ups/:id")
  topUpStatus(@CurrentUser() user: AccessTokenPayload, @Param("id") orderId: string) {
    return this.billing.topUpStatus(requireCompanyId(user), orderId);
  }

  @Post("top-ups/:id/confirm")
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") orderId: string,
    @Body(new ZodValidationPipe(topUpConfirmSchema)) body: TopUpConfirm,
  ) {
    return this.billing.confirmTopUp(requireCompanyId(user), orderId, body);
  }

  @Post("top-ups/:id/mock-checkout")
  @HttpCode(200)
  mockCheckout(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") orderId: string,
    @Body(new ZodValidationPipe(mockCheckoutSchema)) body: MockCheckout,
  ) {
    return this.billing.mockCheckout(requireCompanyId(user), orderId, body.outcome);
  }
}

// Called by the gateway, not a person, so there is no login: the signature
// over the raw body is the only authentication.
@Controller("billing/webhooks")
export class PaymentWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post(":gateway")
  @HttpCode(200)
  receive(
    @Param("gateway") gateway: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-razorpay-signature") signature: string | undefined,
    @Headers("x-razorpay-event-id") eventId: string | undefined,
  ) {
    return this.billing.handleWebhook(gateway, request.rawBody, signature, eventId);
  }
}
