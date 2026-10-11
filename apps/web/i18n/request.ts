import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, MESSAGES } from "@walkins/shared";

// One locale this phase, fixed rather than negotiated from Accept-Language:
// a crawler and a phone must get the same page at the same URL. Hindi will
// arrive under its own path prefix with hreflang alternates, and this is the
// one place that then reads the locale from the route.
export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  messages: MESSAGES[DEFAULT_LOCALE],
  timeZone: "Asia/Kolkata",
}));
