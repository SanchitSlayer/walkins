import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { CatalogModule } from "./catalog/catalog.module";
import { DrivesModule } from "./drives/drives.module";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [HealthModule, AuthModule, CatalogModule, DrivesModule],
})
export class AppModule {}
