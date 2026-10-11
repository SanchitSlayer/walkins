import { IntlMessageFormat } from "intl-messageformat";
import en from "./messages/en.json";

// One catalog for every user-facing string: the web app reads it through
// next-intl, and the API (error messages) and worker (alerts) through
// translate() below. intl-messageformat here rather than next-intl's own
// use-intl because the API and worker are CommonJS on Node 20, where use-intl
// 4 (ESM-only) can't be required; both read the same ICU message syntax.
export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export type Messages = typeof en;
export const MESSAGES: Record<Locale, Messages> = { en };

// The tag Intl formats with. "en" is Indian English: lakh grouping, ₹.
export const INTL_LOCALE: Record<Locale, string> = { en: "en-IN" };

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;
export type MessageValues = Record<string, string | number | Date>;

function lookup(messages: Messages, key: string): string | undefined {
  const found = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
  return typeof found === "string" ? found : undefined;
}

export function isMessageKey(key: string): key is MessageKey {
  return lookup(MESSAGES[DEFAULT_LOCALE], key) !== undefined;
}

const compiled = new Map<string, IntlMessageFormat>();

export function translate(locale: Locale, key: MessageKey, values?: MessageValues): string {
  const cacheKey = `${locale}:${key}`;
  let format = compiled.get(cacheKey);
  if (!format) {
    const message = lookup(MESSAGES[locale], key) ?? lookup(MESSAGES[DEFAULT_LOCALE], key);
    if (message === undefined) throw new Error(`No message for ${key}`);
    format = new IntlMessageFormat(message, INTL_LOCALE[locale]);
    compiled.set(cacheKey, format);
  }
  return String(format.format(values));
}
