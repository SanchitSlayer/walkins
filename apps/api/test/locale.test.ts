import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { prisma } from "@walkins/db";
import { LOCALE_COOKIE, OFFERED_LOCALES, servedLocale, setLocaleSchema } from "@walkins/shared";
import type { Request, Response } from "express";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { RateLimiterService } from "../src/common/rate-limiter.service";
import { redis } from "../src/common/redis";
import { RolesGuard } from "../src/common/roles.guard";

const auth = new AuthController(new AuthService(new JwtService({ secret: "locale-test" }), new RateLimiterService()));

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

    await expect(auth.setLocale({ userId, role: "CANDIDATE", companyId: null }, { locale: "hi" }, device.response)).resolves.toEqual({ locale: "hi" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).locale).toBe("hi");
    expect(device.jar[LOCALE_COOKIE]).toBe("hi");
  });

  it("follows the database, not the last cookie written, when another device changed it", async () => {
    const { device: phoneA } = await signIn();
    const { device: phoneB } = await signIn();
    await auth.setLocale({ userId, role: "CANDIDATE", companyId: null }, { locale: "en" }, phoneB.response);
    expect(phoneA.jar[LOCALE_COOKIE]).toBe(servedLocale("hi"));

    // Phone A's next session start reads users.locale and overwrites its copy.
    const body = await auth.refresh(phoneA.request(), phoneA.response);
    expect(body.locale).toBe("en");
    expect(phoneA.jar[LOCALE_COOKIE]).toBe("en");
  });

  // The gate is read once, at start, so a run sees one state of it: run with
  // WALKINS_OFFER_HINDI=1 as well to see the other.
  it("can be set only to a language that is offered", () => {
    expect(setLocaleSchema.safeParse({ locale: "en" }).success).toBe(true);
    expect(setLocaleSchema.safeParse({ locale: "hi" }).success).toBe(OFFERED_LOCALES.includes("hi"));
  });

  it("serves a Hindi choice saved before Hindi was offered in English, until it is", async () => {
    await signIn();
    await prisma.user.update({ where: { id: userId }, data: { locale: "hi" } });
    const { device, body } = await signIn();
    expect(body.locale).toBe(servedLocale("hi"));
    expect(device.jar[LOCALE_COOKIE]).toBe(servedLocale("hi"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).locale).toBe("hi");
  });

  // The cookie is set for every role, so saving must be open to every role:
  // an employer who saved Hindi was otherwise sent back to it by each refresh.
  it("can be changed back by an employer, and their next session follows it", async () => {
    const { device } = await signIn();
    await prisma.user.update({ where: { id: userId }, data: { role: "EMPLOYER", locale: "hi" } });
    const employer = { userId, role: "EMPLOYER" as const, companyId: null };
    const route = {
      getHandler: () => AuthController.prototype.setLocale,
      getClass: () => AuthController,
      switchToHttp: () => ({ getRequest: () => ({ user: employer }) }),
    } as unknown as ExecutionContext;
    expect(new RolesGuard(new Reflector()).canActivate(route)).toBe(true);

    await auth.setLocale(employer, { locale: "en" }, device.response);
    const body = await auth.refresh(device.request(), device.response);
    expect(body.locale).toBe("en");
    expect(device.jar[LOCALE_COOKIE]).toBe("en");
    await prisma.user.update({ where: { id: userId }, data: { role: "CANDIDATE" } });
  });

  it("is forgotten by the browser on signing out", async () => {
    const { device } = await signIn();
    await auth.logout(device.request(), device.response);
    expect(device.jar[LOCALE_COOKIE]).toBeUndefined();
  });
});

describe("the language of the sign-in page", () => {
  const newPhones = [0, 1, 2, 3].map((i) => `96${String(Date.now()).slice(-7)}${i}`);

  async function signInFrom(number: string, locale?: "en" | "hi") {
    const device = browser();
    await redis.hset(`otp:${number}`, { code: "123456", attempts: 0 });
    const body = await auth.verifyOtp({ phone: number, otp: "123456", locale }, device.response);
    const saved = (await prisma.user.findUniqueOrThrow({ where: { phone: number } })).locale;
    return { body, cookie: device.jar[LOCALE_COOKIE], saved };
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { phone: { in: newPhones } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { phone: { in: newPhones } } });
  });

  it("is saved on an account that signing in from /hi/login creates", async () => {
    const { body, cookie, saved } = await signInFrom(newPhones[1], "hi");
    expect(saved).toBe(servedLocale("hi"));
    expect(body.locale).toBe(servedLocale("hi"));
    expect(cookie).toBe(servedLocale("hi"));
  });

  it("leaves a new account in English from an English page, or when no page language is sent", async () => {
    expect((await signInFrom(newPhones[0], "en")).saved).toBe("en");
    expect((await signInFrom(newPhones[2])).saved).toBe("en");
  });

  it("never changes an existing account's saved language, in either direction", async () => {
    await signInFrom(newPhones[3], "en");
    expect((await signInFrom(newPhones[3], "hi")).saved).toBe("en");

    await prisma.user.update({ where: { phone: newPhones[3] }, data: { locale: "hi" } });
    const fromEnglishLink = await signInFrom(newPhones[3], "en");
    expect(fromEnglishLink.saved).toBe("hi");
    expect(fromEnglishLink.body.locale).toBe(servedLocale("hi"));
  });
});
