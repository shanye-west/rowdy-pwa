import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import PlayerAvatar from "../components/PlayerAvatar";
import { useTournamentContext, usePlayers } from "../contexts/TournamentContext";

type SortKey = "handicap" | "name";

/**
 * Public, read-only dashboard of the available-player pool for the upcoming
 * tournament — the 24 players + their current handicaps, before the captains'
 * draft assigns them to teams. Reads `tournament.draftPool` (playerId ->
 * handicap index) off the active tournament; the page hides itself when no pool
 * is posted. Architected to later grow into an interactive captains' draft board.
 */
export default function DraftPool() {
  const { tournament, loading: tournamentLoading } = useTournamentContext();
  const [sortBy, setSortBy] = useState<SortKey>("handicap");

  const draftPool = tournament?.draftPool;
  const poolIds = useMemo(() => (draftPool ? Object.keys(draftPool) : []), [draftPool]);
  const { players, loaded: playersLoaded } = usePlayers(poolIds);

  const teamAColor = tournament?.teamA?.color || "var(--team-a-default)";
  const teamBColor = tournament?.teamB?.color || "var(--team-b-default)";
  const teamACaptain = tournament?.teamA?.captainId;
  const teamBCaptain = tournament?.teamB?.captainId;

  // Captain badge metadata (which team they captain + its color). Captains are
  // already locked in pre-draft, so we surface them in the pool.
  const captainMeta = (pid: string): { team: string; color: string } | null => {
    if (pid && pid === teamACaptain) return { team: tournament?.teamA?.name || "Team A", color: teamAColor };
    if (pid && pid === teamBCaptain) return { team: tournament?.teamB?.name || "Team B", color: teamBColor };
    return null;
  };

  // Handicap-sorted order is the canonical basis for tier assignment.
  const handicapSortedIds = useMemo(() => {
    return [...poolIds].sort((a, b) => {
      const ha = draftPool?.[a];
      const hb = draftPool?.[b];
      if (ha == null && hb == null) return 0;
      if (ha == null) return 1;
      if (hb == null) return -1;
      return Number(ha) - Number(hb);
    });
  }, [poolIds, draftPool]);

  // Map each playerId to its tier label (A/B/C/D) based on handicap rank.
  const tierMap = useMemo(() => {
    const map: Record<string, string> = {};
    handicapSortedIds.forEach((pid, i) => {
      if (i < 6) map[pid] = "A";
      else if (i < 12) map[pid] = "B";
      else if (i < 18) map[pid] = "C";
      else map[pid] = "D";
    });
    return map;
  }, [handicapSortedIds]);

  const sortedIds = useMemo(() => {
    if (sortBy === "name") {
      return [...poolIds].sort((a, b) => {
        const na = players[a]?.displayName || a;
        const nb = players[b]?.displayName || b;
        return na.localeCompare(nb);
      });
    }
    return handicapSortedIds;
  }, [poolIds, sortBy, players, handicapSortedIds]);

  const loading = tournamentLoading || (poolIds.length > 0 && !playersLoaded);

  if (loading) {
    return (
      <Layout title="Draft Pool" series={tournament?.series} showBack tournamentLogo={tournament?.tournamentLogo}>
        <div className="flex items-center justify-center py-20">
          <div className="spinner-lg" />
        </div>
      </Layout>
    );
  }

  if (poolIds.length === 0) {
    return (
      <Layout title="Draft Pool" series={tournament?.series} showBack tournamentLogo={tournament?.tournamentLogo}>
        <div className="px-4 pt-16 text-center text-slate-500">
          <ClipboardList className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <div className="text-base font-semibold text-slate-700">Draft pool not posted yet</div>
          <div className="mt-1 text-sm">Check back once the field is set.</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Draft Pool" series={tournament?.series} showBack tournamentLogo={tournament?.tournamentLogo}>
      <div style={{ padding: 16, display: "grid", gap: 16, maxWidth: 800, margin: "0 auto" }}>
        {/* Header: count + sort toggle */}
        <div className="flex items-center justify-between">
          <div className="text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            {poolIds.length} players available
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold">
            {(["handicap", "name"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortBy(key)}
                aria-pressed={sortBy === key}
                className={
                  "px-3 py-1.5 capitalize transition-colors " +
                  (sortBy === key ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")
                }
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        {/* Player list */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {sortedIds.map((pid, idx) => {
            const name = players[pid]?.displayName || "Unknown";
            const hcp = draftPool?.[pid];
            const cap = captainMeta(pid);
            const tier = tierMap[pid];

            // When sorted by handicap, insert a tier section header at the start of each group.
            const showTierHeader =
              sortBy === "handicap" && (idx === 0 || tierMap[sortedIds[idx - 1]] !== tier);

            return (
              <div key={pid}>
                {showTierHeader && (
                  <div className="flex items-center gap-2 bg-slate-50 px-4 py-1.5 border-b border-slate-200">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-800 text-[0.6rem] font-bold text-white">
                      {tier}
                    </span>
                    <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-slate-500">
                      Tier {tier}
                    </span>
                  </div>
                )}
                <div className={`flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 last:border-b-0 hover:bg-slate-50 transition-colors duration-150 ${cap ? "" : "opacity-50"}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <PlayerAvatar name={name} color={cap?.color} />
                    <div className="min-w-0">
                      <Link
                        to={`/player/${pid}`}
                        className="block truncate font-semibold text-slate-900 hover:text-slate-700"
                      >
                        {name}
                      </Link>
                      {cap && (
                        <span
                          style={{
                            fontSize: "0.6rem",
                            fontWeight: 700,
                            color: cap.color,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          Captain · {cap.team}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {sortBy === "name" && (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-800 text-[0.6rem] font-bold text-white">
                        {tier}
                      </span>
                    )}
                    <div className="text-base font-semibold tabular-nums text-slate-900">
                      {hcp != null ? Number(hcp).toFixed(1) : "—"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <LastUpdated />
      </div>
    </Layout>
  );
}
