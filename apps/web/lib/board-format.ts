// Every drive happens in India, so dates are formatted in India time on both
// the server render and in the browser. Formatting in each runtime's own
// zone would render different text on each side and break hydration.
const TIME_ZONE = "Asia/Kolkata";

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayPartsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const rupees = new Intl.NumberFormat("en-IN");

export function dayKey(date: Date): string {
  return dayKeyFormat.format(date);
}

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function dayLabel(date: Date, now: Date): string {
  if (dayKey(date) === dayKey(now)) return "Today";
  if (dayKey(date) === dayKey(new Date(now.getTime() + 86_400_000))) return "Tomorrow";
  const parts = Object.fromEntries(dayPartsFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}

export function formatWhen(startsAt: string, endsAt: string, now: Date): { day: string; time: string } {
  const start = new Date(startsAt);
  return {
    day: dayLabel(start, now),
    time: `${formatTime(startsAt)}–${formatTime(endsAt)}`,
  };
}

export function formatSalary(min: number, max: number): string {
  return min === max ? `₹${rupees.format(min)}` : `₹${rupees.format(min)}–₹${rupees.format(max)}`;
}

export function formatExperience(min: number, max: number): string {
  if (max === 0) return "No experience needed";
  const years = (n: number) => `${n} ${n === 1 ? "year" : "years"}`;
  return min === max ? years(min) : `${min}–${years(max)}`;
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(1)} km`;
}

export function formatSeats(capacity: number, booked: number): string {
  const left = Math.max(0, capacity - booked);
  return left === 0 ? `All ${capacity} seats taken` : `${left} of ${capacity} seats left`;
}
