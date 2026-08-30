import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RateLimiterService } from "./rate-limiter.service";

@Module({
  imports: [
    // global: true makes JwtService injectable anywhere (e.g. JwtAuthGuard
    // in other modules) without each of them re-importing JwtModule.
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: process.env.JWT_ACCESS_TTL ?? "15m" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RateLimiterService],
})
export class AuthModule {}
