import { Module } from "@nestjs/common";
import { LiveModule } from "../live/live.module";
import { ModerationService } from "./moderation.service";
import { ReportsService } from "./reports.service";
import { DriveReportsController, StandingController, TrustAdminController, WarningsController } from "./trust.controller";
import { MockVerificationProvider, VERIFICATION_PROVIDER } from "./verification-provider";
import { VerificationService } from "./verification.service";

// Trust and safety: company verification, reports, and moderation.
@Module({
  imports: [LiveModule],
  controllers: [StandingController, WarningsController, DriveReportsController, TrustAdminController],
  providers: [VerificationService, ReportsService, ModerationService, { provide: VERIFICATION_PROVIDER, useClass: MockVerificationProvider }],
})
export class TrustModule {}
