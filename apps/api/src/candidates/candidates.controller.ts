import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { AccessTokenPayload, VoiceUploadRequest } from "@walkins/shared";
import { updateCandidateProfileSchema, voiceUploadRequestSchema } from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
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
  startVoiceUpload(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(voiceUploadRequestSchema)) body: VoiceUploadRequest,
  ) {
    return this.voiceIntros.startUpload(user.userId, body.contentType);
  }

  @Post("me/voice-intro/uploads/:id/complete")
  completeVoiceUpload(@CurrentUser() user: AccessTokenPayload, @Param("id") introId: string) {
    return this.voiceIntros.completeUpload(user.userId, introId);
  }

  @Get("me")
  getMe(@CurrentUser() user: AccessTokenPayload) {
    return this.candidatesService.getMe(user.userId);
  }

  @Patch("me")
  updateMe(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(updateCandidateProfileSchema))
    body: ReturnType<typeof updateCandidateProfileSchema.parse>,
  ) {
    return this.candidatesService.updateMe(user.userId, body);
  }

  @Post("me/telegram-link")
  createTelegramLink(@CurrentUser() user: AccessTokenPayload) {
    return this.candidatesService.createTelegramLink(user.userId);
  }
}
