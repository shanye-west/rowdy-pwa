/**
 * Pure snake-draft state machine for round pairings. No Firestore here so it
 * can be unit-tested in isolation; the draftOps callables read/write the doc
 * and delegate all turn/validation logic to these functions.
 *
 * Snake order: the captain who wins the coin flip (`firstPickTeam`) nominates
 * match 1; the opponent responds (choosing who to face it) and then nominates
 * match 2; and so on. So the *nominating* team alternates each match, and the
 * actor sequence is T1, T2, T2, T1, T1, T2, … (classic snake).
 */

import type { RoundFormat } from "../types.js";

export type DraftTeam = "teamA" | "teamB";
export type DraftPhase = "drafting" | "review" | "finalized";
export type DraftTier = "A" | "B" | "C" | "D";

export interface DraftMatch {
  matchNumber: number; // 1-based, equals draft order
  nominatedBy: DraftTeam;
  teamAPlayers: string[] | null;
  teamBPlayers: string[] | null;
}

export interface DraftTurn {
  matchIndex: number;
  awaiting: "nomination" | "response";
  team: DraftTeam;
}

/** The slice of the draft doc the state machine reads and rewrites. */
export interface DraftState {
  playersPerSide: number;
  totalMatches: number;
  firstPickTeam: DraftTeam;
  available: { teamA: string[]; teamB: string[] };
  tierByPlayer: Record<string, string>;
  matches: DraftMatch[];
  turn: DraftTurn | null;
  phase: DraftPhase;
}

/** Validation failure with a stable `code` the callables map to HttpsError. */
export class DraftError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DraftError";
  }
}

export function otherTeam(team: DraftTeam): DraftTeam {
  return team === "teamA" ? "teamB" : "teamA";
}

/** Players per side for a format. Only `playersPerSide === 2` gets the tier rule. */
export function draftPlayersPerSide(format: RoundFormat): number {
  if (format === "singles") return 1;
  if (format === "fourManScramble") return 4;
  return 2; // twoManBestBall / twoManShamble / twoManScramble
}

/** Which team nominates match `i` (0-based): alternates each match. */
export function nominatingTeam(firstPickTeam: DraftTeam, matchIndex: number): DraftTeam {
  return matchIndex % 2 === 0 ? firstPickTeam : otherTeam(firstPickTeam);
}

/** Which team responds to match `i` (the opponent of the nominator). */
export function respondingTeam(firstPickTeam: DraftTeam, matchIndex: number): DraftTeam {
  return otherTeam(nominatingTeam(firstPickTeam, matchIndex));
}

/** Empty match slots for a fresh draft, with `nominatedBy` precomputed. */
export function buildInitialMatches(totalMatches: number, firstPickTeam: DraftTeam): DraftMatch[] {
  return Array.from({ length: totalMatches }, (_, i) => ({
    matchNumber: i + 1,
    nominatedBy: nominatingTeam(firstPickTeam, i),
    teamAPlayers: null,
    teamBPlayers: null,
  }));
}

export function initialTurn(firstPickTeam: DraftTeam): DraftTurn {
  return { matchIndex: 0, awaiting: "nomination", team: firstPickTeam };
}

/** Player ids already placed for a team across all matches. */
export function placedIds(matches: DraftMatch[], team: DraftTeam): Set<string> {
  const key = team === "teamA" ? "teamAPlayers" : "teamBPlayers";
  const ids = new Set<string>();
  for (const m of matches) {
    const slot = m[key];
    if (slot) for (const id of slot) ids.add(id);
  }
  return ids;
}

/** Remaining (not-yet-placed) available players for a team. */
export function remainingIds(state: DraftState, team: DraftTeam): string[] {
  const placed = placedIds(state.matches, team);
  return state.available[team].filter((id) => !placed.has(id));
}

/** Throws DraftError if a 2-player pair violates the A/A or D/D restriction. */
export function assertPairTiersAllowed(playerIds: string[], tierByPlayer: Record<string, string>): void {
  if (playerIds.length !== 2) return;
  const [t1, t2] = playerIds.map((id) => tierByPlayer[id]);
  if (t1 === "A" && t2 === "A") {
    throw new DraftError("tier-rule", "A pair cannot be two A-tier players.");
  }
  if (t1 === "D" && t2 === "D") {
    throw new DraftError("tier-rule", "A pair cannot be two D-tier players.");
  }
}

/**
 * Can a team's remaining (unplaced) players still be split into legal pairs?
 * Each pair allows at most one A-tier and at most one D-tier, so the remainder
 * is completable iff neither tier needs more than one slot per remaining pair:
 * `#A ≤ pairsLeft` and `#D ≤ pairsLeft`. (Necessary by pigeonhole; sufficient
 * because A's and D's can always be paired against neutrals or each other.)
 * Only meaningful for 2-player sides. Pure — adds no Firestore work.
 */
export function isPairableRemainder(
  remaining: string[],
  pairsLeft: number,
  tierByPlayer: Record<string, string>
): boolean {
  let a = 0;
  let d = 0;
  for (const id of remaining) {
    const t = tierByPlayer[id];
    if (t === "A") a++;
    else if (t === "D") d++;
  }
  return a <= pairsLeft && d <= pairsLeft;
}

/**
 * Validate a pick against the current turn and apply it, returning the next
 * state. Does not mutate the input. Throws DraftError on any violation.
 */
export function applyPick(state: DraftState, team: DraftTeam, playerIds: string[]): DraftState {
  if (state.phase !== "drafting" || !state.turn) {
    throw new DraftError("not-drafting", "This draft is not accepting picks.");
  }
  if (team !== state.turn.team) {
    throw new DraftError("not-your-turn", "It is not this team's turn.");
  }
  if (!Array.isArray(playerIds) || playerIds.length !== state.playersPerSide) {
    throw new DraftError("wrong-count", `Pick exactly ${state.playersPerSide} player(s).`);
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new DraftError("duplicate", "A player cannot be picked twice.");
  }

  const availableSet = new Set(state.available[team]);
  const placed = placedIds(state.matches, team);
  for (const id of playerIds) {
    if (!availableSet.has(id)) {
      throw new DraftError("unavailable", `Player ${id} is not available for this team.`);
    }
    if (placed.has(id)) {
      throw new DraftError("already-used", `Player ${id} has already been placed.`);
    }
  }

  if (state.playersPerSide === 2) {
    assertPairTiersAllowed(playerIds, state.tierByPlayer);
  }

  const { matchIndex, awaiting } = state.turn;
  const slotKey = team === "teamA" ? "teamAPlayers" : "teamBPlayers";
  const matches = state.matches.map((m, i) =>
    i === matchIndex ? { ...m, [slotKey]: [...playerIds] } : m
  );

  // Look-ahead: a pair that's legal on its own can still corner the team — e.g.
  // leaving two A-tier (or two D-tier) players who'd be forced together in the
  // last match. Reject any pick whose remainder can't be completed legally.
  if (state.playersPerSide === 2) {
    const remaining = remainingIds({ ...state, matches }, team);
    if (!isPairableRemainder(remaining, remaining.length / 2, state.tierByPlayer)) {
      throw new DraftError(
        "tier-strand",
        "That pick would strand players who can't be paired legally — too many A- or D-tier left for the remaining matches."
      );
    }
  }

  let turn: DraftTurn | null;
  let phase: DraftPhase = state.phase;
  if (awaiting === "nomination") {
    // Nomination placed → opponent now responds to this same match.
    turn = { matchIndex, awaiting: "response", team: otherTeam(team) };
  } else {
    // Response placed → this match is complete; move to the next match.
    const next = matchIndex + 1;
    if (next >= state.totalMatches) {
      turn = null;
      phase = "review";
    } else {
      turn = { matchIndex: next, awaiting: "nomination", team: nominatingTeam(state.firstPickTeam, next) };
    }
  }

  return { ...state, matches, turn, phase };
}

/**
 * The turn that produced the most recent placement (the action `applyUndo`
 * would revert), or null if nothing has been placed yet. Callables use the
 * `.team` to stop one captain undoing the other's pick.
 */
export function lastPlacement(state: DraftState): DraftTurn | null {
  if (state.phase === "review" || !state.turn) {
    // The last action was the response of the final match.
    const last = state.totalMatches - 1;
    return { matchIndex: last, awaiting: "response", team: respondingTeam(state.firstPickTeam, last) };
  }
  if (state.turn.awaiting === "nomination") {
    if (state.turn.matchIndex === 0) return null;
    const prev = state.turn.matchIndex - 1;
    return { matchIndex: prev, awaiting: "response", team: respondingTeam(state.firstPickTeam, prev) };
  }
  // Awaiting a response → the last action was this match's nomination.
  return {
    matchIndex: state.turn.matchIndex,
    awaiting: "nomination",
    team: nominatingTeam(state.firstPickTeam, state.turn.matchIndex),
  };
}

/**
 * Undo the most recent placement, returning the prior state. Throws if nothing
 * has been placed yet. Works from `review` too (rewinds the final response).
 */
export function applyUndo(state: DraftState): DraftState {
  const revert = lastPlacement(state);
  if (!revert) {
    throw new DraftError("nothing-to-undo", "There is no pick to undo.");
  }

  const slotKey = revert.team === "teamA" ? "teamAPlayers" : "teamBPlayers";
  const matches = state.matches.map((m, i) =>
    i === revert.matchIndex ? { ...m, [slotKey]: null } : m
  );

  return { ...state, matches, turn: revert, phase: "drafting" };
}
