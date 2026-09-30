import { Module } from "@nestjs/common";
import { LiveBoardService } from "./live-board.service";
import { LiveController } from "./live.controller";
import { LiveGateway } from "./live.gateway";

@Module({
  controllers: [LiveController],
  providers: [LiveBoardService, LiveGateway],
  exports: [LiveGateway],
})
export class LiveModule {}
