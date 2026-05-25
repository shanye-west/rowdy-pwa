import { Timestamp } from "firebase/firestore";
import type { FirestoreTimestampLike, MatchDoc } from "./types";

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

/**
 * Format tee time for display, e.g. "9:10am".
 * Accepts any FirestoreTimestampLike shape; returns "" when value is missing or unparseable.
 */
export function formatTeeTime(timestamp: FirestoreTimestampLike | undefined): string {
  const date = toDateOrNull(timestamp);
  if (!date) return "";

  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";

  hours = hours % 12;
  hours = hours ? hours : 12;

  const minutesStr = minutes < 10 ? `0${minutes}` : minutes;

  return `${hours}:${minutesStr}${ampm}`;
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