/**
 * Client mirror of functions/src/helpers/teamDraft.ts — just enough to render
 * the board and pre-disable illegal picks. The server re-validates every pick.
 */

import type { DraftTeamKey, TeamDraftDoc, TeamDraftTier } from "../types";

export const TEAM_DRAFT_TIERS: TeamDraftTier[] = ["A", "B", "C", "D"];

export function otherTeamKey(team: DraftTeamKey): DraftTeamKey {
  return team === "teamA" ? "teamB" : "teamA";
}

/** Which team owns pick `i` (0-based) in the snake: 1-2-2-1-1-2… */
export function snakeTeam(firstPickTeam: DraftTeamKey, pickIndex: number): DraftTeamKey {
  const round = Math.floor(pickIndex / 2);
  const firstInRound = round % 2 === 0 ? firstPickTeam : otherTeamKey(firstPickTeam);
  return pickIndex % 2 === 0 ? firstInRound : otherTeamKey(firstInRound);
}

/**
 * Pre-draft tier preview from the pool — same ranking the server freezes at
 * start (handicap ascending, ties by id, no handicap last, 4 equal tiers).
 */
export function previewTiers(pool: Record<string, number | null | undefined>): Record<string, TeamDraftTier> {
  const ids = Object.keys(pool);
  const ranked = [...ids].sort((a, b) => {
    const ha = pool[a];
    const hb = pool[b];
    const na = typeof ha === "number" ? ha : Infinity;
    const nb = typeof hb === "number" ? hb : Infinity;
    if (na !== nb) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const size = Math.max(1, Math.ceil(ids.length / 4));
  const out: Record<string, TeamDraftTier> = {};
  ranked.forEach((pid, i) => {
    out[pid] = TEAM_DRAFT_TIERS[Math.min(Math.floor(i / size), 3)];
  });
  return out;
}

/** A team's players so far: captain(s) first, then picks in order. */
export function teamPlayerIds(draft: TeamDraftDoc, team: DraftTeamKey): string[] {
  return [...draft.keepers[team], ...draft.picks.filter((p) => p.team === team).map((p) => p.playerId)];
}

/** Real (non-auto) picks only, in order. */
export function realPicks(draft: TeamDraftDoc): TeamDraftDoc["picks"] {
  return draft.picks.filter((p) => !p.auto);
}

export function availablePlayerIds(draft: TeamDraftDoc): string[] {
  const taken = new Set([...draft.keepers.teamA, ...draft.keepers.teamB, ...draft.picks.map((p) => p.playerId)]);
  return draft.poolIds.filter((id) => !taken.has(id));
}

export function tierCounts(draft: TeamDraftDoc, team: DraftTeamKey): Record<TeamDraftTier, number> {
  const counts: Record<TeamDraftTier, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const pid of teamPlayerIds(draft, team)) {
    const t = draft.tierByPlayer[pid];
    if (t) counts[t]++;
  }
  return counts;
}

/** Why `team` can't take `pid` (ignoring turn), or null if it's legal. */
export function pickBlockReason(draft: TeamDraftDoc, team: DraftTeamKey, pid: string): string | null {
  const tier = draft.tierByPlayer[pid];
  if (!tier) return "Not in the draft pool";
  if (tierCounts(draft, team)[tier] >= draft.perTeamPerTier) return `Tier ${tier} is full for this team`;
  return null;
}
