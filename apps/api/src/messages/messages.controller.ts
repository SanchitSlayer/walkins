import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { type AccessTokenPayload, markReadSchema, type MessageReport, messageReportSchema, type SendMessage, sendMessageSchema } from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { LIMITS, RateLimit } from "../common/rate-limit";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { MessagesService } from "./messages.service";

// The company's side: every thread belongs to the company, read by all of it.
@Controller("companies/me")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EMPLOYER")
export class CompanyMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get("threads")
  threads(@CurrentUser() user: AccessTokenPayload, @Query("driveId") driveId?: string) {
    return this.messages.companyThreads(user.userId, driveId || undefined);
  }

  @Get("threads/:applicationId")
  thread(@CurrentUser() user: AccessTokenPayload, @Param("applicationId") applicationId: string) {
    return this.messages.companyThread(user.userId, applicationId);
  }

  @Post("threads/:applicationId/messages")
  @RateLimit(LIMITS.messageSend, LIMITS.messageSendCompany)
  send(
    @CurrentUser() user: AccessTokenPayload,
    @Param("applicationId") applicationId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessage,
  ) {
    return this.messages.companySend(user.userId, applicationId, body.body);
  }

  @Post("threads/:applicationId/read")
  @HttpCode(204)
  read(@CurrentUser() user: AccessTokenPayload, @Param("applicationId") applicationId: string, @Body(new ZodValidationPipe(markReadSchema)) body: { seq: number }) {
    return this.messages.companyRead(user.userId, applicationId, body.seq);
  }

  @Get("flagged-messages")
  flagged(@CurrentUser() user: AccessTokenPayload) {
    return this.messages.flagged(user.userId);
  }

  @Post("flagged-messages/:id/reviewed")
  @HttpCode(204)
  reviewed(@CurrentUser() user: AccessTokenPayload, @Param("id") messageId: string) {
    return this.messages.reviewFlag(user.userId, messageId);
  }
}

@Controller("me/threads")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("CANDIDATE")
export class CandidateMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  threads(@CurrentUser() user: AccessTokenPayload) {
    return this.messages.candidateThreads(user.userId);
  }

  @Get(":applicationId")
  thread(@CurrentUser() user: AccessTokenPayload, @Param("applicationId") applicationId: string) {
    return this.messages.candidateThread(user.userId, applicationId);
  }

  @Post(":applicationId/messages")
  @RateLimit(LIMITS.messageSendCandidate)
  send(
    @CurrentUser() user: AccessTokenPayload,
    @Param("applicationId") applicationId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessage,
  ) {
    return this.messages.candidateSend(user.userId, applicationId, body.body);
  }

  @Post(":applicationId/read")
  @HttpCode(204)
  read(@CurrentUser() user: AccessTokenPayload, @Param("applicationId") applicationId: string, @Body(new ZodValidationPipe(markReadSchema)) body: { seq: number }) {
    return this.messages.candidateRead(user.userId, applicationId, body.seq);
  }
}

// Either side reports a message from the other.
@Controller("messages")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EMPLOYER", "CANDIDATE")
export class MessageReportsController {
  constructor(private readonly messages: MessagesService) {}

  @Post(":id/report")
  @RateLimit(LIMITS.reportMessage)
  @HttpCode(200)
  report(@CurrentUser() user: AccessTokenPayload, @Param("id") messageId: string, @Body(new ZodValidationPipe(messageReportSchema)) body: MessageReport) {
    return this.messages.report(user.userId, messageId, body);
  }
}

@Controller("admin/threads")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AdminThreadsController {
  constructor(private readonly messages: MessagesService) {}

  @Get(":id")
  thread(@CurrentUser() user: AccessTokenPayload, @Param("id") threadId: string) {
    return this.messages.adminThread(user.userId, threadId);
  }
}
