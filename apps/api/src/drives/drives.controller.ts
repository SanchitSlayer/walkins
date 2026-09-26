import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { createDriveSchema, driveSearchQuerySchema, updateDriveSchema } from "@walkins/shared";
import type { AccessTokenPayload } from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../common/optional-jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { DrivesService } from "./drives.service";

// No class-level guards here: /drives/search is public (optional auth) while
// every other route is employer-only, and Nest guards are additive rather
// than overridable per method, so each route declares its own.
@Controller("drives")
export class DrivesController {
  constructor(private readonly drivesService: DrivesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(createDriveSchema)) body: ReturnType<typeof createDriveSchema.parse>,
  ) {
    return this.drivesService.create(this.requireCompanyId(user), body);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDriveSchema)) body: ReturnType<typeof updateDriveSchema.parse>,
  ) {
    return this.drivesService.update(this.requireCompanyId(user), id, body);
  }

  @Post(":id/submit")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  submit(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string) {
    return this.drivesService.submit(this.requireCompanyId(user), id);
  }

  @Get("mine")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  listMine(
    @CurrentUser() user: AccessTokenPayload,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    return this.drivesService.listMine(this.requireCompanyId(user), cursor, parsedLimit);
  }

  @Get("search")
  @UseGuards(OptionalJwtAuthGuard)
  search(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Query(new ZodValidationPipe(driveSearchQuerySchema)) query: ReturnType<typeof driveSearchQuerySchema.parse>,
  ) {
    return this.drivesService.search(query, user?.userId ?? null);
  }

  @Get(":id/public")
  @UseGuards(OptionalJwtAuthGuard)
  findPublicOne(@CurrentUser() user: AccessTokenPayload | undefined, @Param("id") id: string) {
    return this.drivesService.findPublicOne(id, user?.userId ?? null);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  findOne(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string) {
    return this.drivesService.findOne(this.requireCompanyId(user), id);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
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
