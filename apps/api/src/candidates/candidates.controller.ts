import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import type { AccessTokenPayload } from "@walkins/shared";
import { updateCandidateProfileSchema } from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CandidatesService } from "./candidates.service";

@Controller("candidates")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("CANDIDATE")
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

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
