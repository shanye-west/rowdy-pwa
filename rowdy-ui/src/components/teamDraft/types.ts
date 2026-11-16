import type { DraftTeamKey, TeamDraftTier } from "../../types";

/** Small lookups the team-draft components render from (built by the route). */
export interface TeamDraftMeta {
  nameOf: (pid: string) => string;
  /** Pool handicap index, or null when none was posted. */
  hcpOf: (pid: string) => number | null;
  tierOf: (pid: string) => TeamDraftTier | undefined;
  teamName: (team: DraftTeamKey) => string;
  teamColor: (team: DraftTeamKey) => string;
  teamLogo: (team: DraftTeamKey) => string | undefined;
}

export function formatHcp(h: number | null): string {
  return h == null ? "—" : h.toFixed(1);
}
