/**
 * Match setup helper functions
 * Used by triggers to initialize and normalize match data
 */

import type { RoundFormat, HoleInput } from "../types";

/**
 * Returns the number of players per side for a given format
 */
export function playersPerSide(format: RoundFormat): number {
  return format === "singles" ? 1 : 2;
}

/**
 * Creates empty holes structure for a given format
 */
export function emptyHolesFor(format: RoundFormat): Record<string, { input: HoleInput }> {
  const holes: Record<string, { input: HoleInput }> = {};
  for (let i = 1; i <= 18; i++) {
    const k = String(i);
    if (format === "twoManScramble") {
      // Scramble: one score per team + drive tracking
      holes[k] = { input: { teamAGross: null, teamBGross: null, teamADrive: null, teamBDrive: null } };
    } else if (format === "singles") {
      holes[k] = { input: { teamAPlayerGross: null, teamBPlayerGross: null } };
    } else if (format === "twoManShamble") {
      // Shamble: individual player scores + drive tracking
      holes[k] = { input: { teamAPlayersGross: [null, null], teamBPlayersGross: [null, null], teamADrive: null, teamBDrive: null } };
    } else {
      // Best Ball: individual player scores
      holes[k] = { input: { teamAPlayersGross: [null, null], teamBPlayersGross: [null, null] } };
    }
  }
  return holes;
}

/**
 * Returns a default status object for a new match
 */
export function defaultStatus() {
  return { leader: null, margin: 0, thru: 0, dormie: false, closed: false };
}

/**
 * Returns an array of 18 zeros (for strokesReceived initialization)
 */
export function zeros18(): number[] {
  return Array.from({ length: 18 }, () => 0);
}

/**
 * Ensures a team side has the correct number of players with valid strokesReceived arrays
 */
export function ensureSideSize(side: any, count: number) {
  const make = () => ({ playerId: "", strokesReceived: zeros18() });
  if (!Array.isArray(side)) return Array.from({ length: count }, make);
  const trimmed = side.slice(0, count).map((p: any) => ({
    playerId: typeof p?.playerId === "string" ? p.playerId : "",
    strokesReceived: Array.isArray(p?.strokesReceived) && p.strokesReceived.length === 18 ? p.strokesReceived : zeros18(),
  }));
  while (trimmed.length < count) trimmed.push(make());
  return trimmed;
}

/**
 * Normalizes existing holes data to match the expected format structure
 */
export function normalizeHoles(existing: Record<string, any> | undefined, format: RoundFormat) {
  const desired = emptyHolesFor(format);
  const holes: Record<string, any> = { ...(existing || {}) };
  
  for (let i = 1; i <= 18; i++) {
    const k = String(i);
    const want = desired[k];
    const ex = holes[k];
    if (!ex || typeof ex !== "object") { holes[k] = want; continue; }
    const exInput = ex.input ?? {};
    
    if (format === "twoManScramble") {
      // Scramble: one score per team + drive tracking
      const a = exInput.teamAGross ?? null;
      const b = exInput.teamBGross ?? null;
      const aDrive = exInput.teamADrive ?? null;
      const bDrive = exInput.teamBDrive ?? null;
      holes[k] = { input: { teamAGross: a, teamBGross: b, teamADrive: aDrive, teamBDrive: bDrive } };
    } else if (format === "singles") {
      let a = exInput.teamAPlayerGross;
      let b = exInput.teamBPlayerGross;
      if (a == null && Array.isArray(exInput.teamAPlayersGross)) a = exInput.teamAPlayersGross[0] ?? null;
      if (b == null && Array.isArray(exInput.teamBPlayersGross)) b = exInput.teamBPlayersGross[0] ?? null;
      holes[k] = { input: { teamAPlayerGross: a ?? null, teamBPlayerGross: b ?? null } };
    } else if (format === "twoManShamble") {
      // Shamble: individual player scores + drive tracking
      const aArr = Array.isArray(exInput.teamAPlayersGross) ? exInput.teamAPlayersGross : [null, null];
      const bArr = Array.isArray(exInput.teamBPlayersGross) ? exInput.teamBPlayersGross : [null, null];
      const norm2 = (arr: any[]) => [arr[0] ?? null, arr[1] ?? null];
      const aDrive = exInput.teamADrive ?? null;
      const bDrive = exInput.teamBDrive ?? null;
      holes[k] = { input: { teamAPlayersGross: norm2(aArr), teamBPlayersGross: norm2(bArr), teamADrive: aDrive, teamBDrive: bDrive } };
    } else {
      // Best Ball: individual player scores
      const aArr = Array.isArray(exInput.teamAPlayersGross) ? exInput.teamAPlayersGross : [null, null];
      const bArr = Array.isArray(exInput.teamBPlayersGross) ? exInput.teamBPlayersGross : [null, null];
      const norm2 = (arr: any[]) => [arr[0] ?? null, arr[1] ?? null];
      holes[k] = { input: { teamAPlayersGross: norm2(aArr), teamBPlayersGross: norm2(bArr) } };
    }
  }
  return holes;
}
