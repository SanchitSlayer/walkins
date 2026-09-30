import { Module } from "@nestjs/common";
import { ApplicationsModule } from "./applications/applications.module";
import { AuthModule } from "./auth/auth.module";
import { CandidatesModule } from "./candidates/candidates.module";
import { CatalogModule } from "./catalog/catalog.module";
import { CheckInModule } from "./check-in/check-in.module";
import { DrivesModule } from "./drives/drives.module";
import { HealthModule } from "./health/health.module";
import { LiveModule } from "./live/live.module";

@Module({
  imports: [
    HealthModule,
    AuthModule,
    CandidatesModule,
    CatalogModule,
    DrivesModule,
    ApplicationsModule,
    CheckInModule,
    LiveModule,
  ],
})
export class AppModule {}
