import { type NextRequest, NextResponse } from "next/server";
import { DEFAULT_LOCALE, isLocale, isLocalizedPath, LOCALE_COOKIE, LOCALE_HEADER, localePath, splitLocalePath } from "@walkins/shared";

// Which language a page is in comes from its address alone: /hi/jobs is
// Hindi, /jobs is English, for a crawler and a phone alike. Two rules sit on
// top (docs/TECHNICAL.md, "Languages"):
// - A page that exists only in English redirects from its /hi address.
// - A reader whose saved language is Hindi (the locale cookie, the API's
//   copy of users.locale) is sent from an English address to the Hindi one.
//   Never the other way: a /hi link someone shared opens in Hindi whatever
//   the reader saved, or forwarding a link would change what it says.
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  const { locale, path } = splitLocalePath(request.nextUrl.pathname);

  if (locale !== DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    if (!isLocalizedPath(path)) return NextResponse.redirect(url);
    headers.set(LOCALE_HEADER, locale);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(saved) && saved !== DEFAULT_LOCALE && isLocalizedPath(path)) {
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
