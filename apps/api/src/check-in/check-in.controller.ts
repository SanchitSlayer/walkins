import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  type AccessTokenPayload,
  type CheckInRequest,
  checkInRequestSchema,
  type ManualCheckInInput,
  manualCheckInSchema,
} from "@walkins/shared";
import type { Request } from "express";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { LIMITS, RateLimit } from "../common/rate-limit";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CheckInService } from "./check-in.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CheckInController {
  constructor(private readonly checkIns: CheckInService) {}

  @Post("check-in")
  @Roles("CANDIDATE")
  checkIn(
    @CurrentUser() user: AccessTokenPayload,
    @Req() request: Request,
    @Body(new ZodValidationPipe(checkInRequestSchema)) body: CheckInRequest,
  ) {
    return this.checkIns.checkIn(user.userId, request.ip ?? "unknown", body);
  }

  @Get("drives/:id/checkin-code")
  @RateLimit(LIMITS.checkInCode)
  @Roles("EMPLOYER")
  issueCode(@CurrentUser() user: AccessTokenPayload, @Param("id") driveId: string) {
    return this.checkIns.issueCode(user.userId, driveId);
  }

  @Post("applications/:id/check-in")
  @Roles("EMPLOYER")
  markPresent(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") applicationId: string,
    @Body(new ZodValidationPipe(manualCheckInSchema)) body: ManualCheckInInput,
  ) {
    return this.checkIns.markPresent(user.userId, applicationId, body.reason);
  }

  @Post("check-ins/:id/confirm")
  @Roles("EMPLOYER")
  confirm(@CurrentUser() user: AccessTokenPayload, @Param("id") checkInId: string) {
    return this.checkIns.confirmFlagged(user.userId, checkInId);
  }
}
