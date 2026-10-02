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
import { requireCompanyId } from "../common/require-company";
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
  @Roles("EMPLOYER")
  issueCode(@CurrentUser() user: AccessTokenPayload, @Param("id") driveId: string) {
    return this.checkIns.issueCode(requireCompanyId(user), driveId);
  }

  @Post("applications/:id/check-in")
  @Roles("EMPLOYER")
  markPresent(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") applicationId: string,
    @Body(new ZodValidationPipe(manualCheckInSchema)) body: ManualCheckInInput,
  ) {
    return this.checkIns.markPresent(requireCompanyId(user), user.userId, applicationId, body.reason);
  }

  @Post("check-ins/:id/confirm")
  @Roles("EMPLOYER")
  confirm(@CurrentUser() user: AccessTokenPayload, @Param("id") checkInId: string) {
    return this.checkIns.confirmFlagged(requireCompanyId(user), user.userId, checkInId);
  }
}
