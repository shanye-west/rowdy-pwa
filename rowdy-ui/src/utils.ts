import type { MatchDoc } from "./types";

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
 * Format tee time for display
 * @param timestamp - Firestore Timestamp or Date
 * @returns Formatted time string (e.g., "9:10am")
 */
export function formatTeeTime(timestamp: any): string {
  if (!timestamp) return "";
  
  // Handle Firestore Timestamp
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12
  
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