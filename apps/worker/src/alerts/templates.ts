import { DEFAULT_LOCALE, formatFor, type Locale, type TemplatedMessage, type TemplateKey, translate } from "@walkins/shared";

export type AlertContext = {
  roleTitle: string;
  companyName: string;
  salaryMin: number;
  salaryMax: number;
  distanceKm: number;
  venueAddress: string;
  startsAt: string;
  endsAt: string;
  slotStartsAt: string | null;
  driveUrl: string;
};

// The wording lives in the shared catalog (alerts.*) like every other
// string, so sending Hindi later is choosing the locale from the candidate's
// preference, not rewriting templates. Until candidates have one, alerts go
// out in the default locale. Role titles, company names and venues are
// content and go in exactly as entered.
export function renderAlert(templateKey: TemplateKey, ctx: AlertContext, now: Date, locale: Locale = DEFAULT_LOCALE): TemplatedMessage {
  const format = formatFor(locale);
  const when = format.formatWhen(ctx.startsAt, ctx.endsAt, now);
  const values = {
    role: ctx.roleTitle,
    company: ctx.companyName,
    day: when.day,
    time: when.time,
    doors: when.time,
    slot: ctx.slotStartsAt ? format.formatTime(ctx.slotStartsAt) : "none",
    where: translate(locale, "alerts.where", { venue: ctx.venueAddress, distance: format.formatDistance(ctx.distanceKm) }),
    pay: format.formatSalary(ctx.salaryMin, ctx.salaryMax),
  };
  return { templateKey, text: translate(locale, `alerts.${templateKey}`, values), url: ctx.driveUrl };
}
