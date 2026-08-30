import { Injectable } from "@nestjs/common";
import { redis } from "../common/redis";

// Sliding-window log via a Redis sorted set: each call's timestamp is scored
// and stored, entries older than the window are trimmed, and the remaining
// count decides the verdict. Unlike INCR+EXPIRE (fixed window), this doesn't
// let a burst at a window boundary double the effective limit.
@Injectable()
export class RateLimiterService {
  async consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const redisKey = `ratelimit:${key}`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    await redis.zremrangebyscore(redisKey, 0, windowStart);
    const count = await redis.zcard(redisKey);

    if (count >= limit) {
      return false;
    }

    await redis
      .multi()
      .zadd(redisKey, now, `${now}:${Math.random()}`)
      .expire(redisKey, windowSeconds)
      .exec();

    return true;
  }
}
