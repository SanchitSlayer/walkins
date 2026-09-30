import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { createDriveSchema, driveSearchQuerySchema, updateDriveSchema, type VenuePinInput, venuePinSchema } from "@walkins/shared";
import type { AccessTokenPayload } from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../common/optional-jwt-auth.guard";
import { requireCompanyId } from "../common/require-company";
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
    return this.drivesService.create(requireCompanyId(user), body);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDriveSchema)) body: ReturnType<typeof updateDriveSchema.parse>,
  ) {
    return this.drivesService.update(requireCompanyId(user), id, body);
  }

  @Post(":id/venue-pin")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  pinVenue(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(venuePinSchema)) body: VenuePinInput,
  ) {
    return this.drivesService.pinVenue(requireCompanyId(user), user.userId, id, body);
  }

  @Post(":id/submit")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  submit(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string) {
    return this.drivesService.submit(requireCompanyId(user), id);
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
    return this.drivesService.listMine(requireCompanyId(user), cursor, parsedLimit);
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
    return this.drivesService.findOne(requireCompanyId(user), id);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  remove(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string) {
    return this.drivesService.remove(requireCompanyId(user), id);
  }
}
