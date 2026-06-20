import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import LoadingScreen from "../components/LoadingScreen";
import { Card } from "../components/ui/card";
import { useTournamentContext } from "../contexts/TournamentContext";
import { useAllTimeLeaderboard } from "../hooks/usePlayerStats";

// Ranking metric: cumulative points, or points per match so the leaderboard
// isn't dominated by whoever has simply played the most matches.
type SortBy = "total" | "perMatch";

const num = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

interface Row {
  playerId: string;
  points: number;
  wins: number;
  losses: number;
  halves: number;
  matchesPlayed: number;
  birdies: number;
  perMatch: number;
}

export default function Leaderboard() {
  const { tournament } = useTournamentContext();
  const [sortBy, setSortBy] = useState<SortBy>("total");

  // Always the all-time Rowdy Cup series, spanning every player who has ever
  // played it (not limited to the current tournament roster).
  const { leaderboard: seriesStats, names, loading } = useAllTimeLeaderboard("rowdyCup", true);

  const rows = useMemo<Row[]>(() => {
    const mapped: Row[] = seriesStats.map((s) => {
      const points = num(s.points);
      const matchesPlayed = num(s.matchesPlayed);
      return {
        playerId: s.playerId,
        points,
        wins: num(s.wins),
        losses: num(s.losses),
        halves: num(s.halves),
        matchesPlayed,
        birdies: num(s.birdies),
        perMatch: matchesPlayed > 0 ? points / matchesPlayed : 0,
      };
    });

    mapped.sort((a, b) => {
      if (sortBy === "perMatch") {
        if (b.perMatch !== a.perMatch) return b.perMatch - a.perMatch;
        if (b.points !== a.points) return b.points - a.points;
      } else {
        if (b.points !== a.points) return b.points - a.points;
      }
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.losses - b.losses;
    });

    return mapped;
  }, [seriesStats, sortBy]);

  return (
    <Layout
      title="Leaderboard"
      series={tournament?.series}
      showBack
      tournamentLogo={tournament?.tournamentLogo}
    >
      <div className="space-y-3 p-4">
        {/* Sort toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Lifetime Rowdy Cup records</span>
          <div className="flex gap-1 rounded-full bg-muted p-0.5">
            {(
              [
                { id: "total", label: "Total Pts" },
                { id: "perMatch", label: "Pts / Match" },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSortBy(s.id)}
                className={`rounded-full px-2.5 py-1 text-[0.65rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                  sortBy === s.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <LoadingScreen className="min-h-[40vh]" />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">⛳</div>
            <div className="empty-state-text">No results yet — check back once matches are played.</div>
          </div>
        ) : (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-border">
              {rows.map((r, i) => {
                return (
                  <li key={r.playerId}>
                    <Link
                      to={`/player/${r.playerId}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold text-foreground">
                            {names[r.playerId] || "Unknown"}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.wins}-{r.losses}-{r.halves} · {r.matchesPlayed} {r.matchesPlayed === 1 ? "match" : "matches"}
                          {r.birdies > 0 && <span> · {r.birdies} birdies</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-lg font-bold text-foreground">
                          {sortBy === "perMatch" ? r.perMatch.toFixed(2) : r.points}
                        </div>
                        <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">
                          {sortBy === "perMatch" ? "pts/match" : "pts"}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </Layout>
  );
}
