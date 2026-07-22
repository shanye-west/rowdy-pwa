import { Timestamp } from "firebase/firestore";
import type { FirestoreTimestampLike, MatchDoc } from "./types";
import { EVENT_TIME_ZONE, tzOffsetMs } from "./utils/timeZone";

/**
 * Determine the champion of a tournament from its confirmed point totals.
 *
 * A winner exists when either:
 *   - a team has clinched on points (confirmed >= points-to-win, i.e. a majority
 *     the other team can no longer catch), or
 *   - the tournament finished tied after regulation and the admin designated a
 *     winner via `tournament.tiebreakerWinner`.
 *
 * Returns `null` while the tournament is undecided or ended in an unbroken tie.
 * Shared by the home/tournament Total Score tiles and the History list so the
 * "who won" logic lives in exactly one place.
 */
export function getTournamentWinner(
  tiebreakerWinner: "teamA" | "teamB" | undefined,
  teamAConfirmed: number,
  teamBConfirmed: number,
  totalPointsAvailable: number,
): { winnerKey: "teamA" | "teamB"; viaTiebreaker: boolean } | null {
  if (tiebreakerWinner === "teamA" || tiebreakerWinner === "teamB") {
    // Admin-designated winner of a regulation tie takes precedence.
    return { winnerKey: tiebreakerWinner, viaTiebreaker: true };
  }

  // Majority needed to clinch: half the points plus a half-point.
  if (totalPointsAvailable > 0) {
    const pointsToWin = totalPointsAvailable / 2 + 0.5;
    if (teamAConfirmed >= pointsToWin) return { winnerKey: "teamA", viaTiebreaker: false };
    if (teamBConfirmed >= pointsToWin) return { winnerKey: "teamB", viaTiebreaker: false };
  }

  return null;
}

export function formatRoundType(format: string | null | undefined): string {
  if (!format) return "Format TBD";
  const formatMap: Record<string, string> = {
    twoManBestBall: "2-Man Best Ball",
    twoManShamble: "2-Man Shamble",
    twoManScramble: "2-Man Scramble",
    fourManScramble: "4-Man Scramble",
    singles: "Singles",
  };
  return formatMap[format] || format;
}

/**
 * Normalize a Firestore timestamp-like value to a Date.
 * Handles Timestamp objects, Date, ISO/datetime strings, and serialized POJOs
 * with `_seconds` or `seconds` fields (the two forms Firestore can produce
 * when timestamps cross a serialization boundary).
 */
export function toDateOrNull(value: FirestoreTimestampLike | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object") {
    const seconds = "_seconds" in value ? value._seconds : value.seconds;
    if (typeof seconds === "number") return new Date(seconds * 1000);
  }
  return null;
}

/** hours/minutes (24h) → display string, e.g. "12:06pm". */
function formatClock(hours: number, minutes: number): string {
  const period = hours >= 12 ? "pm" : "am";
  let h = hours % 12;
  h = h ? h : 12;
  return `${h}:${String(minutes).padStart(2, "0")}${period}`;
}

/**
 * Parse a "hard-set" wall-clock string ("YYYY-MM-DDTHH:MM[:SS]" or "HH:MM") into
 * hours/minutes. Returns null for absolute-instant strings — those carry a
 * timezone designator (trailing "Z" or numeric offset) and must NOT be read
 * literally. Naive strings have no zone, so their digits are the wall clock.
 */
function wallClockParts(value: string): { hours: number; minutes: number } | null {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return null; // absolute instant
  const m = value.match(/^(?:\d{4}-\d{2}-\d{2}T)?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Format tee time for display, e.g. "12:06pm".
 *
 * Tee times are stored as a hard-set wall-clock string with no timezone, so the
 * literal clock is shown verbatim — every viewer sees the same time regardless
 * of their device's zone. Legacy absolute-instant values (old Timestamps) fall
 * back to being rendered in the venue's timezone. Returns "" when missing or
 * unparseable.
 */
export function formatTeeTime(
  timestamp: FirestoreTimestampLike | undefined,
  timeZone: string = EVENT_TIME_ZONE
): string {
  if (typeof timestamp === "string") {
    const wc = wallClockParts(timestamp);
    if (wc) return formatClock(wc.hours, wc.minutes);
  }

  // Legacy/absolute instant — render in the venue timezone.
  const date = toDateOrNull(timestamp);
  if (!date) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const f: Record<string, string> = {};
  for (const p of parts) f[p.type] = p.value;

  const period = (f.dayPeriod || "").toLowerCase();
  return `${f.hour}:${f.minute}${period}`;
}

/**
 * teeTime → epoch ms. A hard-set wall-clock string (no timezone) is interpreted
 * in the venue timezone, so "has the tee time passed?" resolves to the same
 * instant for every viewer. Legacy absolute values are read directly. Returns
 * null when missing/unparseable.
 */
export function teeTimeToMillis(teeTime: FirestoreTimestampLike | undefined): number | null {
  if (typeof teeTime === "string" && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(teeTime)) {
    const m = teeTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return null;
    const naiveUTC = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return naiveUTC - tzOffsetMs(EVENT_TIME_ZONE, new Date(naiveUTC));
  }
  const date = toDateOrNull(teeTime);
  return date ? date.getTime() : null;
}

export function formatMatchStatus(
  status?: MatchDoc["status"],
  teamAName: string = "Team A",
  teamBName: string = "Team B"
): string {
  if (!status) return "—";

  const { leader, margin, thru, closed } = status;
  const safeThru = thru ?? 0;
  const safeMargin = margin ?? 0;

  // Case 0: Not started
  if (safeThru === 0) return "Not started";

  // Case 1: All Square
  if (!leader) {
    if (closed) return "Halved"; // Final Tie
    return `All Square (${safeThru})`; // Live Tie
  }

  // Case 2: Someone is leading
  const winnerName = leader === "teamA" ? teamAName : teamBName;

  // Final / Closed
  if (closed) {
    // "4 & 3" logic: Match ended early
    if (safeThru < 18) {
      const holesLeft = 18 - safeThru;
      return `${winnerName} wins ${safeMargin} & ${holesLeft}`;
    }
    // "1 UP" or "2 UP" logic: Match went to 18
    return `${winnerName} wins ${safeMargin} UP`;
  }

  // Live / In Progress
  return `${winnerName} ${safeMargin} UP (${safeThru})`;
}