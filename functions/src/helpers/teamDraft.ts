/**
 * Pure state machine for the captains' TEAM draft (`teamDrafts/{tournamentId}`):
 * the two captains snake-draft the tournament's draft pool onto their teams.
 * No Firestore here so it can be unit-tested; the teamDraftOps callables read
 * and write the doc and delegate every turn/validation rule to these functions.
 *
 * Rules:
 *  - The pool is ranked by handicap index (lowest first, ties by player id, no
 *    handicap last) and cut into 4 equal tiers A–D.
 *  - Each team ends with exactly `perTeamPerTier` players from every tier
 *    (pool / 8 — 2 each for a 16-player field). The captains are pre-placed
 *    ("keepers") and count toward their own tier.
 *  - Snake order: first-pick team, then two each, … (T1, T2, T2, T1, T1, …).
 *  - Tier lock: a team may only pick from a tier it hasn't filled yet. That's
 *    enough to guarantee the draft can always finish — whenever a team still
 *    needs k players from a tier, at least k of that tier are still available.
 */

export type TeamKey = "teamA" | "teamB";
export type TeamDraftTier = "A" | "B" | "C" | "D";
export type TeamDraftPhase = "drafting" | "review" | "finalized";

export const TEAM_DRAFT_TIERS: readonly TeamDraftTier[] = ["A", "B", "C", "D"];

export interface TeamDraftPick {
  team: TeamKey;
  playerId: string;
}

export interface TeamDraftTurn {
  pickIndex: number; // 0-based index into the snake order
  team: TeamKey;
}

/** The slice of the draft doc the state machine reads and rewrites. */
export interface TeamDraftState {
  firstPickTeam: TeamKey;
  /** Every player in the draft (keepers included). */
  poolIds: string[];
  tierByPlayer: Record<string, TeamDraftTier>;
  perTeamPerTier: number;
  /** Pre-placed players (the captains), not part of the snake. */
  keepers: { teamA: string[]; teamB: string[] };
  picks: TeamDraftPick[];
  totalPicks: number;
  turn: TeamDraftTurn | null;
  phase: TeamDraftPhase;
}

/** Validation failure with a stable `code` the callables map to HttpsError. */
export class TeamDraftError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "TeamDraftError";
  }
}

export function otherTeamKey(team: TeamKey): TeamKey {
  return team === "teamA" ? "teamB" : "teamA";
}

/**
 * Rank the pool by handicap (lowest first; ties broken by player id so the cut
 * is deterministic; players with no handicap last) and split it into 4 equal
 * tiers. The pool size must be divisible by 8 so both teams get the same count
 * from every tier.
 */
export function buildTiers(handicapByPlayer: Record<string, number | null | undefined>): {
  rankedIds: string[];
  tierByPlayer: Record<string, TeamDraftTier>;
  perTeamPerTier: number;
} {
  const ids = Object.keys(handicapByPlayer);
  if (ids.length === 0 || ids.length % 8 !== 0) {
    throw new TeamDraftError(
      "bad-pool-size",
      `The draft pool has ${ids.length} players — it needs a multiple of 8 (4 tiers split evenly between 2 teams).`
    );
  }
  const rankedIds = [...ids].sort((a, b) => {
    const ha = handicapByPlayer[a];
    const hb = handicapByPlayer[b];
    const na = typeof ha === "number" ? ha : Infinity;
    const nb = typeof hb === "number" ? hb : Infinity;
    if (na !== nb) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const tierSize = ids.length / 4;
  const tierByPlayer: Record<string, TeamDraftTier> = {};
  rankedIds.forEach((pid, i) => {
    tierByPlayer[pid] = TEAM_DRAFT_TIERS[Math.floor(i / tierSize)];
  });
  return { rankedIds, tierByPlayer, perTeamPerTier: tierSize / 2 };
}

/** Which team owns pick `i` (0-based) in a snake draft. */
export function snakeTeam(firstPickTeam: TeamKey, pickIndex: number): TeamKey {
  const round = Math.floor(pickIndex / 2);
  const firstInRound = round % 2 === 0 ? firstPickTeam : otherTeamKey(firstPickTeam);
  return pickIndex % 2 === 0 ? firstInRound : otherTeamKey(firstInRound);
}

/** A team's players so far: keepers + its picks, in draft order. */
export function teamPlayerIds(state: Pick<TeamDraftState, "keepers" | "picks">, team: TeamKey): string[] {
  return [...state.keepers[team], ...state.picks.filter((p) => p.team === team).map((p) => p.playerId)];
}

/** Players still on the board (not a keeper, not picked). */
export function availablePlayerIds(state: Pick<TeamDraftState, "poolIds" | "keepers" | "picks">): string[] {
  const taken = new Set([...state.keepers.teamA, ...state.keepers.teamB, ...state.picks.map((p) => p.playerId)]);
  return state.poolIds.filter((id) => !taken.has(id));
}

/** How many players a team holds in each tier. */
export function tierCounts(
  state: Pick<TeamDraftState, "keepers" | "picks" | "tierByPlayer">,
  team: TeamKey
): Record<TeamDraftTier, number> {
  const counts: Record<TeamDraftTier, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const pid of teamPlayerIds(state, team)) {
    const t = state.tierByPlayer[pid];
    if (t) counts[t]++;
  }
  return counts;
}

/** Why `team` can't take `playerId` right now (ignoring whose turn it is), or null. */
export function pickBlockReason(state: TeamDraftState, team: TeamKey, playerId: string): string | null {
  if (!availablePlayerIds(state).includes(playerId)) return "Already drafted";
  const tier = state.tierByPlayer[playerId];
  if (!tier) return "Not in the draft pool";
  if (tierCounts(state, team)[tier] >= state.perTeamPerTier) {
    return `Tier ${tier} is full for this team`;
  }
  return null;
}

/**
 * Validate the initial setup (keepers) and build a fresh drafting state.
 * Keepers must be in the pool, on one team each, and fit their tier caps.
 */
export function initTeamDraft(input: {
  handicapByPlayer: Record<string, number | null | undefined>;
  keepers: { teamA: string[]; teamB: string[] };
  firstPickTeam: TeamKey;
}): TeamDraftState & { rankedIds: string[] } {
  const { rankedIds, tierByPlayer, perTeamPerTier } = buildTiers(input.handicapByPlayer);
  const keepers = { teamA: [...new Set(input.keepers.teamA)], teamB: [...new Set(input.keepers.teamB)] };
  for (const team of ["teamA", "teamB"] as const) {
    for (const pid of keepers[team]) {
      if (!tierByPlayer[pid]) {
        throw new TeamDraftError("keeper-not-in-pool", `Captain ${pid} isn't in the draft pool.`);
      }
      if (keepers[otherTeamKey(team)].includes(pid)) {
        throw new TeamDraftError("keeper-both-teams", `${pid} can't start on both teams.`);
      }
    }
  }
  const base = { keepers, picks: [] as TeamDraftPick[], tierByPlayer };
  for (const team of ["teamA", "teamB"] as const) {
    const counts = tierCounts(base, team);
    for (const t of TEAM_DRAFT_TIERS) {
      if (counts[t] > perTeamPerTier) {
        throw new TeamDraftError("keeper-tier-overflow", `Too many tier ${t} players pre-placed on ${team}.`);
      }
    }
  }
  const perTeam = rankedIds.length / 2;
  if (keepers.teamA.length !== keepers.teamB.length) {
    // Snake order hands each team the same number of picks, so the head start must match.
    throw new TeamDraftError("keeper-mismatch", "Both teams need the same number of pre-placed captains.");
  }
  const totalPicks = 2 * (perTeam - keepers.teamA.length);
  return {
    rankedIds,
    firstPickTeam: input.firstPickTeam,
    poolIds: rankedIds,
    tierByPlayer,
    perTeamPerTier,
    keepers,
    picks: [],
    totalPicks,
    turn: totalPicks > 0 ? { pickIndex: 0, team: input.firstPickTeam } : null,
    phase: totalPicks > 0 ? "drafting" : "review",
  };
}

/** Validate a pick against the turn and the tier lock; return the next state. */
export function applyTeamPick(state: TeamDraftState, team: TeamKey, playerId: string): TeamDraftState {
  if (state.phase !== "drafting" || !state.turn) {
    throw new TeamDraftError("not-drafting", "This draft is not accepting picks.");
  }
  if (team !== state.turn.team) {
    throw new TeamDraftError("not-your-turn", "It is not this team's turn.");
  }
  const reason = pickBlockReason(state, team, playerId);
  if (reason) throw new TeamDraftError("illegal-pick", reason);

  const picks = [...state.picks, { team, playerId }];
  const next = state.turn.pickIndex + 1;
  const done = next >= state.totalPicks;
  return {
    ...state,
    picks,
    turn: done ? null : { pickIndex: next, team: snakeTeam(state.firstPickTeam, next) },
    phase: done ? "review" : "drafting",
  };
}

/** Undo the most recent pick (works from review too). */
export function applyTeamUndo(state: TeamDraftState): TeamDraftState {
  if (state.phase === "finalized") throw new TeamDraftError("finalized", "This draft is already finalized.");
  if (state.picks.length === 0) throw new TeamDraftError("nothing-to-undo", "There is no pick to undo.");
  const picks = state.picks.slice(0, -1);
  const idx = picks.length;
  return { ...state, picks, turn: { pickIndex: idx, team: snakeTeam(state.firstPickTeam, idx) }, phase: "drafting" };
}

/** The finished draft as each team's rosterByTier (keepers first, then pick order). */
export function rosterByTierFromDraft(
  state: Pick<TeamDraftState, "keepers" | "picks" | "tierByPlayer">,
  team: TeamKey
): Record<TeamDraftTier, string[]> {
  const out: Record<TeamDraftTier, string[]> = { A: [], B: [], C: [], D: [] };
  for (const pid of teamPlayerIds(state, team)) {
    const t = state.tierByPlayer[pid];
    if (t) out[t].push(pid);
  }
  return out;
}
