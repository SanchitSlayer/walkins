import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, LOCALE_HEADER, MESSAGES } from "@walkins/shared";

// The locale comes from the address, which middleware.ts turns into a
// header: never from Accept-Language or a cookie, so a crawler and a phone
// get the same page at the same URL.
export default getRequestConfig(async () => {
  const requested = (await headers()).get(LOCALE_HEADER);
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;
  return { locale, messages: MESSAGES[locale], timeZone: "Asia/Kolkata" };
});
