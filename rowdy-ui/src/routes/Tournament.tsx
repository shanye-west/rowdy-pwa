import { memo } from "react";
import { useParams } from "react-router-dom";
import { useTournamentData } from "../hooks/useTournamentData";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import ScoreBlock from "../components/ScoreBlock";
import ScoreTrackerBar from "../components/ScoreTrackerBar";
import OfflineImage from "../components/OfflineImage";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { formatRoundType, getTournamentWinner } from "../utils";
// RedirectCountdown removed; show Go Home button instead

/**
 * Tournament detail page for viewing historical (archived) tournaments.
 * This is a read-only view - no score editing allowed.
 */
function TournamentComponent() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  
  const {
    loading,
    tournament,
    rounds,
    coursesByRound,
    stats,
    roundStats,
    totalPointsAvailable,
  } = useTournamentData({ tournamentId, preferDenormalizedTotals: true });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner-lg"></div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <Layout title="Tournament" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-text">Tournament not found.</div>
          <ViewTransitionLink to="/" className="btn btn-primary mt-4">Go Home</ViewTransitionLink>
        </div>
      </Layout>
    );
  }
  const tName = tournament?.name || "Tournament";
  const tSeries = tournament?.series;
  const tLogo = tournament?.tournamentLogo;
  const teamAColor = tournament.teamA?.color || "var(--team-a-default)";
  const teamBColor = tournament.teamB?.color || "var(--team-b-default)";
  const teamLinkA = `/teams?tournamentId=${encodeURIComponent(tournament.id)}&team=A`;
  const teamLinkB = `/teams?tournamentId=${encodeURIComponent(tournament.id)}&team=B`;
  const pointsToWin = totalPointsAvailable ? (totalPointsAvailable / 2 + 0.5) : null;
  const pointsToWinDisplay = pointsToWin !== null ? (Number.isInteger(pointsToWin) ? String(pointsToWin) : pointsToWin.toFixed(1)) : "";
  const showPoints = totalPointsAvailable > 0;

  const winner = getTournamentWinner(
    tournament.tiebreakerWinner,
    stats.teamAConfirmed,
    stats.teamBConfirmed,
    totalPointsAvailable,
  );
  const championLabel = winner?.viaTiebreaker ? "🏆 Tiebreaker Champions" : "🏆 Champions";
  // Golden halo that traces the logo's silhouette (no clipping box around it).
  const championGlow = {
    filter: "drop-shadow(0 0 7px rgba(251,191,36,0.95)) drop-shadow(0 0 18px rgba(245,158,11,0.55))",
  };
  const championPillClass =
    "whitespace-nowrap rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1 text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-white shadow-sm";

  return (
    <Layout title={tName} series={tSeries} showBack tournamentLogo={tLogo}>
      <div className="space-y-6 px-4 py-6">
        <section>
          <Card className="relative overflow-hidden border-white/40 bg-card/75 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur">

            <CardContent className="relative space-y-6 pt-6">
              <div className="space-y-2">
                <div className="text-center">
                  <div className="text-[1.0rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Total Score
                  </div>
                </div>

                {showPoints && (
                  <div className="space-y-1">
                    <div className="text-center text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {pointsToWinDisplay} points needed to win
                    </div>
                    <ScoreTrackerBar
                      totalPoints={totalPointsAvailable}
                      teamAConfirmed={stats.teamAConfirmed}
                      teamBConfirmed={stats.teamBConfirmed}
                      teamAPending={stats.teamAPending}
                      teamBPending={stats.teamBPending}
                      teamAColor={teamAColor}
                      teamBColor={teamBColor}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                <div className="flex flex-col items-center gap-2">
                  <ViewTransitionLink to={teamLinkA} className="group flex flex-col items-center gap-2">
                    <OfflineImage
                      src={tournament.teamA?.logo}
                      alt={tournament.teamA?.name || "Team A"}
                      fallbackIcon="🔵"
                      style={{ width: 96, height: 96, objectFit: "contain", ...(winner?.winnerKey === "teamA" ? championGlow : {}) }}
                    />
                  </ViewTransitionLink>
                  <div
                    className="text-4xl font-semibold tracking-tight"
                    style={{ color: teamAColor }}
                  >
                    {stats.teamAConfirmed}
                  </div>
                  {winner && (
                    <div className="flex h-6 items-center">
                      {winner.winnerKey === "teamA" && (
                        <div className={championPillClass}>{championLabel}</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex h-12 items-center justify-center">
                  <div className="h-10 w-px bg-muted/80" />
                </div>

                <div className="flex flex-col items-center gap-2">
                  <ViewTransitionLink to={teamLinkB} className="group flex flex-col items-center gap-2">
                    <OfflineImage
                      src={tournament.teamB?.logo}
                      alt={tournament.teamB?.name || "Team B"}
                      fallbackIcon="🔴"
                      style={{ width: 96, height: 96, objectFit: "contain", ...(winner?.winnerKey === "teamB" ? championGlow : {}) }}
                    />
                  </ViewTransitionLink>
                  <div
                    className="text-4xl font-semibold tracking-tight"
                    style={{ color: teamBColor }}
                  >
                    {stats.teamBConfirmed}
                  </div>
                  {winner && (
                    <div className="flex h-6 items-center">
                      {winner.winnerKey === "teamB" && (
                        <div className={championPillClass}>{championLabel}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 pl-2 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              Schedule
            </div>
          </div>

          <div className="space-y-3">
            {rounds.map((r, idx) => {
              const rs = roundStats[r.id];
              const course = coursesByRound[r.id];
              const courseName = course?.name || r.course?.name;

              return (
                <div key={r.id}>
                  <ViewTransitionLink to={`/round/${r.id}`} className="card-link-hover block">
                    <Card className="border-border/80 bg-card/80">
                      <CardContent className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-4">
                        <div className="flex items-center gap-3">
                          <OfflineImage 
                            src={tournament.teamA?.logo} 
                            alt={tournament.teamA?.name || "Team A"}
                            fallbackIcon="🔵"
                            style={{ width: 22, height: 22, objectFit: "contain" }}
                          />
                          <div className="text-lg font-semibold text-foreground">
                            <ScoreBlock
                              final={rs?.teamAConfirmed ?? 0}
                              proj={rs?.teamAPending ?? 0}
                              color={teamAColor}
                            />
                          </div>
                        </div>

                        <div className="text-center">
                          <div className="text-sm font-semibold text-foreground">Round {idx + 1}</div>
                          <Badge variant="outline" className="mt-1 border-border text-[0.55rem]">
                            {formatRoundType(r.format)}
                          </Badge>
                          {courseName && (
                            <div className="mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                              {courseName}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-end gap-3">
                          <div className="text-lg font-semibold text-foreground">
                            <ScoreBlock
                              final={rs?.teamBConfirmed ?? 0}
                              proj={rs?.teamBPending ?? 0}
                              color={teamBColor}
                              projLeft
                            />
                          </div>
                          <OfflineImage 
                            src={tournament.teamB?.logo} 
                            alt={tournament.teamB?.name || "Team B"}
                            fallbackIcon="🔴"
                            style={{ width: 22, height: 22, objectFit: "contain" }}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  </ViewTransitionLink>
                </div>
              );
            })}
          </div>
        </section>

        <div>
          <LastUpdated />
        </div>
      </div>
    </Layout>
  );
}

export default memo(TournamentComponent);
