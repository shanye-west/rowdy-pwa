/**
 * Tee times are stored as a "hard-set" wall-clock string ("YYYY-MM-DDTHH:MM",
 * no timezone) so every viewer sees the same clock time — see `formatTeeTime`
 * and `utils/teeTime`. This module only carries the venue timezone and a helper
 * for rendering any *legacy* absolute-instant tee time (old Timestamp data) as a
 * venue-local wall clock, so those still display sensibly.
 *
 * The current event (French Lick, Indiana) observes US Eastern time; Indiana
 * Eastern has tracked America/New_York since 2006. If a future event is held in
 * a different zone, thread a per-tournament timezone through here.
 */
export const EVENT_TIME_ZONE = "America/New_York";

/** Offset in ms of `timeZone` at the given instant (positive = ahead of UTC). */
export function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const f: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") f[p.type] = Number(p.value);
  }
  const hour = f.hour === 24 ? 0 : f.hour;
  const asUTC = Date.UTC(f.year, f.month - 1, f.day, hour, f.minute, f.second);
  return asUTC - date.getTime();
}

/**
 * A stored *instant* (legacy Timestamp/Date) → `datetime-local` value
 * ("YYYY-MM-DDTHH:MM") rendered as the wall-clock time in `timeZone`.
 */
export function isoToZonedInput(date: Date, timeZone: string = EVENT_TIME_ZONE): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const f: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") f[p.type] = p.value;
  }
  const hour = f.hour === "24" ? "00" : f.hour;
  return `${f.year}-${f.month}-${f.day}T${hour}:${f.minute}`;
}
