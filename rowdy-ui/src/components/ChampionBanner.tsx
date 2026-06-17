import OfflineImage from "./OfflineImage";
import type { TournamentDoc } from "../types";

/**
 * Champions banner shown when a tournament that finished tied after regulation
 * was decided by a tiebreaker. The admin designates the winning team via
 * `tournament.tiebreakerWinner` (Admin → Tournament Settings); absent → nothing
 * renders, so this is safe to drop in unconditionally.
 */
export default function ChampionBanner({ tournament }: { tournament: TournamentDoc }) {
  const winnerKey = tournament.tiebreakerWinner;
  if (winnerKey !== "teamA" && winnerKey !== "teamB") return null;

  const team = winnerKey === "teamA" ? tournament.teamA : tournament.teamB;
  const fallbackColor = winnerKey === "teamA" ? "var(--team-a-default)" : "var(--team-b-default)";
  const color = team?.color || fallbackColor;
  const name = team?.name || (winnerKey === "teamA" ? "Team A" : "Team B");

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
          🏆 Tiebreaker Champions
        </div>
        <div className="text-lg font-bold leading-tight" style={{ color }}>
          {name}
        </div>
      </div>
    </div>
  );
}
