import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createDriveSchema,
  driveSearchQuerySchema,
  reassignDriveSchema,
  type RescheduleDriveInput,
  rescheduleDriveSchema,
  updateDriveSchema,
  type VenuePinInput,
  venuePinSchema,
} from "@walkins/shared";
import type { AccessTokenPayload } from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../common/optional-jwt-auth.guard";
import { LIMITS, RateLimit } from "../common/rate-limit";
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
  @RateLimit(LIMITS.driveCreate, LIMITS.driveCreateCompany)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(createDriveSchema)) body: ReturnType<typeof createDriveSchema.parse>,
  ) {
    return this.drivesService.create(user.userId, body);
  }

  @Patch(":id")
  @RateLimit(LIMITS.driveEdit)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDriveSchema)) body: ReturnType<typeof updateDriveSchema.parse>,
  ) {
    return this.drivesService.update(user.userId, id, body);
  }

  @Post(":id/venue-pin")
  @RateLimit(LIMITS.driveEdit)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  pinVenue(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(venuePinSchema)) body: VenuePinInput,
  ) {
    return this.drivesService.pinVenue(user.userId, id, body);
  }

  @Post(":id/submit")
  @RateLimit(LIMITS.driveEdit)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  submit(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string) {
    return this.drivesService.submit(user.userId, id);
  }

  @Post(":id/reschedule")
  @RateLimit(LIMITS.driveEdit)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  reschedule(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rescheduleDriveSchema)) body: RescheduleDriveInput,
  ) {
    return this.drivesService.reschedule(user.userId, id, body);
  }

  @Post(":id/owner")
  @RateLimit(LIMITS.driveEdit)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  reassign(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reassignDriveSchema)) body: { ownerId: string },
  ) {
    return this.drivesService.reassign(user.userId, id, body.ownerId);
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
    return this.drivesService.listMine(user.userId, cursor, parsedLimit);
  }

  @Get("search")
  @RateLimit(LIMITS.publicRead)
  @UseGuards(OptionalJwtAuthGuard)
  search(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Query(new ZodValidationPipe(driveSearchQuerySchema)) query: ReturnType<typeof driveSearchQuerySchema.parse>,
  ) {
    return this.drivesService.search(query, user?.userId ?? null);
  }

  @Get(":id/public")
  @RateLimit(LIMITS.publicRead)
  @UseGuards(OptionalJwtAuthGuard)
  findPublicOne(@CurrentUser() user: AccessTokenPayload | undefined, @Param("id") id: string) {
    return this.drivesService.findPublicOne(id, user?.userId ?? null);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  findOne(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string) {
    return this.drivesService.findOne(user.userId, id);
  }

  @Delete(":id")
  @RateLimit(LIMITS.driveEdit)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER")
  remove(@CurrentUser() user: AccessTokenPayload, @Param("id") id: string) {
    return this.drivesService.remove(user.userId, id);
  }
}
