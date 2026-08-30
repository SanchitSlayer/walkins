import { Module } from "@nestjs/common";
import { DrivesController } from "./drives.controller";
import { DrivesService } from "./drives.service";
import { GeocodingService } from "./geocoding.service";

@Module({
  controllers: [DrivesController],
  providers: [DrivesService, GeocodingService],
})
export class DrivesModule {}
