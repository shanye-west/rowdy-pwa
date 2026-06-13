/**
 * Shared view-model passed from the Pairings route down to the draft
 * sub-components. The route owns the data (round/tournament/course/players) and
 * exposes these small lookups so children don't each re-derive them.
 */

import type { DraftTeamKey, PlayerDoc } from "../../types";
import type { Tier } from "../../utils/roster";

export interface PairingsMeta {
  players: PlayerDoc[];
  /** Display name for a player id (falls back to the id). */
  nameOf: (pid: string) => string;
  /** Course handicap for a player id, or null when it can't be computed. */
  chOf: (pid: string) => number | null;
  /** Tier (A–D) for a player id, or undefined when unknown. */
  tierOf: (pid: string) => Tier | undefined;
  /** Team display name. */
  teamName: (team: DraftTeamKey) => string;
  /** Team color (css value), honoring the active theme. */
  teamColor: (team: DraftTeamKey) => string;
  /** True for scramble/shamble: course handicaps shown for reference only. */
  grossOnly: boolean;
}
