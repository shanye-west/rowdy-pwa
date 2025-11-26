import type { MatchDoc } from "./types";

export function formatRoundType(format: string | null | undefined): string {
  if (!format) return "Format TBD";
  const formatMap: Record<string, string> = {
    twoManBestBall: "2-Man Best Ball",
    twoManShamble: "2-Man Shamble",
    twoManScramble: "2-Man Scramble",
    singles: "Singles",
  };
  return formatMap[format] || format;
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

import type { PlayerMatchFact } from "./types";

/**
 * Extracts a normalized list of opponents from a match fact.
 * Strictly uses the 'opponentIds' array as the source of truth.
 */
export function getOpponents(fact: PlayerMatchFact): { id: string; tier: string }[] {
  if (fact.opponentIds && fact.opponentIds.length > 0) {
    return fact.opponentIds.map((id, index) => ({
      id,
      // Safety check: ensure tier exists at same index, default to "Unknown"
      tier: fact.opponentTiers?.[index] || "Unknown",
    }));
  }
  return [];
}

export function getPartners(fact: PlayerMatchFact): { id: string; tier: string }[] {
  if (fact.partnerIds && fact.partnerIds.length > 0) {
    return fact.partnerIds.map((id, index) => ({
      id,
      tier: fact.partnerTiers?.[index] || "Unknown",
    }));
  }
  return [];
}