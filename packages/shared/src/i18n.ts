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
// cancelled, moved, turned down), promises that something won't count
// against them, or tells them whether their check-in was recorded: someone
// who wrongly believes they're checked in waits, isn't called, and is marked
// absent. Their Hindi gets a native reading before the language is
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
    "booking.rejected",
    "booking.screenedOut",
    "myDrives.offline",
    "drive.detail.endedBody",
    "drive.detail.pillarCentre",
    "alerts.drive_48h",
    "alerts.drive_morning_of",
  ],
  notAgainstYou: ["yourRecord.excused", "yourRecord.state.notAttendedExcused", "myDrives.started.whoSees", "alerts.joining_check", "yourRecord.intro"],
  checkInRecorded: [
    "checkin.savedBody",
    "errors.checkIn.needsRegistering",
    "errors.checkIn.refused",
    "checkin.savedHeading",
    "checkin.offline",
    "checkin.waiting",
    "checkin.in",
    "checkin.alreadyIn",
    "checkin.failed",
    "booking.checkedIn",
  ],
} as const satisfies Record<string, readonly MessageKey[]>;

export const safetyKeys = (): MessageKey[] => Object.values(SAFETY_KEYS).flat();

// Every other key in Hindi's scope, each looked at and judged not
// safety-critical. A key new to the scope is in neither list until someone
// decides which it belongs in, and the test fails until they do: a keyword
// check only finds the wording its author already thought of.
export const NOT_SAFETY_KEYS = [
  "format.today", "format.tomorrow", "format.dayDate", "format.range", "format.noExperience", "format.years", "format.yearsRange",
  "format.seatsAllTaken", "format.seatsLeft", "alerts.where", "alerts.message", "errors.generic", "errors.network", "errors.rateLimited.default",
  "errors.rateLimited.public-read", "errors.rateLimited.application", "errors.rateLimited.voice-upload", "errors.rateLimited.drive-create",
  "errors.rateLimited.drive-edit", "errors.rateLimited.profile-edit", "errors.rateLimited.applicant-actions", "errors.rateLimited.top-up-order",
  "errors.rateLimited.top-up-confirm", "errors.rateLimited.webhook", "errors.rateLimited.checkin-code", "errors.rateLimited.intro-audio",
  "errors.rateLimited.telegram-link", "errors.rateLimited.socket-join", "errors.rateLimited.invitations", "errors.auth.otpPhoneLimit",
  "errors.auth.otpNetworkLimit", "errors.auth.otpExpired", "errors.auth.otpLocked", "errors.auth.otpWrong", "errors.auth.userGone",
  "errors.auth.signedOut", "errors.auth.sessionRevoked", "errors.auth.wrongRole", "errors.auth.noCompany", "errors.profile.saveFirst",
  "errors.profile.incomplete", "errors.profile.telegramUnavailable", "errors.voice.uploadExpired", "errors.voice.uploadIncomplete",
  "errors.voice.noRecording", "errors.voice.tooLarge", "errors.voice.uploadFailed", "errors.checkIn.codeOnlyLive", "errors.checkIn.tooManyWrong",
  "errors.checkIn.wrongCode", "errors.checkIn.codeExpired", "errors.checkIn.codeUsed", "errors.checkIn.notOpen", "errors.checkIn.opensAt",
  "errors.checkIn.ended", "errors.checkIn.noShow", "errors.checkIn.screenedOut", "errors.checkIn.rejected", "errors.checkIn.tooFar",
  "errors.checkIn.notACode", "errors.drive.notFound", "errors.drive.searchNeedsPlace", "errors.application.notFound",
  "errors.application.driveEnded", "errors.application.slotNotInDrive", "errors.application.slotStarted", "errors.application.alreadyBooked",
  "errors.application.screenedOut", "errors.application.alreadyApplied", "errors.application.slotFull", "errors.knockout.missing",
  "errors.knockout.needsYesNo", "errors.knockout.needsNumber", "errors.knockout.needsChoice", "errors.validation.required",
  "errors.validation.number", "errors.validation.integer", "errors.validation.tooLow", "errors.validation.tooHigh", "errors.validation.tooShort",
  "errors.validation.tooLong", "errors.validation.tooFew", "errors.validation.tooMany", "errors.validation.format", "errors.validation.choice",
  "errors.validation.generic", "errors.validation.phone", "errors.validation.otp", "errors.validation.payRange", "errors.validation.experienceRange",
  "errors.validation.timeOrder", "errors.validation.topUpMin", "errors.validation.topUpMax", "errors.validation.knockoutBounds",
  "errors.validation.knockoutOrder", "errors.validation.knockoutDuplicate", "errors.validation.knockoutAccepted",
  "errors.validation.tooLowExclusive", "errors.validation.tooHighExclusive", "errors.validation.invitePhone", "errors.validation.gstin",
  "errors.validation.date", "errors.messages.notFound", "errors.messages.blocked.closed", "errors.messages.blocked.applicationClosed",
  "errors.outcomes.candidate.notHired", "errors.outcomes.candidate.notYet", "errors.outcomes.candidate.tooLate", "fields.default", "fields.phone",
  "fields.otp", "fields.cityId", "fields.homeLat", "fields.homeLng", "fields.maxTravelKm", "fields.experienceYears", "fields.roleIds",
  "fields.reason", "fields.code", "fields.slotId", "fields.answers", "fields.details", "fields.body", "fields.seq", "fields.started",
  "board.state.live", "board.state.filling", "board.state.closing", "board.state.expired", "board.slots.open", "board.slots.booked",
  "board.slots.underWay", "board.slots.selected", "board.slots.showFewer", "board.slots.showAll", "board.countdown.closesIn",
  "board.countdown.startsIn", "board.countdown.daysFlap", "board.countdown.daysSpoken", "board.countdown.hoursSpoken", "nav.yourDrives",
  "nav.yourProfile", "nav.admin", "nav.logIn", "nav.logOut", "nav.loggingOut", "nav.account", "map.drives.noWebgl", "map.drives.label",
  "map.home.noWebgl", "map.home.label", "transcript.label", "transcript.language", "transcript.languageSure", "meta.title", "meta.titleTemplate",
  "meta.description", "home.heading", "home.intro", "home.chooseCity", "home.unreachable", "home.seeDrives", "jobs.cityContext", "jobs.cityHeading",
  "jobs.roleHeading", "jobs.meta.cityTitle", "jobs.meta.cityDescription", "jobs.meta.roleTitle", "jobs.meta.roleDescription", "jobs.search.count",
  "jobs.search.within", "jobs.search.from", "jobs.search.to", "jobs.search.searching", "jobs.search.apply", "jobs.search.viewAs", "jobs.search.list",
  "jobs.search.map", "jobs.search.drives", "jobs.search.none", "jobs.search.loading", "jobs.search.more", "jobs.search.cityMap",
  "jobs.search.mapKey", "drive.meta.title", "drive.meta.description", "drive.detail.endedHeading", "drive.detail.seeLive", "drive.detail.when",
  "drive.detail.pay", "drive.detail.experience", "drive.detail.seats", "drive.detail.distance", "drive.detail.from", "drive.detail.venueMap",
  "drive.detail.pillarVenue", "drive.detail.pillarVenueSeats", "booking.yes", "booking.no", "booking.heading", "booking.booked",
  "booking.bookedWhen", "booking.thisDrive", "booking.checkIn", "booking.yourDrives", "booking.releaseConfirm", "booking.releasing",
  "booking.release", "booking.asksFor", "booking.noShow", "booking.pickAgain", "booking.pick", "booking.questionsIntro", "booking.booking",
  "booking.book", "booking.logInToBook", "booking.profileToBook", "myDrives.outcome.INTERESTED", "myDrives.outcome.CONFIRMED",
  "myDrives.outcome.CHECKED_IN", "myDrives.outcome.INTERVIEWED", "myDrives.outcome.HIRED", "myDrives.outcome.REJECTED", "myDrives.outcome.NO_SHOW",
  "myDrives.outcome.WITHDRAWN", "myDrives.outcome.SCREENED_OUT", "myDrives.roleAt", "myDrives.drive", "myDrives.yourSlot", "myDrives.status",
  "myDrives.asksFor", "myDrives.checkIn", "myDrives.details", "myDrives.releasing", "myDrives.release", "myDrives.loadFailed",
  "myDrives.releaseConfirm", "myDrives.releaseFailed", "myDrives.heading", "myDrives.comingUp", "myDrives.nothingBooked", "myDrives.past",
  "myDrives.messages", "myDrives.messagesUnread", "myDrives.newMessages", "myDrives.started.joining", "myDrives.started.answered",
  "myDrives.started.question", "myDrives.started.change", "myDrives.started.yes", "myDrives.started.no", "myDrives.started.failed",
  "login.sendFailed", "login.checkFailed", "login.heading", "login.phoneIntro", "login.codeIntro", "login.phone", "login.phoneHint", "login.sending",
  "login.send", "login.code", "login.devCode", "login.checking", "login.logIn", "login.differentNumber", "profile.noLocation", "profile.pickRole",
  "profile.saveFailed", "profile.heading", "profile.intro", "profile.travel", "profile.travelSpoken", "profile.experience", "profile.roles",
  "profile.saved", "profile.saving", "profile.save", "profile.home", "profile.locating", "profile.locate", "profile.mapHelp", "profile.nearestCity",
  "telegram.linkFailed", "telegram.heading", "telegram.connected", "telegram.notConnected", "telegram.saveFirst", "telegram.open", "telegram.orSend",
  "telegram.linkExpiry", "telegram.connectedHelp", "telegram.pitch", "telegram.creating", "telegram.reconnect", "telegram.connect",
  "voice.status.UPLOADED", "voice.status.PROCESSING", "voice.status.DONE", "voice.failure.noSpeech", "voice.failure.tooLong", "voice.failure.empty",
  "voice.failure.unreadable", "voice.failure.unavailable", "voice.noRecorder", "voice.micBlocked", "voice.tooLarge", "voice.heading", "voice.pitch",
  "voice.saveFirst", "voice.recording", "voice.stop", "voice.sending", "voice.replace", "voice.use", "voice.again", "voice.lowConfidence",
  "voice.recordNew", "voice.record", "voice.replaces", "checkin.codeShape", "checkin.typeCode", "checkin.typeCodeHint", "checkin.withCode",
  "checkin.locationOff", "checkin.noFix", "checkin.needsHttps", "checkin.noCamera", "checkin.heading", "checkin.intro", "checkin.scan",
  "checkin.pointCamera", "checkin.locating", "checkin.sending", "checkin.walkInOffer", "checkin.registerWalkIn", "checkin.notNow", "checkin.at",
  "checkin.yourDrives", "checkin.scanAgain", "checkin.cancel", "checkin.next", "checkin.nextWithSlot", "checkin.synced", "checkInScreen.drive",
  "checkInScreen.heading", "checkInScreen.qrAlt", "checkInScreen.typeAt", "checkInScreen.codeSpoken", "checkInScreen.codeFailed",
  "checkInScreen.gettingCode", "checkInScreen.nextCode", "checkInScreen.stale", "checkInScreen.candidatesHeading", "checkInScreen.candidatesBody",
  "liveBoard.loading", "liveBoard.arrivals", "liveBoard.title", "liveBoard.where", "liveBoard.live", "liveBoard.reconnecting", "liveBoard.counts",
  "liveBoard.count.alerted", "liveBoard.count.confirmed", "liveBoard.count.checkedIn", "liveBoard.count.walkIns", "liveBoard.count.hired",
  "liveBoard.latest", "liveBoard.arrived", "liveBoard.name", "liveBoard.slot", "liveBoard.walkIn", "liveBoard.none", "liveBoard.fullScreen",
  "liveBoard.back", "liveBoard.unnamed", "bot.connectFirst", "bot.linkUsed", "bot.connected", "bot.notConnected", "bot.noJobs", "bot.jobsHeading",
  "bot.jobLine", "bot.jobWhen", "bot.stopped", "thread.you", "thread.fromCompany", "thread.emptyCandidate", "thread.write", "thread.count",
  "thread.send", "thread.sending", "thread.sendFailed", "thread.loadFailed", "thread.backToDrives", "thread.withCompany", "thread.about",
  "thread.closesOn", "yourRecord.heading", "yourRecord.empty", "yourRecord.roleAt", "yourRecord.state.booked", "yourRecord.state.attended",
  "yourRecord.state.notAttended", "yourRecord.state.withdrawn", "yourRecord.state.screenedOut", "yourRecord.state.turnedAway", "yourRecord.markedOn",
  "yourRecord.joining", "yourRecord.started", "yourRecord.retained", "yourRecord.yourAnswer", "yourRecord.notRecorded", "yourRecord.startedOn",
  "yourRecord.yes", "yourRecord.didNotStart", "yourRecord.stayed", "yourRecord.left", "yourRecord.youStarted", "yourRecord.youDidNotStart",
  "language.heading", "language.intro", "language.name.en", "language.name.hi", "language.hindiReview", "language.switchTo", "language.saveFailed",
] as const satisfies readonly MessageKey[];

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
