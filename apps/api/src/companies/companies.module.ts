import { Module } from "@nestjs/common";
import { LiveModule } from "../live/live.module";
import { CompaniesController, InvitationsController } from "./companies.controller";
import { CompaniesService } from "./companies.service";
import { PeopleService } from "./people.service";

@Module({
  imports: [LiveModule],
  controllers: [CompaniesController, InvitationsController],
  providers: [CompaniesService, PeopleService],
})
export class CompaniesModule {}
