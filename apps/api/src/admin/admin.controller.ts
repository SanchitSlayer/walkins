import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  type AccessTokenPayload,
  type CreatePricingRule,
  createPricingRuleSchema,
  type ModerateDrive,
  moderateDriveSchema,
} from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("drives")
  drives() {
    return this.admin.drives();
  }

  @Post("drives/:id/moderation")
  @HttpCode(200)
  moderate(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") driveId: string,
    @Body(new ZodValidationPipe(moderateDriveSchema)) body: ModerateDrive,
  ) {
    return this.admin.moderateDrive(user.userId, driveId, body);
  }

  @Get("jobs/failed")
  failedJobs() {
    return this.admin.failedJobs();
  }

  @Post("jobs/:queue/:id/retry")
  @HttpCode(200)
  retry(@Param("queue") queue: string, @Param("id") jobId: string) {
    return this.admin.retryJob(queue, jobId);
  }

  @Get("ledger")
  ledger(@Query("accountId") accountId?: string, @Query("txnId") txnId?: string) {
    return this.admin.ledger({ accountId: accountId || undefined, txnId: txnId || undefined });
  }

  @Get("pricing")
  pricing() {
    return this.admin.pricingRules();
  }

  @Post("pricing")
  createPricing(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(createPricingRuleSchema)) body: CreatePricingRule,
  ) {
    return this.admin.createPricingRule(user.userId, body);
  }
}
