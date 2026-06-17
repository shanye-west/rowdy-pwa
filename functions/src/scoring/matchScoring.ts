/**
 * Match scoring logic
 * Calculates hole winners, running status, and match results
 */

import type { RoundFormat, MatchData, MatchStatus, MatchResult, PlayerInMatch } from "../types.js";
import { MIN_GROSS_SCORE, MAX_GROSS_SCORE } from "../constants.js";

// --- SCORING HELPERS ---

export function clamp01(n: unknown) { return Number(n) === 1 ? 1 : 0; }
export function isNum(n: any): n is number { return typeof n === "number" && Number.isFinite(n); }
/**
 * A gross score is only usable if it's a plausible golf score. Clients can
 * write arbitrary values into the holes map (rules don't validate values),
 * so out-of-range garbage is treated the same as "hole not scored yet".
 */
export function isValidGross(n: any): n is number {
  return isNum(n) && Number.isInteger(n) && n >= MIN_GROSS_SCORE && n <= MAX_GROSS_SCORE;
}
function to2(arr: any[]) { return [isValidGross(arr?.[0]) ? arr[0] : null, isValidGross(arr?.[1]) ? arr[1] : null]; }

export function holesRange(obj: Record<string, any>) {
  const keys = Object.keys(obj).filter(k => /^[1-9]$|^1[0-8]$/.test(k)).map(Number);
  keys.sort((a, b) => a - b);
  return keys;
}

/**
 * Determines the winner of a single hole based on format and scores
 * @returns "teamA" | "teamB" | "AS" (all square) | null (incomplete)
 */
export function decideHole(format: RoundFormat, i: number, match: MatchData): "teamA" | "teamB" | "AS" | null {
  const h = match.holes?.[String(i)]?.input ?? {};
  
  if (format === "twoManScramble" || format === "fourManScramble") {
    // Scramble (2- or 4-man): one gross score per team — identical input shape,
    // so 4-man reuses the same team-gross logic as 2-man.
    const a = h.teamAGross;
    const b = h.teamBGross;
    if (!isValidGross(a) || !isValidGross(b)) return null;
    return a < b ? "teamA" : b < a ? "teamB" : "AS";
  }
  
  if (format === "singles") {
    const aG = h.teamAPlayerGross;
    const bG = h.teamBPlayerGross;
    if (!isValidGross(aG) || !isValidGross(bG)) return null;
    const aNet = aG - clamp01(match.teamAPlayers?.[0]?.strokesReceived?.[i - 1]);
    const bNet = bG - clamp01(match.teamBPlayers?.[0]?.strokesReceived?.[i - 1]);
    return aNet < bNet ? "teamA" : bNet < aNet ? "teamB" : "AS";
  }
  
  if (format === "twoManShamble") {
    // Shamble: individual player scores, GROSS only (no strokes applied)
    const aArr = to2(h.teamAPlayersGross || []);
    const bArr = to2(h.teamBPlayersGross || []);
    if (aArr[0] == null || aArr[1] == null || bArr[0] == null || bArr[1] == null) return null;
    
    // Best GROSS (no handicap) for each team
    const aBest = Math.min(aArr[0]!, aArr[1]!);
    const bBest = Math.min(bArr[0]!, bArr[1]!);
    return aBest < bBest ? "teamA" : bBest < aBest ? "teamB" : "AS";
  }
  
  // Best Ball: individual player scores with NET calculation
  const aArr = to2(h.teamAPlayersGross || []);
  const bArr = to2(h.teamBPlayersGross || []);
  if (aArr[0] == null || aArr[1] == null || bArr[0] == null || bArr[1] == null) return null;

  const getNet = (g: number | null, pIdx: number, teamArr: PlayerInMatch[] | undefined) => {
    const s = clamp01(teamArr?.[pIdx]?.strokesReceived?.[i - 1]);
    return g! - s;
  };
  const aBest = Math.min(getNet(aArr[0], 0, match.teamAPlayers), getNet(aArr[1], 1, match.teamAPlayers));
  const bBest = Math.min(getNet(bArr[0], 0, match.teamBPlayers), getNet(bArr[1], 1, match.teamBPlayers));
  
  return aBest < bBest ? "teamA" : bBest < aBest ? "teamB" : "AS";
}

export interface MatchSummary {
  holesWonA: number;
  holesWonB: number;
  thru: number;
  leader: "teamA" | "teamB" | null;
  margin: number;
  dormie: boolean;
  closed: boolean;
  winner: "teamA" | "teamB" | "AS";
  wasTeamADown3PlusBack9: boolean;
  wasTeamAUp3PlusBack9: boolean;
  marginHistory: number[];
}

/**
 * Summarizes the current match state by iterating through all holes
 * Note: Once a match is mathematically decided (margin > holes remaining),
 * we stop processing additional holes for match status purposes.
 * This allows post-match scoring without affecting the final result.
 */
export function summarize(format: RoundFormat, match: MatchData): MatchSummary {
  let a = 0, b = 0, thru = 0;
  let runningMargin = 0; // positive = Team A leading, negative = Team B leading
  let wasTeamADown3PlusBack9 = false;
  let wasTeamAUp3PlusBack9 = false;
  const marginHistory: number[] = []; // Track margin after each completed hole
  let matchDecided = false; // Track when match is mathematically over

  for (const i of holesRange(match.holes ?? {})) {
    // If match is already decided, don't process further holes for match status
    if (matchDecided) break;
    
    const res = decideHole(format, i, match);
    if (res === null) continue;
    thru = Math.max(thru, i);
    if (res === "teamA") { a++; runningMargin++; }
    else if (res === "teamB") { b++; runningMargin--; }
    
    // Track margin after this hole
    marginHistory.push(runningMargin);

    // Track momentum entering back 9 (after hole 9 through 18)
    if (i >= 9) {
      if (runningMargin <= -3) wasTeamADown3PlusBack9 = true;
      if (runningMargin >= 3) wasTeamAUp3PlusBack9 = true;
    }
    
    // Check if match is now mathematically decided
    const margin = Math.abs(runningMargin);
    const holesLeft = 18 - i;
    if (margin > holesLeft) {
      matchDecided = true;
    }
  }
  
  const leader = a > b ? "teamA" : b > a ? "teamB" : null;
  const margin = Math.abs(a - b);
  const holesLeft = 18 - thru;
  // Match closes when: someone wins (margin > holesLeft), OR all 18 holes are completed
  const closed = (leader !== null && margin > holesLeft) || thru === 18;
  const dormie = leader !== null && margin === holesLeft && thru < 18;
  const winner = (thru === 18 && a === b) ? "AS" : (leader ?? "AS");
  
  return { 
    holesWonA: a, 
    holesWonB: b, 
    thru, 
    leader, 
    margin, 
    dormie, 
    closed, 
    winner,
    wasTeamADown3PlusBack9, 
    wasTeamAUp3PlusBack9, 
    marginHistory
  };
}

/**
 * Builds the status and result objects from a match summary
 */
export function buildStatusAndResult(summary: MatchSummary): { status: MatchStatus; result: MatchResult } {
  const status: MatchStatus = { 
    leader: summary.leader, 
    margin: summary.margin, 
    thru: summary.thru, 
    dormie: summary.dormie, 
    closed: summary.closed,
    wasTeamADown3PlusBack9: summary.wasTeamADown3PlusBack9,
    wasTeamAUp3PlusBack9: summary.wasTeamAUp3PlusBack9,
    marginHistory: summary.marginHistory
  };
  
  const result: MatchResult = { 
    winner: summary.winner, 
    holesWonA: summary.holesWonA, 
    holesWonB: summary.holesWonB 
  };
  
  return { status, result };
}
