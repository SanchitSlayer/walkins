import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  type AccessTokenPayload,
  type CandidateReport,
  candidateReportSchema,
  type DecideSubmission,
  decideSubmissionSchema,
  type DocumentUploadRequest,
  documentUploadRequestSchema,
  type DriveReport,
  driveReportSchema,
  type Moderate,
  moderateSchema,
  type SubmitVerification,
  submitVerificationSchema,
} from "@walkins/shared";
import type { Request } from "express";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../common/optional-jwt-auth.guard";
import { LIMITS, RateLimit } from "../common/rate-limit";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ModerationService } from "./moderation.service";
import { ReportsService } from "./reports.service";
import { VerificationService } from "./verification.service";

// A company's own standing: verification, warnings, how far its drives reach.
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EMPLOYER")
export class StandingController {
  constructor(
    private readonly verification: VerificationService,
    private readonly reports: ReportsService,
  ) {}

  @Get("companies/me/standing")
  standing(@CurrentUser() user: AccessTokenPayload) {
    return this.verification.standing(user.userId);
  }

  @Post("companies/me/verification/documents")
  @RateLimit(LIMITS.verificationUpload)
  startUpload(@CurrentUser() user: AccessTokenPayload, @Body(new ZodValidationPipe(documentUploadRequestSchema)) body: DocumentUploadRequest) {
    return this.verification.startDocumentUpload(user.userId, body);
  }

  @Post("companies/me/verification")
  @RateLimit(LIMITS.verificationSubmit)
  submit(@CurrentUser() user: AccessTokenPayload, @Body(new ZodValidationPipe(submitVerificationSchema)) body: SubmitVerification) {
    return this.verification.submit(user.userId, body);
  }

  @Get("drives/:id/reach")
  reach(@CurrentUser() user: AccessTokenPayload, @Param("id") driveId: string) {
    return this.verification.reach(user.userId, driveId);
  }

  @Post("reports/candidate")
  @RateLimit(LIMITS.reportCandidate)
  @HttpCode(200)
  reportCandidate(@CurrentUser() user: AccessTokenPayload, @Body(new ZodValidationPipe(candidateReportSchema)) body: CandidateReport) {
    return this.reports.reportCandidate(user.userId, body);
  }
}

// Warnings are acknowledged by whoever they were for: someone at the
// company, or the candidate.
@Controller("warnings")
@UseGuards(JwtAuthGuard)
export class WarningsController {
  constructor(private readonly verification: VerificationService) {}

  @Get("mine")
  mine(@CurrentUser() user: AccessTokenPayload) {
    return this.verification.candidateWarnings(user.userId);
  }

  @Post(":id/acknowledge")
  @HttpCode(204)
  acknowledge(@CurrentUser() user: AccessTokenPayload, @Param("id") warningId: string) {
    return this.verification.acknowledgeWarning(user.userId, warningId);
  }
}

// No login needed: the person most likely to spot a scam drive hasn't
// signed up. See ReportsService for why that is safe.
@Controller("drives")
export class DriveReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post(":id/report")
  @RateLimit(LIMITS.reportDrive)
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(200)
  report(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Req() request: Request,
    @Param("id") driveId: string,
    @Body(new ZodValidationPipe(driveReportSchema)) body: DriveReport,
  ) {
    return this.reports.reportDrive(driveId, body, user?.userId ?? null, request.ip ?? "unknown");
  }
}

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class TrustAdminController {
  constructor(
    private readonly verification: VerificationService,
    private readonly moderation: ModerationService,
  ) {}

  @Get("verification")
  submissions() {
    return this.verification.queue();
  }

  @Post("verification/:id/decision")
  @HttpCode(200)
  decide(@CurrentUser() user: AccessTokenPayload, @Param("id") submissionId: string, @Body(new ZodValidationPipe(decideSubmissionSchema)) body: DecideSubmission) {
    return this.verification.decide(user.userId, submissionId, body);
  }

  @Get("moderation")
  queue() {
    return this.moderation.queue();
  }

  @Post("moderation")
  @HttpCode(200)
  act(@CurrentUser() user: AccessTokenPayload, @Body(new ZodValidationPipe(moderateSchema)) body: Moderate) {
    return this.moderation.act(user.userId, body);
  }
}
