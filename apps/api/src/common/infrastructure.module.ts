import { Global, Module } from "@nestjs/common";
import { JobsService } from "./jobs.service";
import { StorageService } from "./storage.service";

// Object storage and the job queues, used by several domains.
@Global()
@Module({
  providers: [StorageService, JobsService],
  exports: [StorageService, JobsService],
})
export class InfrastructureModule {}
