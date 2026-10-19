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
  reportUrl: string;
};

// The wording lives in the shared catalog (alerts.*) like every other
// string, so sending Hindi later is choosing the locale from the candidate's
// preference, not rewriting templates. Until candidates have one, alerts go
// out in the default locale. Role titles, company names and venues are
// content and go in exactly as entered. Every alert ends with the same
// warning: fake recruiters charge "registration fees", and the alert is
// where a candidate is reading about the job.
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
  const text = `${translate(locale, `alerts.${templateKey}`, values)}\n\n${translate(locale, "alerts.neverPay", { link: ctx.reportUrl })}`;
  return { templateKey, text, url: ctx.driveUrl };
}
