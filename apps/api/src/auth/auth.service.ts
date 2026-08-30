import { randomInt, randomUUID } from "node:crypto";
import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { prisma } from "@walkins/db";
import type { AccessTokenPayload } from "@walkins/shared";
import { redis } from "../common/redis";
import { RateLimiterService } from "./rate-limiter.service";

const OTP_TTL_SECONDS = 5 * 60;
const MAX_OTP_ATTEMPTS = 5;
const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 90) * 24 * 60 * 60;

function otpKey(phone: string) {
  return `otp:${phone}`;
}

function refreshTokenKey(token: string) {
  return `refresh:token:${token}`;
}

function refreshUserSetKey(userId: string) {
  return `refresh:user:${userId}`;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async requestOtp(phone: string, ip: string): Promise<{ devOtp?: string }> {
    const phoneAllowed = await this.rateLimiter.consume(`otp-request:phone:${phone}`, 3, 15 * 60);
    if (!phoneAllowed) {
      throw new HttpException("Too many OTP requests for this phone. Try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }

    const ipAllowed = await this.rateLimiter.consume(`otp-request:ip:${ip}`, 10, 60 * 60);
    if (!ipAllowed) {
      throw new HttpException("Too many OTP requests from this network. Try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }

    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");

    await redis
      .multi()
      .hset(otpKey(phone), { code: otp, attempts: 0 })
      .expire(otpKey(phone), OTP_TTL_SECONDS)
      .exec();

    const devExposeOtp = process.env.NODE_ENV === "development" && process.env.DEV_EXPOSE_OTP === "true";

    if (devExposeOtp) {
      console.log(
        [
          "",
          "==================== DEV OTP ====================",
          `  phone: ${phone}`,
          `  otp:   ${otp}`,
          "==================================================",
          "",
        ].join("\n"),
      );
      return { devOtp: otp };
    }

    return {};
  }

  async verifyOtp(phone: string, otp: string): Promise<{ accessToken: string; refreshToken: string }> {
    const stored = await redis.hgetall(otpKey(phone));

    if (!stored || !stored.code) {
      throw new BadRequestException("OTP expired or was never requested");
    }

    const attempts = Number(stored.attempts ?? 0);

    if (attempts >= MAX_OTP_ATTEMPTS) {
      await redis.del(otpKey(phone));
      throw new BadRequestException("Too many incorrect attempts. Request a new OTP.");
    }

    if (stored.code !== otp) {
      const nextAttempts = attempts + 1;
      if (nextAttempts >= MAX_OTP_ATTEMPTS) {
        await redis.del(otpKey(phone));
        throw new BadRequestException("Too many incorrect attempts. Request a new OTP.");
      }
      await redis.hincrby(otpKey(phone), "attempts", 1);
      throw new BadRequestException(`Incorrect OTP. ${MAX_OTP_ATTEMPTS - nextAttempts} attempts remaining.`);
    }

    // Correct code: burn it immediately so it can't be reused.
    await redis.del(otpKey(phone));

    const user =
      (await prisma.user.findUnique({ where: { phone } })) ??
      (await prisma.user.create({ data: { phone, name: phone, role: "CANDIDATE" } }));

    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id);

    return { accessToken, refreshToken };
  }

  async refresh(oldToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const rotated = await this.rotateRefreshToken(oldToken);

    const user = await prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user) {
      throw new UnauthorizedException("User no longer exists");
    }

    const accessToken = this.signAccessToken(user);
    return { accessToken, refreshToken: rotated.newToken };
  }

  async logout(token: string): Promise<void> {
    const record = await redis.get(refreshTokenKey(token));
    if (!record || record.startsWith("CONSUMED:")) {
      return;
    }
    const userId = record;
    await redis.multi().del(refreshTokenKey(token)).srem(refreshUserSetKey(userId), token).exec();
  }

  private signAccessToken(user: { id: string; role: string; companyId: string | null }): string {
    const payload: AccessTokenPayload = {
      userId: user.id,
      role: user.role as AccessTokenPayload["role"],
      companyId: user.companyId,
    };
    return this.jwtService.sign(payload, { expiresIn: process.env.JWT_ACCESS_TTL ?? "15m" });
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const token = randomUUID();
    await redis
      .multi()
      .set(refreshTokenKey(token), userId, "EX", REFRESH_TOKEN_TTL_SECONDS)
      .sadd(refreshUserSetKey(userId), token)
      .expire(refreshUserSetKey(userId), REFRESH_TOKEN_TTL_SECONDS)
      .exec();
    return token;
  }

  // Rotation with replay detection: a consumed token's key is tombstoned
  // (value prefixed "CONSUMED:") instead of deleted, so a second use of the
  // same token is distinguishable from a token that never existed. Replay
  // revokes every refresh token for that user, not just the replayed one.
  private async rotateRefreshToken(token: string): Promise<{ userId: string; newToken: string }> {
    const record = await redis.get(refreshTokenKey(token));

    if (!record) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    if (record.startsWith("CONSUMED:")) {
      const userId = record.slice("CONSUMED:".length);
      await this.revokeAllRefreshTokens(userId);
      throw new UnauthorizedException("Refresh token reuse detected; all sessions revoked");
    }

    const userId = record;
    const ttl = await redis.ttl(refreshTokenKey(token));

    await redis
      .multi()
      .set(refreshTokenKey(token), `CONSUMED:${userId}`, "EX", ttl > 0 ? ttl : REFRESH_TOKEN_TTL_SECONDS)
      .srem(refreshUserSetKey(userId), token)
      .exec();

    const newToken = await this.issueRefreshToken(userId);
    return { userId, newToken };
  }

  private async revokeAllRefreshTokens(userId: string): Promise<void> {
    const tokens = await redis.smembers(refreshUserSetKey(userId));
    if (tokens.length === 0) {
      return;
    }
    const pipeline = redis.multi();
    for (const token of tokens) {
      pipeline.del(refreshTokenKey(token));
    }
    pipeline.del(refreshUserSetKey(userId));
    await pipeline.exec();
  }
}
