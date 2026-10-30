import { type NextRequest, NextResponse } from "next/server";
import { DEFAULT_LOCALE, isLocale, isLocalizedPath, type Locale, LOCALE_COOKIE, LOCALE_HEADER, localePath, OFFERED_LOCALES, splitLocalePath } from "@walkins/shared";

// Which language a page is in comes from its address alone: /hi/jobs is
// Hindi, /jobs is English, for a crawler and a phone alike. Two rules sit on
// top (docs/TECHNICAL.md, "Languages"):
// - A page that exists only in English redirects from its /hi address.
// - A reader whose saved language is Hindi (the locale cookie, the API's
//   copy of users.locale) is sent from an English address to the Hindi one.
//   Never the other way: a /hi link someone shared opens in Hindi whatever
//   the reader saved, or forwarding a link would change what it says.
// Both apply only to a language that is offered. Until then a /hi address
// redirects to its English one, and a saved Hindi choice is ignored, so
// nobody reaches a half-translated page by typing or keeping an address.
export function middleware(request: NextRequest) {
  return routeLocale(request, OFFERED_LOCALES);
}

export function routeLocale(request: NextRequest, offered: readonly Locale[]) {
  const headers = new Headers(request.headers);
  const { locale, path } = splitLocalePath(request.nextUrl.pathname);

  if (locale !== DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    if (!isLocalizedPath(path) || !offered.includes(locale)) return NextResponse.redirect(url);
    headers.set(LOCALE_HEADER, locale);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(saved) && saved !== DEFAULT_LOCALE && offered.includes(saved) && isLocalizedPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = localePath(path, saved);
    return NextResponse.redirect(url);
  }

  headers.set(LOCALE_HEADER, DEFAULT_LOCALE);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not the API proxy, sockets, uploads, build files, fonts, or
  // the service worker and other files served as they are.
  matcher: ["/((?!api/|socket\\.io/|storage/|_next/|maplibre/|fonts/|sw\\.js|manifest\\.webmanifest|icon\\.svg).*)"],
};
