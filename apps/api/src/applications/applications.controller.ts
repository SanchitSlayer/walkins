import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  type AccessTokenPayload,
  type ApplyInput,
  applySchema,
  type EmployerApplicationUpdate,
  employerApplicationUpdateSchema,
} from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { requireCompanyId } from "../common/require-company";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ApplicationsService } from "./applications.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post("drives/:id/apply")
  @Roles("CANDIDATE")
  apply(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") driveId: string,
    @Body(new ZodValidationPipe(applySchema)) body: ApplyInput,
  ) {
    return this.applications.apply(user.userId, driveId, body.slotId);
  }

  @Get("applications/mine")
  @Roles("CANDIDATE")
  listMine(@CurrentUser() user: AccessTokenPayload) {
    return this.applications.listMine(user.userId);
  }

  @Delete("applications/:id")
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
    return this.applications.updateByEmployer(requireCompanyId(user), user.userId, id, body);
  }
}
