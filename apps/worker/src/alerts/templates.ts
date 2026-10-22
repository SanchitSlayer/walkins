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
  // For a reschedule notice: the time the candidate knew before.
  previous: { startsAt: string; endsAt: string } | null;
  // For a joining check: the day they were due to start.
  joiningDate: string | null;
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
// A message's Telegram copy: who wrote it, what they said exactly as
// written, where to reply, and the same never-pay line as every alert. If the
// tripwire caught a money request, the warning comes first. Telegram's own
// apps make any link in the text clickable; Walkins can't stop that, which is
// one more reason the warning is there.
export function renderMessage(
  m: { sender: string; company: string; role: string; body: string; flagged: boolean; threadUrl: string },
  locale: Locale = DEFAULT_LOCALE,
): TemplatedMessage {
  const text = [
    m.flagged ? translate(locale, "alerts.messageFlagged") : null,
    translate(locale, "alerts.message", { sender: m.sender, company: m.company, role: m.role, body: m.body }),
    translate(locale, "alerts.neverPay", { link: m.threadUrl }),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { templateKey: "message", text, url: m.threadUrl };
}

export function renderAlert(templateKey: TemplateKey, ctx: AlertContext, now: Date, locale: Locale = DEFAULT_LOCALE): TemplatedMessage {
  const format = formatFor(locale);
  const when = format.formatWhen(ctx.startsAt, ctx.endsAt, now);
  const was = ctx.previous ? format.formatWhen(ctx.previous.startsAt, ctx.previous.endsAt, now) : null;
  const values = {
    role: ctx.roleTitle,
    company: ctx.companyName,
    day: when.day,
    time: when.time,
    doors: when.time,
    slot: ctx.slotStartsAt ? format.formatTime(ctx.slotStartsAt) : "none",
    where: translate(locale, "alerts.where", { venue: ctx.venueAddress, distance: format.formatDistance(ctx.distanceKm) }),
    pay: format.formatSalary(ctx.salaryMin, ctx.salaryMax),
    ...(was ? { wasDay: was.day, wasTime: was.time } : {}),
    ...(ctx.joiningDate ? { joining: format.formatDate(new Date(`${ctx.joiningDate}T12:00:00+05:30`)) } : {}),
  };
  const text = `${translate(locale, `alerts.${templateKey}`, values)}\n\n${translate(locale, "alerts.neverPay", { link: ctx.reportUrl })}`;
  return { templateKey, text, url: ctx.driveUrl };
}
