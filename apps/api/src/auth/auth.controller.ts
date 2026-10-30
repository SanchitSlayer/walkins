import { Body, Controller, HttpCode, Patch, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { type AccessTokenPayload, otpRequestSchema, type OtpVerifyInput, otpVerifySchema, type SetLocale, setLocaleSchema } from "@walkins/shared";
import type { Request, Response } from "express";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { LIMITS, RateLimit } from "../common/rate-limit";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { apiError } from "../common/api-error";
import { clearLocaleCookie, setLocaleCookie } from "../common/locale-cookie";

const REFRESH_COOKIE = "refresh_token";
const REFRESH_TOKEN_TTL_MS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 90) * 24 * 60 * 60 * 1000;

function setRefreshCookie(response: Response, token: string) {
  response.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: REFRESH_TOKEN_TTL_MS,
    path: "/",
  });
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("otp/request")
  @HttpCode(200)
  requestOtp(@Body(new ZodValidationPipe(otpRequestSchema)) body: { phone: string }, @Req() request: Request) {
    return this.authService.requestOtp(body.phone, request.ip ?? "unknown");
  }

  @Post("otp/verify")
  @HttpCode(200)
  async verifyOtp(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerifyInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { accessToken, refreshToken, locale } = await this.authService.verifyOtp(body.phone, body.otp, body.locale);
    setRefreshCookie(response, refreshToken);
    setLocaleCookie(response, locale);
    return { accessToken, locale };
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[REFRESH_COOKIE];
    if (!token) {
      response.clearCookie(REFRESH_COOKIE, { path: "/" });
      clearLocaleCookie(response);
      throw new UnauthorizedException(apiError("errors.auth.signedOut"));
    }
    const { accessToken, refreshToken, locale } = await this.authService.refresh(token);
    setRefreshCookie(response, refreshToken);
    setLocaleCookie(response, locale);
    return { accessToken, locale };
  }

  @Patch("locale")
  @UseGuards(JwtAuthGuard)
  @RateLimit(LIMITS.profileEdit)
  async setLocale(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(setLocaleSchema)) body: SetLocale,
    @Res({ passthrough: true }) response: Response,
  ) {
    const saved = await this.authService.setLocale(user.userId, body.locale);
    setLocaleCookie(response, saved.locale);
    return saved;
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[REFRESH_COOKIE];
    if (token) {
      await this.authService.logout(token);
    }
    response.clearCookie(REFRESH_COOKIE, { path: "/" });
    clearLocaleCookie(response);
    return { success: true };
  }
}
