import type { TierMap, TournamentDoc } from "../types";

const TIERS = ["A", "B", "C", "D"] as const;

/** Flatten one team's rosterByTier into a player-id list. */
export function tierPlayerIds(roster: TierMap | undefined): string[] {
  return TIERS.flatMap((tier) => roster?.[tier] ?? []);
}

/** All player ids rostered on either team of a tournament. */
export function rosterPlayerIds(
  tournament: Pick<TournamentDoc, "teamA" | "teamB"> | null | undefined
): string[] {
  if (!tournament) return [];
  return [
    ...tierPlayerIds(tournament.teamA?.rosterByTier),
    ...tierPlayerIds(tournament.teamB?.rosterByTier),
  ];
}

export type Tier = (typeof TIERS)[number];

/** Flatten one team's rosterByTier into a playerId → tier map. */
export function tierLookupForTeam(roster: TierMap | undefined): Record<string, Tier> {
  const out: Record<string, Tier> = {};
  for (const tier of TIERS) for (const pid of roster?.[tier] ?? []) out[pid] = tier;
  return out;
}

/** playerId → tier across both teams of a tournament (used for the A/A·D/D rule). */
export function playerTierLookup(
  tournament: Pick<TournamentDoc, "teamA" | "teamB"> | null | undefined
): Record<string, Tier> {
  return {
    ...tierLookupForTeam(tournament?.teamA?.rosterByTier),
    ...tierLookupForTeam(tournament?.teamB?.rosterByTier),
  };
}
