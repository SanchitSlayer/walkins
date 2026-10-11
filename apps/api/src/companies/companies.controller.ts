import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  type AccessTokenPayload,
  changeRoleSchema,
  type CompanyRole,
  type CompanySettings,
  companySettingsSchema,
  type Invite,
  inviteSchema,
  removeMemberSchema,
} from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { LIMITS, RateLimit } from "../common/rate-limit";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CompaniesService } from "./companies.service";
import { PeopleService } from "./people.service";

@Controller("companies")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EMPLOYER")
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly people: PeopleService,
  ) {}

  @Get("me")
  settings(@CurrentUser() user: AccessTokenPayload) {
    return this.companies.settings(user.userId);
  }

  @Get("me/analytics")
  analytics(@CurrentUser() user: AccessTokenPayload) {
    return this.companies.analytics(user.userId);
  }

  @Patch("me")
  updateSettings(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(companySettingsSchema)) body: CompanySettings,
  ) {
    return this.companies.updateSettings(user.userId, body);
  }

  @Get("me/membership")
  membership(@CurrentUser() user: AccessTokenPayload) {
    return this.people.membership(user.userId);
  }

  @Get("me/people")
  listPeople(@CurrentUser() user: AccessTokenPayload) {
    return this.people.list(user.userId);
  }

  @Post("me/invitations")
  @RateLimit(LIMITS.invitations)
  invite(@CurrentUser() user: AccessTokenPayload, @Body(new ZodValidationPipe(inviteSchema)) body: Invite) {
    return this.people.invite(user.userId, body);
  }

  @Delete("me/invitations/:id")
  @HttpCode(204)
  revoke(@CurrentUser() user: AccessTokenPayload, @Param("id") invitationId: string) {
    return this.people.revoke(user.userId, invitationId);
  }

  @Patch("me/members/:userId")
  changeRole(
    @CurrentUser() user: AccessTokenPayload,
    @Param("userId") targetId: string,
    @Body(new ZodValidationPipe(changeRoleSchema)) body: { role: CompanyRole; successorId?: string },
  ) {
    return this.people.changeRole(user.userId, targetId, body.role, body.successorId);
  }

  @Post("me/members/:userId/remove")
  @HttpCode(200)
  remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param("userId") targetId: string,
    @Body(new ZodValidationPipe(removeMemberSchema)) body: { successorId?: string },
  ) {
    return this.people.remove(user.userId, targetId, body.successorId);
  }
}

// The invitee's side. Any signed-in account: an invitation is usually
// accepted by someone who signed up as a candidate a minute earlier.
@Controller("invitations")
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private readonly people: PeopleService) {}

  @Get("mine")
  mine(@CurrentUser() user: AccessTokenPayload) {
    return this.people.mine(user.userId);
  }

  @Post(":id/accept")
  @HttpCode(200)
  accept(@CurrentUser() user: AccessTokenPayload, @Param("id") invitationId: string) {
    return this.people.accept(user.userId, invitationId);
  }
}
