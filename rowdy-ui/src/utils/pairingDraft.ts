/**
 * Client-side helpers for the pairings draft UI. The server (draftOps) is the
 * source of truth for turns and validation; these mirror just enough to drive
 * the board — which players remain, and whether a proposed 2-player pair would
 * break the A/A or D/D rule — so we can disable invalid picks before calling.
 */

import type { DraftMatch, DraftTeamKey, PairingDraftDoc } from "../types";

export function otherTeam(team: DraftTeamKey): DraftTeamKey {
  return team === "teamA" ? "teamB" : "teamA";
}

/** Which team nominates match `i` (0-based): alternates each match. */
export function nominatingTeam(firstPickTeam: DraftTeamKey, matchIndex: number): DraftTeamKey {
  return matchIndex % 2 === 0 ? firstPickTeam : otherTeam(firstPickTeam);
}

/** Which team responds to match `i` (opponent of the nominator). */
export function respondingTeam(firstPickTeam: DraftTeamKey, matchIndex: number): DraftTeamKey {
  return otherTeam(nominatingTeam(firstPickTeam, matchIndex));
}

/**
 * The team whose pick would be reverted by an undo, or null if nothing has been
 * placed yet. Mirrors the server's lastPlacement so the UI can show Undo only
 * to whoever made the last pick (or an admin).
 */
export function lastPlacementTeam(draft: PairingDraftDoc): DraftTeamKey | null {
  if (draft.phase === "review" || !draft.turn) {
    return respondingTeam(draft.firstPickTeam, draft.totalMatches - 1);
  }
  if (draft.turn.awaiting === "nomination") {
    if (draft.turn.matchIndex === 0) return null;
    return respondingTeam(draft.firstPickTeam, draft.turn.matchIndex - 1);
  }
  return nominatingTeam(draft.firstPickTeam, draft.turn.matchIndex);
}

/** Player ids already placed for a team across all matches. */
export function placedIds(matches: DraftMatch[], team: DraftTeamKey): Set<string> {
  const key = team === "teamA" ? "teamAPlayers" : "teamBPlayers";
  const ids = new Set<string>();
  for (const m of matches) {
    const slot = m[key];
    if (slot) for (const id of slot) ids.add(id);
  }
  return ids;
}

/** Available-but-not-yet-placed player ids for a team, in roster order. */
export function remainingPlayerIds(draft: PairingDraftDoc, team: DraftTeamKey): string[] {
  const placed = placedIds(draft.matches, team);
  return draft.available[team].filter((id) => !placed.has(id));
}

/**
 * Reason a proposed pair is illegal, or null if it's fine. Only applies to
 * 2-player sides (best ball / shamble / scramble).
 */
export function pairTierViolation(
  playerIds: string[],
  tierByPlayer: Record<string, "A" | "B" | "C" | "D">
): string | null {
  if (playerIds.length !== 2) return null;
  const [t1, t2] = playerIds.map((id) => tierByPlayer[id]);
  if (t1 === "A" && t2 === "A") return "Can't pair two A-tier players";
  if (t1 === "D" && t2 === "D") return "Can't pair two D-tier players";
  return null;
}

/**
 * Reason adding `candidateId` to the current `selected` set would be illegal, or
 * null if the pick is allowed. Lets the picker pre-disable the second A (or
 * second D) instead of only erroring after the fact. Only meaningful for
 * 2-player sides; for any other size nothing is blocked here.
 */
export function wouldViolateTier(
  selected: string[],
  candidateId: string,
  tierByPlayer: Record<string, "A" | "B" | "C" | "D">
): string | null {
  if (selected.includes(candidateId)) return null; // toggling off is always fine
  const tier = tierByPlayer[candidateId];
  if (tier !== "A" && tier !== "D") return null;
  const clashes = selected.some((id) => tierByPlayer[id] === tier);
  if (!clashes) return null;
  return tier === "A" ? "Can't pair two A-tier players" : "Can't pair two D-tier players";
}
