import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { MockVerificationProvider, VERIFICATION_PROVIDER } from "./verification-provider";

@Module({
  controllers: [AdminController],
  providers: [AdminService, { provide: VERIFICATION_PROVIDER, useClass: MockVerificationProvider }],
})
export class AdminModule {}
