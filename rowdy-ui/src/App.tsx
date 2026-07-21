import { useMemo } from "react";
import { ArrowRight, ClipboardList, Flag } from "lucide-react";
import { useTournamentData } from "./hooks/useTournamentData";
import { useTournamentContext } from "./contexts/TournamentContext";
import { useAuth } from "./contexts/AuthContext";
import { useRoundDrafts, findLivePairing } from "./hooks/usePairingDrafts";
import Layout from "./components/Layout";
import LastUpdated from "./components/LastUpdated";
import ScoreBlock from "./components/ScoreBlock";
import ScoreTrackerBar from "./components/ScoreTrackerBar";
import ChampionBanner from "./components/ChampionBanner";
import OfflineImage from "./components/OfflineImage";
import { LoadingEscalation } from "./components/LoadingScreen";
import { HomePageSkeleton } from "./components/Skeleton";
import { ViewTransitionLink } from "./components/ViewTransitionLink";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { formatRoundType } from "./utils";

export default function App() {
  // Service worker registration + update polling now live app-wide in main.tsx,
  // and autoUpdate reloads the page automatically when a new version activates,
  // so the Home route no longer owns the update flow.

  // Get tournament from shared context (already subscribed in TournamentProvider)
  const { tournament, loading: tournamentLoading } = useTournamentContext();

  // Reuse the context's tournament subscription (no duplicate) and read aggregate
  // scores from denormalized round totals — this view never needs raw matches.
  const {
    loading: dataLoading,
    rounds,
    coursesByRound,
    stats,
    roundStats,
    totalPointsAvailable,
  } = useTournamentData({ prefetchedTournament: tournament, preferDenormalizedTotals: true });
  
  const loading = tournamentLoading || dataLoading;

  // "RX Pairings Selection Live" banner: shown only while a round's pairings
  // draft is in progress (drafting or awaiting confirm) and auto-hidden once the
  // admin finalizes. Draft reads require auth, so only subscribe when signed in.
  const { user } = useAuth();
  // A draft can only be live before its matches are seeded (finalizing seeds
  // them) and never on a locked round — so during tournament play this holds
  // zero permanent listeners on the most-visited screen.
  const draftRoundIds = useMemo(
    () => (user ? rounds.filter((r) => !r.locked && !(r.matchIds?.length)).map((r) => r.id) : []),
    [user, rounds]
  );
  const { drafts: pairingDrafts } = useRoundDrafts(draftRoundIds);
  const livePairing = useMemo(() => findLivePairing(rounds, pairingDrafts), [rounds, pairingDrafts]);

  // Skeleton of the score hero + schedule instead of a bare spinner — first
  // paint reads as the page taking shape, and content swaps in without a jump.
  if (loading) return (
    <Layout title="Rowdy Cup" series={tournament?.series} tournamentLogo={tournament?.tournamentLogo}>
      <HomePageSkeleton />
      <LoadingEscalation />
    </Layout>
  );

  const tName = tournament?.name || "Rowdy Cup";
  const tSeries = tournament?.series; // "rowdyCup" or "christmasClassic"
  const tLogo = tournament?.tournamentLogo;
  const pointsToWin = totalPointsAvailable ? (totalPointsAvailable / 2 + 0.5) : null;
  const teamAColor = tournament?.teamA?.color || "var(--team-a-default)";
  const teamBColor = tournament?.teamB?.color || "var(--team-b-default)";
  const pointsToWinDisplay = pointsToWin !== null ? (Number.isInteger(pointsToWin) ? String(pointsToWin) : pointsToWin.toFixed(1)) : "";
  const showPoints = totalPointsAvailable > 0;
  // Pre-draft: surface the available-player pool when one has been posted, unless
  // the admin has hidden it (e.g. once the draft is done).
  const draftPoolCount = tournament?.draftPool ? Object.keys(tournament.draftPool).length : 0;
  const showDraftPool = draftPoolCount > 0 && !tournament?.hideDraftPool;

  return (
    <Layout title={tName} series={tSeries} tournamentLogo={tLogo}>
      {!tournament ? (
        <div className="px-4 pt-10">
          <Card className="mx-auto max-w-sm border-border/80 bg-card/85 text-center shadow-xl backdrop-blur">
            <CardContent className="space-y-4 py-8">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Flag className="h-6 w-6" />
              </div>
              <div>
                <div className="text-lg font-semibold text-foreground">No active tournament</div>
              </div>
              <Button asChild variant="outline" className="mx-auto">
                <ViewTransitionLink to="/history">View tournament history</ViewTransitionLink>
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6 px-4 py-6">
          <ChampionBanner
            tournament={tournament}
            teamAConfirmed={stats.teamAConfirmed}
            teamBConfirmed={stats.teamBConfirmed}
            totalPointsAvailable={totalPointsAvailable}
          />

          {showDraftPool && (
            <section>
              <ViewTransitionLink to="/draft" className="card-link-hover block">
                <Card className="border-border/80 bg-card/80">
                  <CardContent className="flex items-center gap-3 py-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <ClipboardList className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-foreground">Draft Pool</div>
                      <div className="text-xs text-muted-foreground">
                        {draftPoolCount} players available for the draft
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </ViewTransitionLink>
            </section>
          )}

          <section>
            <Card className="relative overflow-hidden border-white/40 bg-card/75 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur">
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
                      <div className="rounded-xl bg-card/80 p-2 shadow-inner">
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
                        style={{ width: 96, height: 96, objectFit: "contain" }}
                      />
                    </ViewTransitionLink>
                    <div
                      className="text-4xl font-semibold tracking-tight"
                      style={{ color: teamAColor }}
                    >
                      {stats.teamAConfirmed}
                    </div>
                  </div>

                  <div className="flex h-12 items-center justify-center">
                    <div className="h-10 w-px bg-muted/80" />
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <ViewTransitionLink to="/teams?team=B" className="group flex flex-col items-center gap-2">
                      <OfflineImage
                        src={tournament.teamB?.logo}
                        alt={tournament.teamB?.name || "Team B"}
                        fallbackIcon="🔴"
                        style={{ width: 96, height: 96, objectFit: "contain" }}
                      />
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

          {livePairing && (
            <section>
              <ViewTransitionLink to={`/pairings-tv/${livePairing.number}`} className="card-link-hover block">
                <Card className="border-red-200 bg-red-50/80">
                  <CardContent className="flex items-center gap-3 py-4">
                    <span className="relative flex h-3 w-3 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-bold text-red-700">
                        R{livePairing.number} Pairings Selection Live
                      </div>
                      <div className="text-xs text-red-600/80">Captains are picking matchups now — tap to watch</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-red-600" />
                  </CardContent>
                </Card>
              </ViewTransitionLink>
            </section>
          )}

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
      )}
    </Layout>
  );
}
