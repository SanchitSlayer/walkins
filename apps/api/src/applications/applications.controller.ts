import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  type AccessTokenPayload,
  type ApplicantsAction,
  applicantsActionSchema,
  applicantsQuerySchema,
  type ApplyInput,
  applySchema,
  type CandidateAnswer,
  candidateAnswerSchema,
  type EmployerApplicationUpdate,
  employerApplicationUpdateSchema,
  type RecordOutcome,
  recordOutcomeSchema,
} from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { LIMITS, RateLimit } from "../common/rate-limit";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ApplicantsService } from "./applicants.service";
import { ApplicationsService } from "./applications.service";
import { OutcomesService } from "./outcomes.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly applicants: ApplicantsService,
    private readonly outcomes: OutcomesService,
  ) {}

  @Get("companies/me/outcomes")
  @Roles("EMPLOYER")
  listOutcomes(@CurrentUser() user: AccessTokenPayload, @Query("driveId") driveId?: string) {
    return this.outcomes.list(user.userId, driveId || undefined);
  }

  @Patch("applications/:id/outcome")
  @RateLimit(LIMITS.driveEdit)
  @Roles("EMPLOYER")
  recordOutcome(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(recordOutcomeSchema)) body: RecordOutcome,
  ) {
    return this.outcomes.record(user.userId, id, body);
  }

  @Post("applications/:id/started")
  @HttpCode(204)
  @Roles("CANDIDATE")
  answerStarted(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(candidateAnswerSchema)) body: CandidateAnswer,
  ) {
    return this.outcomes.candidateAnswer(user.userId, id, body.started);
  }

  @Get("drives/:id/applicants")
  @Roles("EMPLOYER")
  listApplicants(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") driveId: string,
    @Query(new ZodValidationPipe(applicantsQuerySchema)) query: { weight: number },
  ) {
    return this.applicants.list(user.userId, driveId, query.weight);
  }

  @Post("drives/:id/applicants/actions")
  @RateLimit(LIMITS.applicantActions, LIMITS.applicantActionsCompany)
  @Roles("EMPLOYER")
  actOnApplicants(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") driveId: string,
    @Body(new ZodValidationPipe(applicantsActionSchema)) body: ApplicantsAction,
  ) {
    return this.applicants.act(user.userId, driveId, body);
  }

  @Get("applications/:id/intro-audio")
  @RateLimit(LIMITS.introAudio)
  @Roles("EMPLOYER")
  introAudio(@CurrentUser() user: AccessTokenPayload, @Param("id") applicationId: string) {
    return this.applicants.introAudio(user.userId, applicationId);
  }

  @Post("drives/:id/apply")
  @RateLimit(LIMITS.application)
  @Roles("CANDIDATE")
  apply(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") driveId: string,
    @Body(new ZodValidationPipe(applySchema)) body: ApplyInput,
  ) {
    return this.applications.apply(user.userId, driveId, body.slotId, body.answers);
  }

  @Get("candidates/me/record")
  @Roles("CANDIDATE")
  myRecord(@CurrentUser() user: AccessTokenPayload) {
    return this.applications.myRecord(user.userId);
  }

  @Get("applications/mine")
  @Roles("CANDIDATE")
  listMine(@CurrentUser() user: AccessTokenPayload) {
    return this.applications.listMine(user.userId);
  }

  @Delete("applications/:id")
  @RateLimit(LIMITS.application)
  @Roles("CANDIDATE")
  release(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string) {
    return this.applications.release(user.userId, id);
  }

  @Patch("applications/:id/state")
  @Roles("EMPLOYER")
  updateState(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(employerApplicationUpdateSchema)) body: EmployerApplicationUpdate,
  ) {
    return this.applications.updateByEmployer(user.userId, id, body);
  }
}
