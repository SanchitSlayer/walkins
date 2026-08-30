import { Body, Controller, HttpCode, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { otpRequestSchema, otpVerifySchema } from "@walkins/shared";
import type { Request, Response } from "express";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";

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
    @Body(new ZodValidationPipe(otpVerifySchema)) body: { phone: string; otp: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.verifyOtp(body.phone, body.otp);
    setRefreshCookie(response, refreshToken);
    return { accessToken };
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[REFRESH_COOKIE];
    if (!token) {
      response.clearCookie(REFRESH_COOKIE, { path: "/" });
      throw new UnauthorizedException("Missing refresh token");
    }
    const { accessToken, refreshToken } = await this.authService.refresh(token);
    setRefreshCookie(response, refreshToken);
    return { accessToken };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[REFRESH_COOKIE];
    if (token) {
      await this.authService.logout(token);
    }
    response.clearCookie(REFRESH_COOKIE, { path: "/" });
    return { success: true };
  }
}
