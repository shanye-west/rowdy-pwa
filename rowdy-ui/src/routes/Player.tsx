import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import Layout from "../components/Layout";
import LoadingScreen from "../components/LoadingScreen";
import { Card } from "../components/ui/card";
import BadgeGrid from "../components/player/BadgeGrid";
import { getBadges } from "../lib/badges";
import { usePlayerStatsBySeries } from "../hooks/usePlayerStats";
import { usePlayers, useTournamentContext } from "../contexts/TournamentContext";
import type { PlayerStatsBySeries, TournamentDoc } from "../types";

const SERIES_LABELS: Record<string, string> = {
  rowdyCup: "Rowdy Cup",
  christmasClassic: "Christmas Classic",
};

const FORMAT_ORDER = ["singles", "twoManBestBall", "twoManShamble", "twoManScramble", "fourManScramble"] as const;
const FORMAT_LABELS: Record<string, string> = {
  singles: "Singles",
  twoManBestBall: "Best Ball",
  twoManShamble: "Shamble",
  twoManScramble: "2-Man Scramble",
  fourManScramble: "4-Man Scramble",
};

const num = (v: number | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

type TeamInfo = {
  name: string;
  color: string;
  handicap?: number;
  isCaptain: boolean;
  isCoCaptain: boolean;
};

/** Locate the player on the active tournament's rosters (for team accent + handicap). */
function findTeamInfo(t: TournamentDoc | null, playerId: string): TeamInfo | null {
  if (!t) return null;
  for (const key of ["teamA", "teamB"] as const) {
    const team = t[key];
    const tiers = team?.rosterByTier;
    const inTeam = tiers && Object.values(tiers).some((ids) => ids?.includes(playerId));
    if (inTeam) {
      return {
        name: team.name,
        color: team.color || "var(--team-a-default)",
        handicap: team.handicapByPlayer?.[playerId],
        isCaptain: team.captainId === playerId,
        isCoCaptain: team.coCaptainId === playerId,
      };
    }
  }
  return null;
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-center">
      <div className="text-lg font-bold text-foreground">{value}</div>
      <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

export default function Player() {
  const { playerId } = useParams<{ playerId: string }>();
  const { tournament } = useTournamentContext();
  const { allSeriesStats, loading } = usePlayerStatsBySeries(playerId);

  // Player identity (name) — resolve through the shared player cache; roster
  // players are already warmed there, so this is usually a zero-read lookup.
  const playerIdList = useMemo(() => (playerId ? [playerId] : []), [playerId]);
  const { players: cachedPlayers } = usePlayers(playerIdList);
  const playerDoc = (playerId && cachedPlayers[playerId]) || null;

  // Series selector — derive the shown series (override -> active tournament -> first).
  const seriesOptions = useMemo(() => allSeriesStats.map((s) => s.series as string), [allSeriesStats]);
  const [seriesOverride, setSeriesOverride] = useState<string | null>(null);
  const selectedSeries = useMemo(() => {
    if (seriesOverride && seriesOptions.includes(seriesOverride)) return seriesOverride;
    const active = tournament?.series;
    if (active && seriesOptions.includes(active)) return active;
    return seriesOptions[0] ?? null;
  }, [seriesOverride, seriesOptions, tournament?.series]);

  const stats: PlayerStatsBySeries | null = useMemo(
    () => allSeriesStats.find((s) => s.series === selectedSeries) ?? null,
    [allSeriesStats, selectedSeries]
  );

  const teamInfo = useMemo(
    () => (playerId ? findTeamInfo(tournament, playerId) : null),
    [tournament, playerId]
  );
  const badges = useMemo(() => getBadges(stats), [stats]);

  const name = playerDoc?.displayName || "Player";
  const accent = teamInfo?.color || "var(--brand-primary)";

  const wins = num(stats?.wins);
  const losses = num(stats?.losses);
  const halves = num(stats?.halves);
  const played = num(stats?.matchesPlayed);
  const winPct = played > 0 ? Math.round(((wins + 0.5 * halves) / played) * 100) : 0;

  const hasFormatData =
    !!stats?.formatBreakdown &&
    FORMAT_ORDER.some((f) => num(stats.formatBreakdown?.[f]?.matches) > 0);

  const content = (() => {
    if (loading) {
      return (
        <LoadingScreen className="min-h-[50vh]" />
      );
    }

    if (allSeriesStats.length === 0) {
      return (
        <div className="px-4 py-10">
          <Card className="mx-auto max-w-md border-border/80 bg-card/90 p-8 text-center">
            <div className="text-3xl">🏌️</div>
            <div className="mt-2 text-lg font-semibold text-foreground">{name}</div>
            <p className="mt-1 text-sm text-muted-foreground">No match history yet — stats appear once matches are played.</p>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-4 p-4">
        {/* Identity + headline record */}
        <Card className="overflow-hidden p-0" style={{ borderTop: `4px solid ${accent}` }}>
          <div className="p-4">
            <div className="flex items-baseline gap-2">
              <h1 className="text-2xl font-bold text-foreground">{name}</h1>
              {(teamInfo?.isCaptain || teamInfo?.isCoCaptain) && (
                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white">
                  {teamInfo.isCaptain ? "Captain" : "Co-Captain"}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {teamInfo?.name ? <span style={{ color: accent }} className="font-semibold">{teamInfo.name}</span> : null}
              {teamInfo?.handicap != null && <span>{teamInfo?.name ? " · " : ""}HCP {Number(teamInfo.handicap).toFixed(1)}</span>}
            </div>

            {/* Series toggle */}
            {seriesOptions.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {seriesOptions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeriesOverride(s)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                      s === selectedSeries
                        ? "bg-slate-900 text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {SERIES_LABELS[s] ?? s}
                  </button>
                ))}
              </div>
            )}

            {/* Record */}
            <div className="mt-4 flex items-end gap-4">
              <div>
                <div className="text-3xl font-bold tracking-tight text-foreground">
                  {wins}-{losses}-{halves}
                </div>
                <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">W–L–H</div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-xl font-bold text-foreground">{num(stats?.points)}</div>
                <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Points</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-foreground">{winPct}%</div>
                <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Win</div>
              </div>
            </div>
          </div>
        </Card>

        {/* Achievements */}
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">Achievements</h2>
          <BadgeGrid badges={badges} />
        </Card>

        {/* By format */}
        {hasFormatData && (
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">By Format</h2>
            <div className="divide-y divide-border">
              {FORMAT_ORDER.map((fmt) => {
                const fb = stats?.formatBreakdown?.[fmt];
                if (!fb || num(fb.matches) === 0) return null;
                return (
                  <div key={fmt} className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium text-foreground">{FORMAT_LABELS[fmt]}</span>
                    <span className="text-sm font-semibold text-foreground">
                      {num(fb.wins)}-{num(fb.losses)}-{num(fb.halves)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Career counting stats */}
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">Career</h2>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Matches" value={played} />
            <StatTile label="Holes Won" value={num(stats?.holesWon)} />
            <StatTile label="Birdies" value={num(stats?.birdies)} />
            <StatTile label="Eagles" value={num(stats?.eagles)} />
            <StatTile label="Comebacks" value={num(stats?.comebackWins)} />
            <StatTile label="Drives" value={num(stats?.drivesUsed)} />
          </div>
        </Card>
      </div>
    );
  })();

  return (
    <Layout
      title={name}
      series={tournament?.series}
      showBack
      tournamentLogo={tournament?.tournamentLogo}
    >
      {content}
    </Layout>
  );
}
