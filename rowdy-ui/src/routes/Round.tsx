import { memo, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, getDocFromCache, getDocFromServer } from "firebase/firestore";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import { AlertTriangle, ListChecks } from "lucide-react";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useRoundData } from "../hooks/useRoundData";
import { formatRoundType } from "../utils";
import {
  getPlayerShortName as getPlayerShortNameFromLookup,
  getPlayerName as getPlayerNameFromLookup,
  sortPlayersByTier,
} from "../utils/playerHelpers";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import OfflineImage from "../components/OfflineImage";
import PlayerAvatar from "../components/PlayerAvatar";
import { MatchStatusBadge, getMatchCardStyles } from "../components/MatchStatusBadge";
import { HoleByHoleTracker } from "../components/HoleByHoleTracker";
import { RoundPageSkeleton } from "../components/Skeleton";
// Badge removed from this file (was used for matches pill)
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { cn } from "../lib/utils";

function RoundComponent() {
  const { roundId } = useParams();
  const { player } = useAuth();
  const [hasRecap, setHasRecap] = useState(false);
  const [checkingRecap, setCheckingRecap] = useState(true);
  
  const {
    loading,
    error,
    round,
    tournament,
    course,
    matches,
    players,
    stats: { finalTeamA: fA, finalTeamB: fB, projectedTeamA: pA, projectedTeamB: pB },
  } = useRoundData(roundId);

  useEffect(() => {
    if (!roundId) return;

    // Existence check for the "Recap" link. Cache-first: once a recap exists in
    // cache this is a zero-read lookup. A cached *negative* still revalidates in
    // the background (the recap may have been computed since), so the link isn't
    // pinned hidden by a stale cache.
    let cancelled = false;
    const checkRecap = async () => {
      const ref = doc(db, "roundRecaps", roundId);
      try {
        const cached = await getDocFromCache(ref);
        if (cancelled) return;
        setHasRecap(cached.exists());
        if (!cached.exists()) {
          getDocFromServer(ref)
            .then((snap) => { if (!cancelled) setHasRecap(snap.exists()); })
            .catch(() => {});
        }
      } catch {
        // Not in cache — normal (cache-or-server) read.
        try {
          const snap = await getDoc(ref);
          if (!cancelled) setHasRecap(snap.exists());
        } catch (err) {
          console.error("Failed to check recap:", err);
          if (!cancelled) setHasRecap(false);
        }
      } finally {
        if (!cancelled) setCheckingRecap(false);
      }
    };

    checkRecap();
    return () => { cancelled = true; };
  }, [roundId]);

  const getPlayerShortName = (pid: string) => getPlayerShortNameFromLookup(pid, players);
  const getPlayerName = (pid: string) => getPlayerNameFromLookup(pid, players);

  if (loading) return (
    <Layout title="Loading..." showBack>
      <RoundPageSkeleton />
    </Layout>
  );

  if (error) return (
    <Layout title="Round" showBack>
      <div className="px-4 py-10">
        <Card className="mx-auto max-w-md border-red-200 bg-red-50/70 text-center">
          <CardContent className="py-6">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="text-sm font-semibold text-red-700">Unable to load round</div>
            <div className="mt-1 text-sm text-red-600">{error}</div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );

  if (!round) {
    return (
      <Layout title="Round" showBack>
        <div className="px-4 py-10">
          <Card className="mx-auto max-w-md border-border/80 bg-card/90 text-center">
            <CardContent className="py-8">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="text-lg font-semibold text-foreground">Round not found</div>
              <div className="mt-1 text-sm text-muted-foreground">
                This round is not available right now.
              </div>
              <Button asChild className="mt-4">
                <ViewTransitionLink to="/">Go Home</ViewTransitionLink>
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const tName = tournament?.name || "Round Detail";
  const tSeries = tournament?.series;
  const tLogo = tournament?.tournamentLogo;
  const courseName = course?.name || round.course?.name;
  const roundLabel = round.day ? `Round ${round.day}` : "Round";

  const hasGross = (round.skinsGrossPot ?? 0) > 0;
  const hasNet = (round.skinsNetPot ?? 0) > 0;
  const skinsEnabled = (round.format === "singles" || round.format === "twoManBestBall") && (hasGross || hasNet);
  const teamAColor = tournament?.teamA?.color || "var(--team-a-default)";
  const teamBColor = tournament?.teamB?.color || "var(--team-b-default)";

  // Captains/co-captains and admins can run the live pairings draft. Show the
  // entry point only to those roles (the page itself is captain/admin-gated),
  // and only until the round's matches have been created.
  const captainIds = [
    tournament?.teamA?.captainId,
    tournament?.teamA?.coCaptainId,
    tournament?.teamB?.captainId,
    tournament?.teamB?.coCaptainId,
  ].filter(Boolean) as string[];
  const canSeePairings =
    !!player && (!!player.isAdmin || captainIds.includes(player.id)) && matches.length === 0;

  return (
    <Layout title={tName} series={tSeries} showBack tournamentLogo={tLogo}>
      <div className="space-y-6 px-4 py-6">
        <section>
          <Card className="relative overflow-hidden border-white/50 bg-card/85 shadow-xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.05),_transparent_65%)]" />
            <CardContent className="relative space-y-5 py-6">
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3">
                  <div className="flex items-center">
                    {hasRecap && !checkingRecap && (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-full px-4 bg-card/90 shadow-sm hover:bg-muted"
                      >
                        <ViewTransitionLink to={`/round/${round.id}/recap`}>
                          Recap
                        </ViewTransitionLink>
                      </Button>
                    )}
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-semibold text-foreground">{roundLabel}</div>
                  </div>
                  <div className="flex items-center justify-end">
                    {skinsEnabled && (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-full px-4 bg-card/90 shadow-sm hover:bg-muted"
                      >
                        <ViewTransitionLink to={`/round/${round.id}/skins`}>
                          Skins
                        </ViewTransitionLink>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-sm text-muted-foreground">{formatRoundType(round.format)}</div>
                  {courseName && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {courseName}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-xl border border-border/70 bg-card/80 p-4">
                <div className="flex flex-col items-center gap-1">
                  <ViewTransitionLink to={`/teams?tournamentId=${encodeURIComponent(tournament?.id || "")}&team=A`}>
                    <OfflineImage 
                      src={tournament?.teamA?.logo} 
                      alt={tournament?.teamA?.name || "Team A"}
                      fallbackIcon="🔵"
                      style={{ width: 96, height: 96, objectFit: "contain" }}
                    />
                  </ViewTransitionLink>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-semibold tracking-tight" style={{ color: teamAColor }}>
                      {fA}
                    </span>
                    {pA > 0 && (
                      <span className="text-[0.6rem] font-semibold text-muted-foreground">(+{pA})</span>
                    )}
                  </div>
                </div>

                <div className="h-14 w-px bg-muted" />

                <div className="flex flex-col items-center gap-1">
                  <ViewTransitionLink to={`/teams?tournamentId=${encodeURIComponent(tournament?.id || "")}&team=B`}>
                    <OfflineImage 
                      src={tournament?.teamB?.logo} 
                      alt={tournament?.teamB?.name || "Team B"}
                      fallbackIcon="🔴"
                      style={{ width: 96, height: 96, objectFit: "contain" }}
                    />
                  </ViewTransitionLink>
                  <div className="flex items-baseline gap-1">
                    {pB > 0 && (
                      <span className="text-[0.6rem] font-semibold text-muted-foreground">(+{pB})</span>
                    )}
                    <span className="text-3xl font-semibold tracking-tight" style={{ color: teamBColor }}>
                      {fB}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {canSeePairings && (
          <section>
            <Button
              asChild
              variant="outline"
              className="h-11 w-full rounded-xl bg-card/90 shadow-sm hover:bg-muted"
            >
              <ViewTransitionLink to={`/round/${round.id}/pairings`}>
                <ListChecks className="mr-2 h-4 w-4" /> Set pairings (captains' draft)
              </ViewTransitionLink>
            </Button>
          </section>
        )}

        <section className="space-y-3">
            <div className="flex items-center px-1">
              <div className="pl-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                Matches
              </div>
            </div>

          {matches.length === 0 ? (
            <Card className="border-border/80 bg-card/85">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No matches scheduled.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-5" role="list" aria-label="Matches">
              {matches.map((match) => {
                const { bgStyle, borderStyle, textColor } = getMatchCardStyles(
                  match.status,
                  match.result,
                  teamAColor,
                  teamBColor
                );
                const teamAPlayersOrdered = sortPlayersByTier(match.teamAPlayers || [], tournament?.teamA?.rosterByTier);
                const teamBPlayersOrdered = sortPlayersByTier(match.teamBPlayers || [], tournament?.teamB?.rosterByTier);
                const teamANames = teamAPlayersOrdered.map((p) => getPlayerShortName(p.playerId)).join(", ");
                const teamBNames = teamBPlayersOrdered.map((p) => getPlayerShortName(p.playerId)).join(", ");
                const onColored = textColor === "text-white";
                const ringA = onColored ? "rgba(255,255,255,0.85)" : teamAColor;
                const ringB = onColored ? "rgba(255,255,255,0.85)" : teamBColor;

                return (
                  <div key={match.id} role="listitem">
                    <ViewTransitionLink
                      to={`/match/${match.id}`}
                      aria-label={`Match: ${teamANames} vs ${teamBNames}`}
                      className="card-link-hover block"
                    >
                      <Card
                        className="overflow-hidden border-border/70"
                        style={{ ...bgStyle, ...borderStyle }}
                      >
                        <CardContent className="space-y-4 py-4">
                          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                            <div className={cn("space-y-1.5 text-sm leading-tight", textColor)}>
                              {teamAPlayersOrdered.map((player, index) => (
                                <div key={index} className="flex min-w-0 items-center gap-1.5">
                                  <span
                                    className="shrink-0 rounded-full"
                                    style={{ boxShadow: `0 0 0 1.5px ${ringA}` }}
                                  >
                                    <PlayerAvatar
                                      name={getPlayerName(player.playerId)}
                                      playerId={player.playerId}
                                      color={teamAColor}
                                      size={24}
                                    />
                                  </span>
                                  <span className="min-w-0 truncate font-semibold">
                                    {getPlayerShortName(player.playerId)}
                                  </span>
                                </div>
                              ))}
                            </div>

                            <MatchStatusBadge
                              status={match.status}
                              result={match.result}
                              teamAColor={teamAColor}
                              teamBColor={teamBColor}
                              teamAName={tournament?.teamA?.name}
                              teamBName={tournament?.teamB?.name}
                              matchNumber={match.matchNumber}
                              teeTime={match.teeTime}
                              showTeeLabel={false}
                            />

                            <div className={cn("space-y-1.5 text-sm leading-tight", textColor)}>
                              {teamBPlayersOrdered.map((player, index) => (
                                <div key={index} className="flex min-w-0 flex-row-reverse items-center gap-1.5">
                                  <span
                                    className="shrink-0 rounded-full"
                                    style={{ boxShadow: `0 0 0 1.5px ${ringB}` }}
                                  >
                                    <PlayerAvatar
                                      name={getPlayerName(player.playerId)}
                                      playerId={player.playerId}
                                      color={teamBColor}
                                      size={24}
                                    />
                                  </span>
                                  <span className="min-w-0 truncate font-semibold">
                                    {getPlayerShortName(player.playerId)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </ViewTransitionLink>

                    <div className="mt-2 px-2">
                      <HoleByHoleTracker
                        match={match}
                        format={round?.format || null}
                        teamAColor={teamAColor}
                        teamBColor={teamBColor}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div>
          <LastUpdated />
        </div>
      </div>
    </Layout>
  );
}

export default memo(RoundComponent);
