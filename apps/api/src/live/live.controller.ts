import { Controller, Get, NotFoundException, Param, UseGuards } from "@nestjs/common";
import type { AccessTokenPayload } from "@walkins/shared";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { requireCompanyId } from "../common/require-company";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { LiveBoardService } from "./live-board.service";

// The same payloads the socket pushes, for the first paint and for the alert
// count, which changes in the worker and so is never pushed from here.
@Controller("drives")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("EMPLOYER")
export class LiveController {
  constructor(private readonly board: LiveBoardService) {}

  @Get(":id/live")
  async snapshot(@CurrentUser() user: AccessTokenPayload, @Param("id") driveId: string) {
    await this.requireOwned(user, driveId);
    return this.board.snapshot(driveId);
  }

  @Get(":id/live/display")
  async display(@CurrentUser() user: AccessTokenPayload, @Param("id") driveId: string) {
    await this.requireOwned(user, driveId);
    return this.board.display(driveId);
  }

  private async requireOwned(user: AccessTokenPayload, driveId: string) {
    if (!(await this.board.ownsDrive(requireCompanyId(user), driveId))) {
      throw new NotFoundException("Drive not found");
    }
  }
}
