import { randomUUID } from "node:crypto";
import { type ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { of } from "rxjs";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_RULE, RateLimit, RateLimitInterceptor, type RateLimitRule } from "../src/common/rate-limit";
import { RateLimiterService } from "../src/common/rate-limiter.service";
import { redis } from "../src/common/redis";

const run = randomUUID().slice(0, 8);
const limiter = new RateLimiterService();
const interceptor = new RateLimitInterceptor(new Reflector(), limiter);

function rule(scope: RateLimitRule["scope"], limit: number): RateLimitRule {
  return { name: `test-${run}-${scope}-${randomUUID().slice(0, 4)}`, scope, limit, windowSeconds: 60, what: "test requests" };
}

// A route handler carrying the rules, and a request as Express would hand it
// over after the auth guard ran.
function call(rules: RateLimitRule[] | null, request: { ip: string; user?: { userId: string; companyId: string | null }; params?: Record<string, string> }) {
  const handler = () => undefined;
  if (rules) RateLimit(...rules)(handler);
  const headers: Record<string, string> = {};
  const context = {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ params: {}, ...request }),
      getResponse: () => ({ setHeader: (name: string, value: string) => (headers[name] = value) }),
    }),
  } as unknown as ExecutionContext;
  return { result: interceptor.intercept(context, { handle: () => of("handled") }), headers };
}

async function outcome(c: ReturnType<typeof call>) {
  try {
    await c.result;
    return "allowed";
  } catch (err) {
    return err instanceof HttpException ? err.getStatus() : err;
  }
}

afterAll(async () => {
  const keys = await redis.keys(`ratelimit:test-${run}-*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

describe("the limiter", () => {
  it("lets exactly the limit through when a burst arrives at once", async () => {
    const verdicts = await Promise.all(Array.from({ length: 50 }, () => limiter.consume(`test-${run}-burst`, 10, 60)));
    expect(verdicts.filter((v) => v.allowed)).toHaveLength(10);
  });

  it("says how long until the oldest request leaves the window", async () => {
    await limiter.consume(`test-${run}-wait`, 1, 120);
    const refused = await limiter.consume(`test-${run}-wait`, 1, 120);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(110);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(120);
  });
});

describe("rate limits on routes", () => {
  it("refuses with 429, a Retry-After header and a plain-language message", async () => {
    const limit = rule("user", 1);
    const user = { userId: `u-${run}`, companyId: null };
    expect(await outcome(call([limit], { ip: "10.0.0.1", user }))).toBe("allowed");
    const refused = call([limit], { ip: "10.0.0.1", user });
    const err = await refused.result.catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    // A rule without wording of its own gets the default.
    expect(err.getResponse()).toMatchObject({
      code: "errors.rateLimited.default",
      message: "That's a lot of requests in a short time. Try again in a minute.",
      params: { minutes: 1 },
    });
    expect(Number(refused.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("counts each user separately, even behind one address", async () => {
    const limit = rule("user", 1);
    const ip = "100.64.0.1";
    expect(await outcome(call([limit], { ip, user: { userId: `a-${run}`, companyId: null } }))).toBe("allowed");
    expect(await outcome(call([limit], { ip, user: { userId: `b-${run}`, companyId: null } }))).toBe("allowed");
    expect(await outcome(call([limit], { ip, user: { userId: `a-${run}`, companyId: null } }))).toBe(429);
  });

  it("counts a whole company together for company limits", async () => {
    const limit = rule("company", 1);
    expect(await outcome(call([limit], { ip: "10.0.0.2", user: { userId: `x-${run}`, companyId: `c-${run}` } }))).toBe("allowed");
    expect(await outcome(call([limit], { ip: "10.0.0.3", user: { userId: `y-${run}`, companyId: `c-${run}` } }))).toBe(429);
  });

  it("falls back to the address for someone not logged in", async () => {
    const limit = rule("user", 1);
    expect(await outcome(call([limit], { ip: "10.0.0.4" }))).toBe("allowed");
    expect(await outcome(call([limit], { ip: "10.0.0.4" }))).toBe(429);
    expect(await outcome(call([limit], { ip: "10.0.0.5" }))).toBe("allowed");
  });

  it("needs every rule on a route to pass", async () => {
    const generous = rule("user", 100);
    const strict = rule("company", 1);
    const user = { userId: `z-${run}`, companyId: `d-${run}` };
    expect(await outcome(call([generous, strict], { ip: "10.0.0.6", user }))).toBe("allowed");
    expect(await outcome(call([generous, strict], { ip: "10.0.0.6", user }))).toBe(429);
  });

  it("applies the default to a route that names no limit", async () => {
    expect(DEFAULT_RULE).toMatchObject({ limit: 600, windowSeconds: 60 });
    const key = `ratelimit:default:user:default-${run}`;
    await call(null, { ip: "10.0.0.7", user: { userId: `default-${run}`, companyId: null } }).result;
    expect(await redis.zcard(key)).toBe(1);
    await redis.del(key);
  });
});
