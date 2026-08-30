import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { createDriveSchema, updateDriveSchema } from "@walkins/shared";
import type { AccessTokenPayload } from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { DrivesService } from "./drives.service";

@Controller("drives")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EMPLOYER")
export class DrivesController {
  constructor(private readonly drivesService: DrivesService) {}

  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(createDriveSchema)) body: ReturnType<typeof createDriveSchema.parse>,
  ) {
    return this.drivesService.create(this.requireCompanyId(user), body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDriveSchema)) body: ReturnType<typeof updateDriveSchema.parse>,
  ) {
    return this.drivesService.update(this.requireCompanyId(user), id, body);
  }

  @Post(":id/submit")
  submit(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string) {
    return this.drivesService.submit(this.requireCompanyId(user), id);
  }

  @Get("mine")
  listMine(
    @CurrentUser() user: AccessTokenPayload,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    return this.drivesService.listMine(this.requireCompanyId(user), cursor, parsedLimit);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string) {
    return this.drivesService.findOne(this.requireCompanyId(user), id);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string) {
    return this.drivesService.remove(this.requireCompanyId(user), id);
  }

  private requireCompanyId(user: AccessTokenPayload): string {
    if (!user.companyId) {
      throw new ForbiddenException("This account is not linked to a company");
    }
    return user.companyId;
  }
}
