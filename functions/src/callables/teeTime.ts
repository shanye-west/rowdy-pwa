import { Timestamp } from "firebase-admin/firestore";

/**
 * Tee times are stored as a "hard-set" wall-clock string ("YYYY-MM-DDTHH:MM",
 * venue-local, no timezone) so every viewer sees the same clock time without any
 * conversion. This module owns how that value is normalized for storage and, for
 * the one place that needs an absolute instant (bet locking), how the naive
 * wall clock is interpreted in the venue's timezone.
 *
 * The current event (French Lick, Indiana) observes US Eastern time.
 */
export const EVENT_TIME_ZONE = "America/New_York";

/** True when a string carries a timezone designator (trailing "Z" or offset). */
function hasZoneDesignator(value: string): boolean {
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
}

/** Offset in ms of `timeZone` at the given instant (positive = ahead of UTC). */
function tzOffsetMs(timeZone: string, date: Date): number {
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

/** Wall clock "YYYY-MM-DDTHH:MM" (no zone) → epoch ms, interpreted in `timeZone`. */
function wallClockToMillis(value: string, timeZone: string = EVENT_TIME_ZONE): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const naiveUTC = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = tzOffsetMs(timeZone, new Date(naiveUTC));
  return naiveUTC - offset;
}

/**
 * Normalize an incoming teeTime to how it should be STORED.
 * - Strings are stored verbatim (the hard-set wall clock is the source of truth).
 * - Legacy Timestamp / serialized-timestamp inputs are kept as a Timestamp.
 * Returns null for missing/unrecognized values (leaves teeTime unset).
 */
export function normalizeTeeTime(teeTime: unknown): string | Timestamp | null {
  if (!teeTime) return null;
  if (typeof teeTime === "string") return teeTime;
  if (teeTime instanceof Timestamp) return teeTime;
  if (typeof teeTime === "object" && "_seconds" in teeTime) {
    const t = teeTime as { _seconds: number; _nanoseconds?: number };
    return Timestamp.fromMillis(t._seconds * 1000 + (t._nanoseconds || 0) / 1000000);
  }
  return null;
}

/**
 * teeTime (wall-clock string | absolute ISO | Timestamp | serialized) → epoch ms.
 * Naive wall-clock strings are interpreted in the venue timezone; strings with a
 * zone designator are parsed as the absolute instant they encode. Used only to
 * decide whether a match's tee time has passed (bet locking).
 */
export function teeTimeToMillis(tee: unknown): number | null {
  if (!tee) return null;
  if (tee instanceof Timestamp) return tee.toMillis();
  if (typeof tee === "string") {
    if (hasZoneDesignator(tee)) {
      const ms = Date.parse(tee);
      return Number.isNaN(ms) ? null : ms;
    }
    return wallClockToMillis(tee);
  }
  if (typeof tee === "object" && tee !== null && "_seconds" in tee) {
    const secs = (tee as { _seconds?: unknown })._seconds;
    if (typeof secs === "number") return secs * 1000;
  }
  return null;
}
