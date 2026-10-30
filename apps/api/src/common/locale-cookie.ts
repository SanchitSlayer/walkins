import { LOCALE_COOKIE, type Locale } from "@walkins/shared";
import type { Response } from "express";

const LOCALE_COOKIE_TTL_MS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 90) * 24 * 60 * 60 * 1000;

// The web middleware's copy of users.locale. Only the API writes it, and
// only with the value it has just read or saved, so the database decides
// and a stale cookie from another device is overwritten at the next session.
// Lax, unlike the refresh cookie: a Telegram link is a navigation from
// another site, and the middleware needs the cookie on it to open the
// reader's language.
export function setLocaleCookie(response: Response, locale: Locale) {
  response.cookie(LOCALE_COOKIE, locale, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: LOCALE_COOKIE_TTL_MS,
    path: "/",
  });
}

export function clearLocaleCookie(response: Response) {
  response.clearCookie(LOCALE_COOKIE, { path: "/" });
}
