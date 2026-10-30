import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { prisma } from "@walkins/db";
import { LOCALE_COOKIE } from "@walkins/shared";
import type { Request, Response } from "express";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { CandidatesController } from "../src/candidates/candidates.controller";
import { CandidatesService } from "../src/candidates/candidates.service";
import type { JobsService } from "../src/common/jobs.service";
import { RateLimiterService } from "../src/common/rate-limiter.service";
import { redis } from "../src/common/redis";
import type { VoiceIntroService } from "../src/candidates/voice-intro.service";

const auth = new AuthController(new AuthService(new JwtService({ secret: "locale-test" }), new RateLimiterService()));
const candidates = new CandidatesController(new CandidatesService({} as JobsService), {} as VoiceIntroService);

const phone = `97${String(Date.now()).slice(-8)}`;
let userId = "";

// Records the cookies a response sets, as the browser would keep them.
function browser() {
  const jar: Record<string, string> = {};
  const response = {
    cookie: vi.fn((name: string, value: string) => {
      jar[name] = value;
    }),
    clearCookie: vi.fn((name: string) => {
      delete jar[name];
    }),
  } as unknown as Response;
  return { jar, response, request: () => ({ cookies: { ...jar } }) as unknown as Request };
}

async function signIn() {
  const device = browser();
  await redis.hset(`otp:${phone}`, { code: "123456", attempts: 0 });
  const body = await auth.verifyOtp({ phone, otp: "123456" }, device.response);
  userId = (await prisma.user.findUniqueOrThrow({ where: { phone } })).id;
  return { device, body };
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { phone } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { phone } });
  redis.disconnect();
});

describe("the reader's language", () => {
  it("starts in English, and signing in tells the browser and the app so", async () => {
    const { device, body } = await signIn();
    expect(body.locale).toBe("en");
    expect(device.jar[LOCALE_COOKIE]).toBe("en");
  });

  it("is saved on the person, before any profile exists, and copied to the cookie from what was saved", async () => {
    const { device } = await signIn();
    expect(await prisma.candidate.findUnique({ where: { userId } })).toBeNull();

    await expect(candidates.setLocale({ userId, role: "CANDIDATE", companyId: null }, { locale: "hi" }, device.response)).resolves.toEqual({ locale: "hi" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).locale).toBe("hi");
    expect(device.jar[LOCALE_COOKIE]).toBe("hi");
  });

  it("follows the database, not the last cookie written, when another device changed it", async () => {
    const { device: phoneA } = await signIn();
    const { device: phoneB } = await signIn();
    await candidates.setLocale({ userId, role: "CANDIDATE", companyId: null }, { locale: "en" }, phoneB.response);
    expect(phoneA.jar[LOCALE_COOKIE]).toBe("hi");

    // Phone A's next session start reads users.locale and overwrites its copy.
    const body = await auth.refresh(phoneA.request(), phoneA.response);
    expect(body.locale).toBe("en");
    expect(phoneA.jar[LOCALE_COOKIE]).toBe("en");
  });

  it("is forgotten by the browser on signing out", async () => {
    const { device } = await signIn();
    await auth.logout(device.request(), device.response);
    expect(device.jar[LOCALE_COOKIE]).toBeUndefined();
  });
});
