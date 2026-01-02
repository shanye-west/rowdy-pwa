import { useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { ArrowRight, Flag, RefreshCw, X } from "lucide-react";
import { useTournamentData } from "./hooks/useTournamentData";
import { useTournamentContext } from "./contexts/TournamentContext";
import Layout from "./components/Layout";
import LastUpdated from "./components/LastUpdated";
import ScoreBlock from "./components/ScoreBlock";
import ScoreTrackerBar from "./components/ScoreTrackerBar";
import OfflineImage from "./components/OfflineImage";
import { ViewTransitionLink } from "./components/ViewTransitionLink";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { formatRoundType } from "./utils";

export default function App() {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  
  // PWA update handler
  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      setShowUpdatePrompt(true);
    },
    onRegisteredSW(swUrl: string, r: ServiceWorkerRegistration | undefined) {
      console.log("Service Worker registered:", swUrl);
      // Check for updates every 60 seconds
      if (r) {
        setInterval(() => {
          r.update();
        }, 60000);
      }
    },
  });

  const handleUpdateClick = () => {
    setShowUpdatePrompt(false);
    updateServiceWorker(true);
  };

  // Get tournament from shared context (already subscribed in TournamentProvider)
  const { tournament, loading: tournamentLoading } = useTournamentContext();
  
  // Fetch rounds and matches only for the active tournament
  const {
    loading: dataLoading,
    rounds,
    coursesByRound,
    stats,
    roundStats,
    totalPointsAvailable,
  } = useTournamentData({ tournamentId: tournament?.id });
  
  const loading = tournamentLoading || dataLoading;

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="spinner-lg"></div>
    </div>
  );

  const tName = tournament?.name || "Rowdy Cup";
  const tSeries = tournament?.series; // "rowdyCup" or "christmasClassic"
  const tLogo = tournament?.tournamentLogo;
  const pointsToWin = totalPointsAvailable ? (totalPointsAvailable / 2 + 0.5) : null;
  const teamAColor = tournament?.teamA?.color || "var(--team-a-default)";
  const teamBColor = tournament?.teamB?.color || "var(--team-b-default)";
  const pointsToWinDisplay = pointsToWin !== null ? (Number.isInteger(pointsToWin) ? String(pointsToWin) : pointsToWin.toFixed(1)) : "";
  const showPoints = totalPointsAvailable > 0;

  return (
    <Layout title={tName} series={tSeries} tournamentLogo={tLogo}>
      {!tournament ? (
        <div className="px-4 pt-10">
          <Card className="mx-auto max-w-sm border-slate-200/80 bg-white/85 text-center shadow-xl backdrop-blur">
            <CardContent className="space-y-4 py-8">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Flag className="h-6 w-6" />
              </div>
              <div>
                <div className="text-lg font-semibold text-slate-900">No active tournament</div>
              </div>
              <Button asChild variant="outline" className="mx-auto">
                <ViewTransitionLink to="/history">View tournament history</ViewTransitionLink>
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6 px-4 py-6">
          <section>
            <Card className="relative overflow-hidden border-white/40 bg-white/75 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(191,32,60,0.14),_transparent_55%)]" />
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
                      <div className="rounded-xl bg-white/80 p-2 shadow-inner">
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
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                  <div className="flex flex-col items-center gap-2">
                    <ViewTransitionLink to="/teams?team=A" className="group flex flex-col items-center gap-2">
                      <OfflineImage 
                        src={tournament.teamA?.logo} 
                        alt={tournament.teamA?.name || "Team A"}
                        fallbackIcon="🔵"
                        style={{ width: 40, height: 40, objectFit: "contain" }}
                      />
                      <div
                        className="text-sm font-semibold transition-opacity group-hover:opacity-90"
                        style={{ color: teamAColor }}
                      >
                        {tournament.teamA?.name || "Team A"}
                      </div>
                    </ViewTransitionLink>
                    <div
                      className="text-4xl font-semibold tracking-tight"
                      style={{ color: teamAColor }}
                    >
                      {stats.teamAConfirmed}
                    </div>
                  </div>

                  <div className="flex h-12 items-center justify-center">
                    <div className="h-10 w-px bg-slate-200/80" />
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <ViewTransitionLink to="/teams?team=B" className="group flex flex-col items-center gap-2">
                      <OfflineImage 
                        src={tournament.teamB?.logo} 
                        alt={tournament.teamB?.name || "Team B"}
                        fallbackIcon="🔴"
                        style={{ width: 40, height: 40, objectFit: "contain" }}
                      />
                      <div
                        className="text-sm font-semibold transition-opacity group-hover:opacity-90"
                        style={{ color: teamBColor }}
                      >
                        {tournament.teamB?.name || "Team B"}
                      </div>
                    </ViewTransitionLink>
                    <div
                      className="text-4xl font-semibold tracking-tight"
                      style={{ color: teamBColor }}
                    >
                      {stats.teamBConfirmed}
                    </div>
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
                    <ViewTransitionLink to={`/round/${r.id}`} className="group block">
                      <Card className="border-slate-200/80 bg-white/80 transition-all group-hover:-translate-y-0.5 group-hover:border-slate-200 group-hover:shadow-lg">
                        <CardContent className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-4">
                          <div className="flex items-center gap-3">
                            <OfflineImage 
                              src={tournament.teamA?.logo} 
                              alt={tournament.teamA?.name || "Team A"}
                              fallbackIcon="🔵"
                              style={{ width: 22, height: 22, objectFit: "contain" }}
                            />
                            <div className="text-lg font-semibold text-slate-900">
                              <ScoreBlock
                                final={rs?.teamAConfirmed ?? 0}
                                proj={rs?.teamAPending ?? 0}
                                color={teamAColor}
                              />
                            </div>
                          </div>

                          <div className="text-center">
                            <div className="text-sm font-semibold text-slate-900">Round {idx + 1}</div>
                            <Badge variant="outline" className="mt-1 border-slate-200 text-[0.55rem]">
                              {formatRoundType(r.format)}
                            </Badge>
                            {courseName && (
                              <div className="mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                                {courseName}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-end gap-3">
                            <div className="text-lg font-semibold text-slate-900">
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
      )}

      {/* PWA Update Prompt */}
      {showUpdatePrompt && (
        <div className="fixed bottom-6 left-1/2 z-[1000] w-[92%] max-w-md -translate-x-1/2 animate-slide-up">
            <Card className="border-white/20 bg-slate-900 text-white shadow-2xl">
              <CardContent className="flex items-center gap-3 py-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
                  <RefreshCw className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold">Update Available</div>
                  <div className="text-xs text-white/75">
                    A new version is ready. Reload to update.
                  </div>
                </div>
                <Button
                  onClick={handleUpdateClick}
                  variant="secondary"
                  className="bg-white text-slate-900 hover:bg-white/90"
                >
                  Reload
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowUpdatePrompt(false)}
                  className="text-white/70 hover:bg-white/10 hover:text-white"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
    </Layout>
  );
}
