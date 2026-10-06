import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { type AccessTokenPayload, type CompanySettings, companySettingsSchema } from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { requireCompanyId } from "../common/require-company";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CompaniesService } from "./companies.service";

@Controller("companies")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EMPLOYER")
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get("me")
  settings(@CurrentUser() user: AccessTokenPayload) {
    return this.companies.settings(requireCompanyId(user));
  }

  @Get("me/analytics")
  analytics(@CurrentUser() user: AccessTokenPayload) {
    return this.companies.analytics(requireCompanyId(user));
  }

  @Patch("me")
  updateSettings(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(companySettingsSchema)) body: CompanySettings,
  ) {
    return this.companies.updateSettings(requireCompanyId(user), body);
  }
}
