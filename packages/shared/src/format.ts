import { DEFAULT_LOCALE, INTL_LOCALE, type Locale, translate } from "./i18n";

// Every drive happens in India, so dates are formatted in India time on both
// the server render and in the browser. Formatting in each runtime's own
// zone would render different text on each side and break hydration.
const TIME_ZONE = "Asia/Kolkata";

// A sortable YYYY-MM-DD in India time, for comparing days; never shown.
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dayKey(date: Date): string {
  return dayKeyFormat.format(date);
}

export type Format = {
  formatTime(iso: string): string;
  dayLabel(date: Date, now: Date): string;
  // Always the date itself, never "Today": for text that outlives the
  // moment it was made, like a page's description in search results.
  formatDate(date: Date): string;
  formatWhen(startsAt: string, endsAt: string, now: Date): { day: string; time: string };
  formatSalary(min: number, max: number): string;
  formatPaise(paise: number): string;
  formatExperience(min: number, max: number): string;
  formatDistance(km: number): string;
  formatSeats(capacity: number, booked: number): string;
  formatNumber(n: number): string;
  languageName(code: string): string;
  scriptName(code: string): string;
};

// Numbers, dates and currency come from Intl for the locale; the few words
// around them come from the message catalog, so a new locale changes both
// through the same files the rest of the interface uses.
function createFormat(locale: Locale): Format {
  const tag = INTL_LOCALE[locale];
  // Hindi's short forms (शुक्र, अक्तू॰) are abbreviations nobody writes, and
  // its units (कि॰मी॰) aren't what a jobseeker reads on a sign; the glossary
  // in docs/TECHNICAL.md has both rules.
  const short = locale === "hi" ? "long" : "short";
  const unitTag = locale === "hi" ? INTL_LOCALE.en : tag;
  const dayParts = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, weekday: short, day: "numeric", month: short });
  const time = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const rupees = new Intl.NumberFormat(tag, { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(tag).formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".";
  const number = new Intl.NumberFormat(tag);
  const km = new Intl.NumberFormat(unitTag, { style: "unit", unit: "kilometer", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const languages = new Intl.DisplayNames([tag], { type: "language" });
  const scripts = new Intl.DisplayNames([tag], { type: "script" });
  const metres = new Intl.NumberFormat(unitTag, { style: "unit", unit: "meter", maximumFractionDigits: 0 });

  const formatTime = (iso: string) => time.format(new Date(iso));

  const formatDate = (date: Date) => {
    const parts = Object.fromEntries(dayParts.formatToParts(date).map((p) => [p.type, p.value]));
    return translate(locale, "format.dayDate", { weekday: parts.weekday, day: parts.day, month: parts.month });
  };

  const dayLabel = (date: Date, now: Date) => {
    if (dayKey(date) === dayKey(now)) return translate(locale, "format.today");
    if (dayKey(date) === dayKey(new Date(now.getTime() + 86_400_000))) return translate(locale, "format.tomorrow");
    return formatDate(date);
  };

  return {
    formatTime,
    dayLabel,
    formatDate,
    formatWhen: (startsAt, endsAt, now) => ({
      day: dayLabel(new Date(startsAt), now),
      time: translate(locale, "format.range", { from: formatTime(startsAt), to: formatTime(endsAt) }),
    }),
    formatSalary: (min, max) =>
      min === max ? rupees.format(min) : translate(locale, "format.range", { from: rupees.format(min), to: rupees.format(max) }),
    // Paise are whole numbers end to end; this is the only place they become
    // rupees, and only as text, without ever dividing into a float.
    formatPaise: (paise) => {
      const sign = paise < 0 ? "−" : "";
      const abs = Math.abs(paise);
      const fraction = abs % 100;
      return `${sign}${rupees.format(Math.trunc(abs / 100))}${fraction ? `${decimal}${String(fraction).padStart(2, "0")}` : ""}`;
    },
    formatExperience: (min, max) => {
      if (max === 0) return translate(locale, "format.noExperience");
      return min === max ? translate(locale, "format.years", { count: max }) : translate(locale, "format.yearsRange", { min, max });
    },
    formatDistance: (distanceKm) => (distanceKm < 1 ? metres.format(Math.round(distanceKm * 100) * 10) : km.format(distanceKm)),
    formatSeats: (capacity, booked) => {
      const left = Math.max(0, capacity - booked);
      return left === 0 ? translate(locale, "format.seatsAllTaken", { capacity }) : translate(locale, "format.seatsLeft", { left, capacity });
    },
    formatNumber: (n) => number.format(n),
    languageName: (code) => languages.of(code) ?? code,
    scriptName: (code) => scripts.of(code) ?? code,
  };
}

const formats = new Map<Locale, Format>();

export function formatFor(locale: Locale): Format {
  let format = formats.get(locale);
  if (!format) {
    format = createFormat(locale);
    formats.set(locale, format);
  }
  return format;
}

// For text whose reader's language isn't known: the API's default wording
// and its logs. The worker formats with formatFor(the candidate's locale).
// The web app never imports these: it formats through useFormat(), which
// follows the page's locale (test/i18n.test.ts checks).
export const { formatTime, dayLabel, formatDate, formatWhen, formatSalary, formatPaise, formatExperience, formatDistance, formatSeats } =
  formatFor(DEFAULT_LOCALE);
