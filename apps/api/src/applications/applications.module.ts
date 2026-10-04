import { Module } from "@nestjs/common";
import { LiveModule } from "../live/live.module";
import { ApplicationsController } from "./applications.controller";
import { ApplicantsService } from "./applicants.service";
import { ApplicationsService } from "./applications.service";

@Module({
  imports: [LiveModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, ApplicantsService],
})
export class ApplicationsModule {}
