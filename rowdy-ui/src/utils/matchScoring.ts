/**
 * Match scoring utilities for the frontend
 * Shared logic for calculating hole winners, match status, and predictions
 */

import type { RoundFormat } from "../types";

// --- TYPES ---

/** Player in match with strokes received data */
export interface PlayerWithStrokes {
  playerId: string;
  strokesReceived: number[];
}

// --- HELPERS ---

function clamp01(n: unknown): 0 | 1 {
  return Number(n) === 1 ? 1 : 0;
}

function isNum(n: any): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function to2(arr: any[]): [number | null, number | null] {
  return [isNum(arr?.[0]) ? arr[0] : null, isNum(arr?.[1]) ? arr[1] : null];
}

// --- HOLE INPUT INTERFACE ---

/**
 * Generic hole input structure that works with both saved match data
 * and pending/simulated inputs
 */
export interface HoleInput {
  // Scramble format
  teamAGross?: number | null;
  teamBGross?: number | null;
  // Singles format
  teamAPlayerGross?: number | null;
  teamBPlayerGross?: number | null;
  // Best Ball / Shamble formats
  teamAPlayersGross?: (number | null)[];
  teamBPlayersGross?: (number | null)[];
}

// --- HOLE DECISION ---

export type HoleResult = "teamA" | "teamB" | "AS" | null;

/**
 * Determines the winner of a single hole based on format and scores
 * @param format - The match format
 * @param holeIndex - 0-based hole index (0-17)
 * @param input - The hole input data
 * @param teamAPlayers - Team A player data (for strokes)
 * @param teamBPlayers - Team B player data (for strokes)
 * @returns "teamA" | "teamB" | "AS" (all square) | null (incomplete)
 */
export function decideHole(
  format: RoundFormat,
  holeIndex: number,
  input: HoleInput | undefined,
  teamAPlayers?: PlayerWithStrokes[],
  teamBPlayers?: PlayerWithStrokes[]
): HoleResult {
  if (!input) return null;
  
  if (format === "twoManScramble") {
    const a = input.teamAGross;
    const b = input.teamBGross;
    if (!isNum(a) || !isNum(b)) return null;
    return a < b ? "teamA" : b < a ? "teamB" : "AS";
  }
  
  if (format === "singles") {
    const aG = input.teamAPlayerGross;
    const bG = input.teamBPlayerGross;
    if (!isNum(aG) || !isNum(bG)) return null;
    const aNet = aG - clamp01(teamAPlayers?.[0]?.strokesReceived?.[holeIndex]);
    const bNet = bG - clamp01(teamBPlayers?.[0]?.strokesReceived?.[holeIndex]);
    return aNet < bNet ? "teamA" : bNet < aNet ? "teamB" : "AS";
  }
  
  if (format === "twoManShamble") {
    // Shamble: individual player scores, GROSS only (no strokes applied)
    const aArr = to2(input.teamAPlayersGross || []);
    const bArr = to2(input.teamBPlayersGross || []);
    if (aArr[0] == null || aArr[1] == null || bArr[0] == null || bArr[1] == null) return null;
    
    const aBest = Math.min(aArr[0], aArr[1]);
    const bBest = Math.min(bArr[0], bArr[1]);
    return aBest < bBest ? "teamA" : bBest < aBest ? "teamB" : "AS";
  }
  
  // Best Ball: individual player scores with NET calculation
  const aArr = to2(input.teamAPlayersGross || []);
  const bArr = to2(input.teamBPlayersGross || []);
  if (aArr[0] == null || aArr[1] == null || bArr[0] == null || bArr[1] == null) return null;

  const getNet = (g: number, pIdx: number, teamArr: PlayerWithStrokes[] | undefined) => {
    const s = clamp01(teamArr?.[pIdx]?.strokesReceived?.[holeIndex]);
    return g - s;
  };
  
  const aBest = Math.min(getNet(aArr[0], 0, teamAPlayers), getNet(aArr[1], 1, teamAPlayers));
  const bBest = Math.min(getNet(bArr[0], 0, teamBPlayers), getNet(bArr[1], 1, teamBPlayers));
  
  return aBest < bBest ? "teamA" : bBest < aBest ? "teamB" : "AS";
}

// --- MATCH SUMMARY ---

export interface MatchSummary {
  holesWonA: number;
  holesWonB: number;
  thru: number;
  leader: "teamA" | "teamB" | null;
  margin: number;
  dormie: boolean;
  closed: boolean;
  winner: "teamA" | "teamB" | "AS";
}

/**
 * Generic hole data structure for summarization
 */
export interface HoleData {
  num: number;        // 1-based hole number
  input?: HoleInput;  // The hole input data
}

/**
 * Summarizes match state from an array of hole data
 * Works with both saved match data and simulated/pending states
 */
export function summarizeMatch(
  format: RoundFormat,
  holes: HoleData[],
  teamAPlayers?: PlayerWithStrokes[],
  teamBPlayers?: PlayerWithStrokes[]
): MatchSummary {
  let holesWonA = 0;
  let holesWonB = 0;
  let thru = 0;
  
  for (const hole of holes) {
    const holeIndex = hole.num - 1; // Convert to 0-based for strokes lookup
    const result = decideHole(format, holeIndex, hole.input, teamAPlayers, teamBPlayers);
    
    if (result === null) continue;
    
    thru = Math.max(thru, hole.num);
    if (result === "teamA") holesWonA++;
    else if (result === "teamB") holesWonB++;
  }
  
  const diff = holesWonA - holesWonB;
  const leader = diff > 0 ? "teamA" : diff < 0 ? "teamB" : null;
  const margin = Math.abs(diff);
  const holesLeft = 18 - thru;
  
  // Match closes when margin > holesLeft OR all 18 holes complete
  const closed = (leader !== null && margin > holesLeft) || thru === 18;
  const dormie = leader !== null && margin === holesLeft && thru < 18;
  const winner: "teamA" | "teamB" | "AS" = 
    thru === 18 && holesWonA === holesWonB 
      ? "AS" 
      : (leader ?? "AS");
  
  return { holesWonA, holesWonB, thru, leader, margin, dormie, closed, winner };
}

// --- PREDICTION HELPERS ---

export interface ClosePrediction {
  wouldClose: boolean;
  winner: "teamA" | "teamB" | "AS" | null;
  margin: number;
  thru: number;
}

/**
 * Predicts if a score change would close the match
 * Creates a simulated holes array with the pending input and calculates the result
 */
export function predictClose(
  holes: HoleData[],
  pendingHoleNum: number,
  pendingInput: HoleInput,
  format: RoundFormat,
  teamAPlayers?: PlayerWithStrokes[],
  teamBPlayers?: PlayerWithStrokes[]
): ClosePrediction {
  // Create simulated holes with the pending input
  const simulatedHoles = holes.map(h => 
    h.num === pendingHoleNum 
      ? { ...h, input: pendingInput }
      : h
  );
  
  const summary = summarizeMatch(format, simulatedHoles, teamAPlayers, teamBPlayers);
  
  return {
    wouldClose: summary.closed,
    winner: summary.closed ? summary.winner : null,
    margin: summary.margin,
    thru: summary.thru,
  };
}

// --- RUNNING STATUS HELPERS ---

export interface RunningHoleStatus {
  status: string;        // "AS", "1UP", "2UP", etc. or "" if incomplete
  leader: "A" | "B" | null;
}

/**
 * Calculates the running match status after each hole
 * Returns array of 18 status objects showing the match state after each hole
 */
export function computeRunningStatus(
  holes: HoleData[],
  format: RoundFormat,
  teamAPlayers?: PlayerWithStrokes[],
  teamBPlayers?: PlayerWithStrokes[]
): RunningHoleStatus[] {
  const result: RunningHoleStatus[] = [];
  let teamAUp = 0;  // Positive = Team A ahead, Negative = Team B ahead
  
  for (let i = 0; i < 18; i++) {
    const hole = holes[i];
    const holeIndex = hole.num - 1; // 0-based for strokes lookup
    
    // Use shared decideHole to determine winner
    const holeResult = decideHole(format, holeIndex, hole.input, teamAPlayers, teamBPlayers);
    
    // Update running total
    if (holeResult === "teamA") teamAUp++;
    else if (holeResult === "teamB") teamAUp--;
    
    // Format the status
    let status: string;
    let leader: "A" | "B" | null;
    
    if (holeResult === null) {
      // Hole not complete
      status = "";
      leader = null;
    } else if (teamAUp === 0) {
      status = "AS";
      leader = null;
    } else if (teamAUp > 0) {
      status = `${teamAUp}UP`;
      leader = "A";
    } else {
      status = `${Math.abs(teamAUp)}UP`;
      leader = "B";
    }
    
    result.push({ status, leader });
  }
  
  return result;
}
