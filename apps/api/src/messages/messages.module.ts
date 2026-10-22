import { Module } from "@nestjs/common";
import { AdminThreadsController, CandidateMessagesController, CompanyMessagesController, MessageReportsController } from "./messages.controller";
import { MessagesService } from "./messages.service";

// Threads between a company and one candidate, per application.
@Module({
  controllers: [CompanyMessagesController, CandidateMessagesController, MessageReportsController, AdminThreadsController],
  providers: [MessagesService],
})
export class MessagesModule {}
