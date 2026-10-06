import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module";
import { ApplicationsModule } from "./applications/applications.module";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { CandidatesModule } from "./candidates/candidates.module";
import { CatalogModule } from "./catalog/catalog.module";
import { CheckInModule } from "./check-in/check-in.module";
import { CompaniesModule } from "./companies/companies.module";
import { InfrastructureModule } from "./common/infrastructure.module";
import { DrivesModule } from "./drives/drives.module";
import { HealthModule } from "./health/health.module";
import { LiveModule } from "./live/live.module";

@Module({
  imports: [
    InfrastructureModule,
    HealthModule,
    AuthModule,
    CandidatesModule,
    CatalogModule,
    DrivesModule,
    ApplicationsModule,
    CheckInModule,
    CompaniesModule,
    LiveModule,
    BillingModule,
    AdminModule,
  ],
})
export class AppModule {}
