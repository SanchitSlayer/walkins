import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { JobsService } from "./jobs.service";
import { RateLimitInterceptor } from "./rate-limit";
import { RateLimiterService } from "./rate-limiter.service";
import { StorageService } from "./storage.service";

// Object storage, the job queues and rate limiting, used by several domains.
// The interceptor limits every HTTP route, with the default where a route
// names no limit of its own.
@Global()
@Module({
  providers: [StorageService, JobsService, RateLimiterService, { provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor }],
  exports: [StorageService, JobsService, RateLimiterService],
})
export class InfrastructureModule {}
