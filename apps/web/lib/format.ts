import { useLocale } from "next-intl";
import { type Format, formatFor } from "@walkins/shared";

// Dates, money and distances in the page's locale, from the same formatter
// the API and worker use. Works in server and client components alike; an
// async server component calls formatFor(await getLocale()) instead. Never
// import formatTime and friends from @walkins/shared directly in the web
// app; test/i18n.test.ts enforces it.
export function useFormat(): Format {
  return formatFor(useLocale());
}
