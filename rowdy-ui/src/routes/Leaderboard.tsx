import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Crown } from "lucide-react";
import Layout from "../components/Layout";
import { Card } from "../components/ui/card";
import { useTournamentContext, usePlayers } from "../contexts/TournamentContext";
import { useTournamentLeaderboard, type LeaderboardRow } from "../hooks/useTournamentLeaderboard";
import { useAllTimeLeaderboard } from "../hooks/usePlayerStats";
import type { TournamentSeries } from "../types";

type Tab = "tournament" | "allTime";

const num = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export default function Leaderboard() {
  const { tournament } = useTournamentContext();
  const [tab, setTab] = useState<Tab>("tournament");

  const { rows: tournamentRows, nameById: tournamentNames, loading } = useTournamentLeaderboard(tournament);
  const series = (tournament?.series as TournamentSeries) || "rowdyCup";
  // All-time stats span EVERY player who has played the series, not just the
  // current roster. Only fetched once that tab is active.
  const { leaderboard: seriesStats, loading: seriesLoading } = useAllTimeLeaderboard(
    series,
    tab === "allTime"
  );

  const allTimeRows: LeaderboardRow[] = useMemo(
    () =>
      seriesStats.map((s) => ({
        playerId: s.playerId,
        points: num(s.points),
        wins: num(s.wins),
        losses: num(s.losses),
        halves: num(s.halves),
        matchesPlayed: num(s.matchesPlayed),
        birdies: num(s.birdies),
      })),
    [seriesStats]
  );

  // All-time players can include people outside the current roster, so resolve
  // their display names directly from the player cache.
  const allTimeIds = useMemo(() => allTimeRows.map((r) => r.playerId), [allTimeRows]);
  const { players: allTimePlayers, loaded: allTimeNamesLoaded } = usePlayers(allTimeIds);
  const allTimeNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const id of allTimeIds) map[id] = allTimePlayers[id]?.displayName || "Unknown";
    return map;
  }, [allTimePlayers, allTimeIds]);

  const rows = tab === "tournament" ? tournamentRows : allTimeRows;
  const nameById = tab === "tournament" ? tournamentNames : allTimeNames;
  const busy = tab === "tournament" ? loading : seriesLoading || !allTimeNamesLoaded;

  return (
    <Layout
      title="Leaderboard"
      series={tournament?.series}
      showBack
      tournamentLogo={tournament?.tournamentLogo}
    >
      <div className="space-y-4 p-4">
        {/* Tabs */}
        <div className="flex gap-1.5">
          {(
            [
              { id: "tournament", label: "This Tournament" },
              { id: "allTime", label: "All-Time" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                tab === t.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {!tournament ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏆</div>
            <div className="empty-state-text">No active tournament.</div>
          </div>
        ) : busy ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="spinner-lg" />
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">⛳</div>
            <div className="empty-state-text">No results yet — check back once matches are played.</div>
          </div>
        ) : (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-slate-100">
              {rows.map((r, i) => {
                const isMvp = i === 0;
                return (
                  <li key={r.playerId}>
                    <Link
                      to={`/player/${r.playerId}`}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 ${
                        isMvp ? "bg-amber-50" : ""
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          isMvp ? "bg-amber-400 text-white" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold text-slate-900">
                            {nameById[r.playerId] || "Unknown"}
                          </span>
                          {isMvp && tab === "tournament" && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-white">
                              <Crown className="h-3 w-3" aria-hidden="true" /> MVP
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {r.wins}-{r.losses}-{r.halves}
                          {r.birdies > 0 && <span> · {r.birdies} birdies</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-lg font-bold text-slate-900">{r.points}</div>
                        <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-slate-500">pts</div>
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
