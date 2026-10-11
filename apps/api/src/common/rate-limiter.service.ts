import { Injectable } from "@nestjs/common";
import { redis } from "./redis";

export type RateVerdict = { allowed: boolean; retryAfterSeconds: number };

// Sliding-window log via a Redis sorted set: each call's timestamp is scored
// and stored, entries older than the window are trimmed, and the remaining
// count decides the verdict. Unlike INCR+EXPIRE (fixed window), this doesn't
// let a burst at a window boundary double the effective limit.
//
// Trim, count and add run as one Lua script. As separate round trips, every
// request in a parallel burst could count before any of them added, and all
// would pass.
const SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
if redis.call('ZCARD', key) >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2]) + window - now}
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

@Injectable()
export class RateLimiterService {
  async consume(key: string, limit: number, windowSeconds: number): Promise<RateVerdict> {
    const now = Date.now();
    const [allowed, retryAfterMs] = (await redis.eval(
      SLIDING_WINDOW,
      1,
      `ratelimit:${key}`,
      now,
      windowSeconds * 1000,
      limit,
      `${now}:${Math.random()}`,
    )) as [number, number];
    return { allowed: allowed === 1, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  // For limits on failures only: check before the attempt without counting
  // it, then consume() just when it fails, so successes never use up the
  // allowance.
  async isExhausted(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const redisKey = `ratelimit:${key}`;
    await redis.zremrangebyscore(redisKey, 0, Date.now() - windowSeconds * 1000);
    return (await redis.zcard(redisKey)) >= limit;
  }
}
