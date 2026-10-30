import { IntlMessageFormat } from "intl-messageformat";
import en from "./messages/en.json";
import hi from "./messages/hi.json";

// One catalog for every user-facing string: the web app reads it through
// next-intl, and the API (error messages) and worker (alerts) through
// translate() below. intl-messageformat here rather than next-intl's own
// use-intl because the API and worker are CommonJS on Node 20, where use-intl
// 4 (ESM-only) can't be required; both read the same ICU message syntax.
export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

export type Messages = typeof en;

type Catalog = { [key: string]: string | Catalog };

function withFallback(base: Catalog, over: Catalog): Catalog {
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => {
      const own = over[key];
      if (typeof value === "string") return [key, typeof own === "string" ? own : value];
      return [key, withFallback(value, typeof own === "object" ? own : {})];
    }),
  );
}

// What each locale's translators wrote, before any English fills the gaps.
export const CATALOGS: Record<Locale, Catalog> = { en, hi };

// Hindi covers only what a Hindi reader meets (HINDI_SCOPE). Every other
// key reads in English, so the employer console stays whole.
export const MESSAGES: Record<Locale, Messages> = { en, hi: withFallback(en, hi) as Messages };

// The tag Intl formats with. "en" is Indian English: lakh grouping, ₹.
export const INTL_LOCALE: Record<Locale, string> = { en: "en-IN", hi: "hi-IN" };

// The candidate-facing, public and venue wording: what Hindi must cover
// before anyone is offered it. An entry ending in "." is a whole namespace;
// any other is one key, exactly, so "fields.started" can't take in the
// employer's "fields.startedOn". The employer console, admin, and
// the venue-pinning tools stay English. Where a namespace mixes the two
// (errors, field names, the board's drive states), the candidate's keys are
// listed one by one, so an employer's refusal doesn't hold Hindi back. The
// field names are those of the schemas candidate and public endpoints check.
export const HINDI_SCOPE = [
  "home.",
  "nav.",
  "meta.",
  "jobs.",
  "drive.",
  "booking.",
  "myDrives.",
  "checkin.",
  "checkInScreen.drive",
  "checkInScreen.heading",
  "checkInScreen.qrAlt",
  "checkInScreen.typeAt",
  "checkInScreen.codeSpoken",
  "checkInScreen.codeFailed",
  "checkInScreen.gettingCode",
  "checkInScreen.nextCode",
  "checkInScreen.stale",
  "checkInScreen.candidatesHeading",
  "checkInScreen.candidatesBody",
  "profile.",
  "voice.",
  "telegram.",
  "neverPay.",
  "warning.heading",
  "warning.candidate",
  "warning.note",
  "warning.acknowledge",
  "report.reason.",
  "report.drive.",
  "yourRecord.",
  "language.",
  "alerts.",
  "bot.",
  "login.",
  "board.state.live",
  "board.state.filling",
  "board.state.closing",
  "board.state.expired",
  "board.state.cancelled",
  "board.state.suspended",
  "board.slots.",
  "board.countdown.",
  "liveBoard.",
  "map.",
  "transcript.",
  "thread.you",
  "thread.fromCompany",
  "thread.emptyCandidate",
  "thread.flaggedCandidate",
  "thread.write",
  "thread.count",
  "thread.send",
  "thread.sending",
  "thread.sendFailed",
  "thread.loadFailed",
  "thread.backToDrives",
  "thread.withCompany",
  "thread.about",
  "thread.closesOn",
  "thread.report.",
  "format.",
  "fields.default",
  "fields.phone",
  "fields.otp",
  "fields.code",
  "fields.reason",
  "fields.details",
  "fields.body",
  "fields.seq",
  "fields.cityId",
  "fields.homeLat",
  "fields.homeLng",
  "fields.maxTravelKm",
  "fields.experienceYears",
  "fields.roleIds",
  "fields.started",
  "fields.slotId",
  "fields.answers",
  "errors.generic",
  "errors.network",
  "errors.rateLimited.",
  "errors.auth.",
  "errors.profile.",
  "errors.voice.",
  "errors.checkIn.",
  "errors.drive.notFound",
  "errors.drive.searchNeedsPlace",
  "errors.application.notFound",
  "errors.application.driveEnded",
  "errors.application.slotNotInDrive",
  "errors.application.slotStarted",
  "errors.application.alreadyBooked",
  "errors.application.screenedOut",
  "errors.application.alreadyApplied",
  "errors.application.slotFull",
  "errors.application.suspended",
  "errors.knockout.",
  "errors.validation.",
  "errors.messages.notFound",
  "errors.messages.reportOwnSide",
  "errors.messages.blocked.closed",
  "errors.messages.blocked.applicationClosed",
  "errors.outcomes.candidate.",
] as const;

// The safety-critical strings: where a wrong translation causes harm, not
// confusion. A key belongs here if it tells the reader not to pay or that
// Walkins never charges, is part of reporting someone, says their account or
// check-in was questioned, tells them whether to travel to a drive (paused,
// cancelled, moved, turned down), or promises that something won't count
// against them. Their Hindi gets a native reading before the language is
// offered, and is read again whenever the English changes (test/i18n.test.ts).
// Typed against the English catalog, so renaming a key here breaks the build
// rather than quietly dropping it.
export const SAFETY_KEYS = {
  neverPay: [
    "neverPay.heading",
    "neverPay.body",
    "neverPay.report",
    "neverPay.howToReport",
    "alerts.neverPay",
    "bot.neverPay",
    "alerts.messageFlagged",
    "thread.flaggedCandidate",
    "drive.detail.unverified",
    "errors.checkIn.suspended",
    "report.drive.thanks",
  ],
  report: [
    "report.reason.ASKS_FOR_MONEY",
    "report.reason.NOT_A_REAL_JOB",
    "report.reason.MISLEADING_PAY",
    "report.reason.ABUSIVE",
    "report.reason.FAKE_PROFILE",
    "report.reason.OTHER",
    "report.drive.heading",
    "report.drive.intro",
    "report.drive.whatsWrong",
    "report.drive.chooseReason",
    "report.drive.details",
    "report.drive.detailsHint",
    "report.drive.send",
    "report.drive.sending",
    "report.drive.failed",
    "thread.report.open",
    "thread.report.reason",
    "thread.report.send",
    "thread.report.cancel",
    "thread.report.sent",
    "thread.report.failed",
    "errors.messages.reportOwnSide",
  ],
  questioned: [
    "warning.heading",
    "warning.candidate",
    "warning.note",
    "warning.acknowledge",
    "format.checkInFlags.LOW_GPS_ACCURACY",
    "format.checkInFlags.SYNCED_AFTER_EXPIRY",
    "checkin.flagged",
    "myDrives.outcome.awaitingConfirmation",
    "yourRecord.state.awaitingConfirmation",
  ],
  travel: [
    "alerts.drive_cancelled",
    "alerts.drive_suspended",
    "alerts.drive_reinstated",
    "alerts.application_rejected",
    "alerts.drive_rescheduled",
    "errors.application.suspended",
    "drive.detail.pausedHeading",
    "drive.detail.pausedBody",
    "myDrives.paused",
    "myDrives.cancelled",
    "myDrives.moved",
    "myDrives.movedOffline",
    "myDrives.noSeatHeld",
    "booking.noNeedToTravel",
    "board.state.cancelled",
    "board.state.suspended",
    "yourRecord.state.driveCancelled",
    "yourRecord.state.drivePaused",
  ],
  notAgainstYou: ["yourRecord.excused", "yourRecord.state.notAttendedExcused", "myDrives.started.whoSees", "alerts.joining_check"],
} as const satisfies Record<string, readonly MessageKey[]>;

export const safetyKeys = (): MessageKey[] => Object.values(SAFETY_KEYS).flat();

function leaves(catalog: Catalog, prefix = ""): [string, string][] {
  return Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : leaves(value, `${prefix}${key}.`),
  );
}

export const catalogLeaves = (locale: Locale) => leaves(CATALOGS[locale]);

export function inHindiScope(key: string): boolean {
  return HINDI_SCOPE.some((entry) => (entry.endsWith(".") ? key.startsWith(entry) : key === entry));
}

// English keys in Hindi's scope that Hindi doesn't have yet.
export function hindiGaps(): string[] {
  const written = new Set(leaves(CATALOGS.hi).map(([key]) => key));
  return leaves(CATALOGS.en)
    .map(([key]) => key)
    .filter((key) => inHindiScope(key) && !written.has(key));
}

// A language is offered only once it covers its scope, so nobody meets
// Hindi mixed with English. The gate lifts itself: there is no flag to
// forget. WALKINS_OFFER_HINDI=1 offers it early on one machine, to look at
// a partial catalog; it is off unless set, so the gated path is what a
// developer sees by default too.
export function offeredLocales(gaps: number, offerEarly: boolean): readonly Locale[] {
  return gaps === 0 || offerEarly ? LOCALES : [DEFAULT_LOCALE];
}

// Shared runs in the browser too, so it has no Node types. Written as a
// literal process.env read because that is what Next inlines into the
// client bundle (apps/web/next.config.ts), keeping server and browser agreed.
declare const process: { env: Record<string, string | undefined> };

export const OFFERED_LOCALES = offeredLocales(hindiGaps().length, process.env.WALKINS_OFFER_HINDI === "1");

// A saved language that isn't offered reads as English: users.locale can
// hold Hindi chosen before the gate closed, and alerts, the bot and the
// session cookie must not serve it until it is offered.
export function servedLocale(locale: Locale, offered: readonly Locale[] = OFFERED_LOCALES): Locale {
  return offered.includes(locale) ? locale : DEFAULT_LOCALE;
}

// The pages that exist in every language, under /hi for Hindi. Everything
// else (the employer console, admin, invitations, the design specimen) is
// English at one address.
export const LOCALIZED_PATHS = ["/", "/jobs", "/drives", "/login", "/profile", "/my-drives", "/checkin"] as const;

export function isLocalizedPath(path: string): boolean {
  return LOCALIZED_PATHS.some((p) => (p === "/" ? path === "/" : path === p || path.startsWith(`${p}/`)));
}

// Where a page is for a reader of this locale. Used by the web app's links
// and by every link Walkins sends, so a Hindi reader's Telegram link opens
// the Hindi page even with no signal to be redirected by.
export function localePath(path: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return path;
  const [pathname] = path.split(/[?#]/, 1);
  if (!isLocalizedPath(pathname)) return path;
  return pathname === "/" ? `/${locale}${path.slice(1)}` : `/${locale}${path}`;
}

// The other half of localePath: which locale an address is in, and the page
// it is for.
export function splitLocalePath(pathname: string): { locale: Locale; path: string } {
  const locale = LOCALES.find((l) => l !== DEFAULT_LOCALE && (pathname === `/${l}` || pathname.startsWith(`/${l}/`)));
  return locale ? { locale, path: pathname.slice(locale.length + 1) || "/" } : { locale: DEFAULT_LOCALE, path: pathname };
}

// A public page's addresses in every offered language, for its hreflang
// alternates. None until a second language is offered: until then a /hi
// address would only be English again.
export function localeAlternates(path: string, locale: string): { canonical: string; languages: Record<string, string> } | undefined {
  if (OFFERED_LOCALES.length === 1) return undefined;
  return {
    canonical: localePath(path, isLocale(locale) ? locale : DEFAULT_LOCALE),
    languages: { ...Object.fromEntries(OFFERED_LOCALES.map((l) => [`${l}-IN`, localePath(path, l)])), "x-default": path },
  };
}

// Set only by the API, from users.locale, whenever it issues a session or
// saves a choice: a copy for the web middleware, which can't read the
// database. The database wins; see docs/TECHNICAL.md, "Languages".
export const LOCALE_COOKIE = "locale";

// The web middleware's answer to "which language is this request", taken
// from the URL alone and read by the web app's request config.
export const LOCALE_HEADER = "x-walkins-locale";

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

// Whether this locale's translators wrote the key, rather than English
// standing in for it.
export function isTranslated(locale: Locale, key: MessageKey): boolean {
  return lookup(CATALOGS[locale] as Messages, key) !== undefined;
}

type MessageNode = { type: number; value?: unknown; options?: Record<string, { value: MessageNode[] }>; children?: MessageNode[]; pluralType?: string };

// What a message takes, to hold a translation to its English: every
// argument and tag by name and kind, and a select's cases. Plural categories
// aren't compared, since languages have different ones (Hindi's "one" covers
// 0 too). A translation that drops {link}, or adds a gender select English
// never had, fails on this.
export function messageArguments(message: string): string[] {
  const found = new Set<string>();
  for (const node of messageNodes(message)) {
    if (typeof node.value === "string" && node.type !== 0) {
      const cases = node.options && node.pluralType === undefined ? `:${Object.keys(node.options).sort().join("|")}` : "";
      found.add(`${node.type}:${node.value}${cases}`);
    }
  }
  return [...found].sort();
}

// Each plural argument's cases and what each case says, so a translation's
// plurals can be held to English's cases and its branches to differing.
export function pluralCases(message: string): Record<string, Record<string, string>> {
  const found: Record<string, Record<string, string>> = {};
  for (const node of messageNodes(message)) {
    if (node.pluralType === undefined || typeof node.value !== "string") continue;
    found[node.value] = Object.fromEntries(Object.entries(node.options ?? {}).map(([name, option]) => [name, JSON.stringify(option.value, withoutLocation)]));
  }
  return found;
}

const withoutLocation = (key: string, value: unknown) => (key === "location" ? undefined : value);

function* messageNodes(message: string): Generator<MessageNode> {
  function* walk(nodes: MessageNode[]): Generator<MessageNode> {
    for (const node of nodes) {
      yield node;
      for (const option of Object.values(node.options ?? {})) yield* walk(option.value);
      if (node.children) yield* walk(node.children);
    }
  }
  yield* walk(new IntlMessageFormat(message, INTL_LOCALE.en).getAst() as unknown as MessageNode[]);
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
