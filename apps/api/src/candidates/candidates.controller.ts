import { Body, Controller, Get, Param, Patch, Post, Res, UseGuards } from "@nestjs/common";
import type { AccessTokenPayload, SetLocale, VoiceUploadRequest } from "@walkins/shared";
import { setLocaleSchema, updateCandidateProfileSchema, voiceUploadRequestSchema } from "@walkins/shared";
import type { Response } from "express";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { setLocaleCookie } from "../common/locale-cookie";
import { LIMITS, RateLimit } from "../common/rate-limit";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CandidatesService } from "./candidates.service";
import { VoiceIntroService } from "./voice-intro.service";

@Controller("candidates")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("CANDIDATE")
export class CandidatesController {
  constructor(
    private readonly candidatesService: CandidatesService,
    private readonly voiceIntros: VoiceIntroService,
  ) {}

  @Get("me/voice-intro")
  currentVoiceIntro(@CurrentUser() user: AccessTokenPayload) {
    return this.voiceIntros.current(user.userId);
  }

  @Post("me/voice-intro/uploads")
  @RateLimit(LIMITS.voiceUpload)
  startVoiceUpload(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(voiceUploadRequestSchema)) body: VoiceUploadRequest,
  ) {
    return this.voiceIntros.startUpload(user.userId, body.contentType);
  }

  @Post("me/voice-intro/uploads/:id/complete")
  @RateLimit(LIMITS.voiceUpload)
  completeVoiceUpload(@CurrentUser() user: AccessTokenPayload, @Param("id") introId: string) {
    return this.voiceIntros.completeUpload(user.userId, introId);
  }

  @Get("me")
  getMe(@CurrentUser() user: AccessTokenPayload) {
    return this.candidatesService.getMe(user.userId);
  }

  @Patch("me")
  @RateLimit(LIMITS.profileEdit)
  updateMe(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(updateCandidateProfileSchema))
    body: ReturnType<typeof updateCandidateProfileSchema.parse>,
  ) {
    return this.candidatesService.updateMe(user.userId, body);
  }

  @Patch("me/locale")
  @RateLimit(LIMITS.profileEdit)
  async setLocale(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(setLocaleSchema)) body: SetLocale,
    @Res({ passthrough: true }) response: Response,
  ) {
    const saved = await this.candidatesService.setLocale(user.userId, body.locale);
    setLocaleCookie(response, saved.locale);
    return saved;
  }

  @Post("me/telegram-link")
  @RateLimit(LIMITS.telegramLink)
  createTelegramLink(@CurrentUser() user: AccessTokenPayload) {
    return this.candidatesService.createTelegramLink(user.userId);
  }
}
