import { Module } from "@nestjs/common";
import { RateLimiterService } from "../common/rate-limiter.service";
import { LiveModule } from "../live/live.module";
import { CheckInTokenService } from "./check-in-token.service";
import { CheckInController } from "./check-in.controller";
import { CheckInService } from "./check-in.service";

@Module({
  imports: [LiveModule],
  controllers: [CheckInController],
  providers: [CheckInService, CheckInTokenService, RateLimiterService],
})
export class CheckInModule {}
