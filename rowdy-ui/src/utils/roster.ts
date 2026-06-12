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
