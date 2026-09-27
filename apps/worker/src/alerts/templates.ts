import { formatDistance, formatSalary, formatTime, formatWhen, type TemplatedMessage, type TemplateKey } from "@walkins/shared";

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

// Role titles, company names and venues are content and go in exactly as
// entered; only the wording around them follows the sentence-case rule.
export function renderAlert(templateKey: TemplateKey, ctx: AlertContext, now: Date): TemplatedMessage {
  const when = formatWhen(ctx.startsAt, ctx.endsAt, now);
  const where = `${ctx.venueAddress} (${formatDistance(ctx.distanceKm)} from your home)`;
  const lines =
    templateKey === "drive_48h"
      ? [
          "New walk-in near you",
          `${ctx.roleTitle} at ${ctx.companyName}`,
          "",
          `When: ${when.day}, ${when.time}`,
          `Where: ${where}`,
          `Pay: ${formatSalary(ctx.salaryMin, ctx.salaryMax)}`,
          "",
          "Walk in any time in that window. No application needed.",
        ]
      : [
          "Reminder: your walk-in interview is today",
          `${ctx.roleTitle} at ${ctx.companyName}`,
          "",
          ctx.slotStartsAt ? `Your slot: ${formatTime(ctx.slotStartsAt)} (doors ${when.time})` : `Doors: ${when.time}`,
          `Where: ${where}`,
          `Pay: ${formatSalary(ctx.salaryMin, ctx.salaryMax)}`,
          "",
          "You're getting this because you confirmed you'd attend.",
        ];
  return { templateKey, text: lines.join("\n"), url: ctx.driveUrl };
}
