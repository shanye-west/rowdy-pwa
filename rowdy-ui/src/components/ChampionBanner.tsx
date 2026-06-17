import OfflineImage from "./OfflineImage";
import type { TournamentDoc } from "../types";

interface ChampionBannerProps {
  tournament: TournamentDoc;
  teamAConfirmed: number;
  teamBConfirmed: number;
  totalPointsAvailable: number;
}

/**
 * Champions banner shown once a tournament is decided. A winner is declared when
 * either:
 *   - a team has clinched on points (confirmed >= points-to-win, i.e. a majority
 *     that the other team can no longer catch), or
 *   - the tournament finished tied after regulation and the admin designated a
 *     winner via `tournament.tiebreakerWinner` (Admin → Tournament Settings).
 *
 * Renders nothing while the tournament is still undecided or ended in an
 * unbroken tie, so it's safe to drop in unconditionally — including on the live
 * home view, where it only appears after the cup is actually won.
 */
export default function ChampionBanner({
  tournament,
  teamAConfirmed,
  teamBConfirmed,
  totalPointsAvailable,
}: ChampionBannerProps) {
  const tiebreaker = tournament.tiebreakerWinner;
  // Majority needed to clinch: half the points plus a half-point.
  const pointsToWin = totalPointsAvailable > 0 ? totalPointsAvailable / 2 + 0.5 : null;

  let winnerKey: "teamA" | "teamB" | null = null;
  let viaTiebreaker = false;

  if (tiebreaker === "teamA" || tiebreaker === "teamB") {
    // Admin-designated winner of a regulation tie takes precedence.
    winnerKey = tiebreaker;
    viaTiebreaker = true;
  } else if (pointsToWin !== null) {
    if (teamAConfirmed >= pointsToWin) winnerKey = "teamA";
    else if (teamBConfirmed >= pointsToWin) winnerKey = "teamB";
  }

  if (!winnerKey) return null;

  const team = winnerKey === "teamA" ? tournament.teamA : tournament.teamB;
  const fallbackColor = winnerKey === "teamA" ? "var(--team-a-default)" : "var(--team-b-default)";
  const color = team?.color || fallbackColor;
  const name = team?.name || (winnerKey === "teamA" ? "Team A" : "Team B");
  const label = viaTiebreaker ? "🏆 Tiebreaker Champions" : "🏆 Champions";

  return (
    <div className="flex items-center justify-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-amber-50 px-4 py-3 shadow-sm">
      <OfflineImage
        src={team?.logo}
        alt={name}
        fallbackIcon="🏆"
        style={{ width: 44, height: 44, objectFit: "contain" }}
      />
      <div className="text-left">
        <div className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-amber-700">
          {label}
        </div>
        <div className="text-lg font-bold leading-tight" style={{ color }}>
          {name}
        </div>
      </div>
    </div>
  );
}
