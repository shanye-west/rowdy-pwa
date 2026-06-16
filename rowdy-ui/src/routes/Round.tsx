import { memo, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import {
  AlertTriangle,
  Dices,
} from "lucide-react";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useRoundData } from "../hooks/useRoundData";
import { useRosterPlayers, isMatchBettable } from "../hooks/useBets";
import PlaceBetModal from "../components/PlaceBetModal";
import { formatRoundType } from "../utils";
import type { BetSide } from "../types";
import { getPlayerShortName as getPlayerShortNameFromLookup } from "../utils/playerHelpers";
import Layout from "../components/Layout";
import TeamName from "../components/TeamName";
import LastUpdated from "../components/LastUpdated";
import OfflineImage from "../components/OfflineImage";
import { MatchStatusBadge, getMatchCardStyles } from "../components/MatchStatusBadge";
import { HoleByHoleTracker } from "../components/HoleByHoleTracker";
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

    const checkRecap = async () => {
      try {
        const recapSnap = await getDoc(doc(db, "roundRecaps", roundId));
        setHasRecap(recapSnap.exists());
      } catch (err) {
        console.error("Failed to check recap:", err);
        setHasRecap(false);
      } finally {
        setCheckingRecap(false);
      }
    };

    checkRecap();
  }, [roundId]);

  // Sportsbook: full roster (for the challenge-a-player picker) + the open popup.
  const rosterPlayers = useRosterPlayers(tournament);
  const rosterOptions = useMemo(
    () =>
      Object.values(rosterPlayers)
        .filter((p) => p.id !== player?.id)
        .map((p) => ({ id: p.id, name: p.displayName || p.id })),
    [rosterPlayers, player?.id]
  );
  const [betCtx, setBetCtx] = useState<{
    matchId: string;
    side: BetSide;
    contextLabel: string;
    sideLabels: { teamA: string; teamB: string };
  } | null>(null);

  const getPlayerShortName = (pid: string) => getPlayerShortNameFromLookup(pid, players);

  if (loading) return (
    <Layout title="Loading..." showBack>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="spinner-lg"></div>
      </div>
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
          <Card className="mx-auto max-w-md border-slate-200/80 bg-white/90 text-center">
            <CardContent className="py-8">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="text-lg font-semibold text-slate-900">Round not found</div>
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
  const teamAName = tournament?.teamA?.name || "Team A";
  const teamBName = tournament?.teamB?.name || "Team B";
  const sportsbookEnabled = !!tournament?.sportsbookEnabled && !!player;

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
          <Card className="relative overflow-hidden border-white/50 bg-white/85 shadow-xl">
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
                        className="h-9 rounded-full px-4 bg-white/90 shadow-sm hover:bg-slate-50"
                      >
                        <ViewTransitionLink to={`/round/${round.id}/recap`}>
                          Recap
                        </ViewTransitionLink>
                      </Button>
                    )}
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-semibold text-slate-900">{roundLabel}</div>
                  </div>
                  <div className="flex items-center justify-end">
                    {skinsEnabled && (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-full px-4 bg-white/90 shadow-sm hover:bg-slate-50"
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

              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-xl border border-slate-200/70 bg-white/80 p-4">
                <div className="flex flex-col items-center gap-1">
                  <ViewTransitionLink to={`/teams?tournamentId=${encodeURIComponent(tournament?.id || "")}&team=A`}>
                    <OfflineImage 
                      src={tournament?.teamA?.logo} 
                      alt={tournament?.teamA?.name || "Team A"}
                      fallbackIcon="🔵"
                      style={{ width: 40, height: 40, objectFit: "contain" }}
                    />
                  </ViewTransitionLink>
                  <TeamName
                    name={tournament?.teamA?.name || "Team A"}
                    variant="inline"
                    minFontPx={14}
                    maxFontPx={24}
                    style={{ color: teamAColor }}
                  />
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-semibold tracking-tight" style={{ color: teamAColor }}>
                      {fA}
                    </span>
                    {pA > 0 && (
                      <span className="text-[0.6rem] font-semibold text-slate-400">(+{pA})</span>
                    )}
                  </div>
                </div>

                <div className="h-14 w-px bg-slate-200" />

                <div className="flex flex-col items-center gap-1">
                  <ViewTransitionLink to={`/teams?tournamentId=${encodeURIComponent(tournament?.id || "")}&team=B`}>
                    <OfflineImage 
                      src={tournament?.teamB?.logo} 
                      alt={tournament?.teamB?.name || "Team B"}
                      fallbackIcon="🔴"
                      style={{ width: 40, height: 40, objectFit: "contain" }}
                    />
                  </ViewTransitionLink>
                  <TeamName
                    name={tournament?.teamB?.name || "Team B"}
                    variant="inline"
                    minFontPx={14}
                    maxFontPx={24}
                    style={{ color: teamBColor }}
                  />
                  <div className="flex items-baseline gap-1">
                    {pB > 0 && (
                      <span className="text-[0.6rem] font-semibold text-slate-400">(+{pB})</span>
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
              className="h-11 w-full rounded-xl bg-white/90 shadow-sm hover:bg-slate-50"
            >
              <ViewTransitionLink to={`/round/${round.id}/pairings`}>
                ⛳ Set pairings (captains' draft)
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
            <Card className="border-slate-200/80 bg-white/85">
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
                const teamANames = (match.teamAPlayers || []).map((p) => getPlayerShortName(p.playerId)).join(", ");
                const teamBNames = (match.teamBPlayers || []).map((p) => getPlayerShortName(p.playerId)).join(", ");
                const showBet = sportsbookEnabled && isMatchBettable(match);
                const openBet = (side: BetSide) =>
                  setBetCtx({
                    matchId: match.id,
                    side,
                    contextLabel: `${teamANames} vs ${teamBNames}`,
                    sideLabels: { teamA: teamANames, teamB: teamBNames },
                  });

                return (
                  <div key={match.id} role="listitem">
                    <ViewTransitionLink
                      to={`/match/${match.id}`}
                      aria-label={`Match: ${teamANames} vs ${teamBNames}`}
                      className="card-link-hover block"
                    >
                      <Card
                        className="overflow-hidden border-slate-200/70"
                        style={{ ...bgStyle, ...borderStyle }}
                      >
                        <CardContent className="space-y-4 py-4">
                          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                            <div className={cn("text-left text-sm leading-tight", textColor)}>
                              {(match.teamAPlayers || []).map((player, index) => (
                                <div key={index} className="font-semibold">
                                  {getPlayerShortName(player.playerId)}
                                </div>
                              ))}
                              {showBet && (
                                <BetMeButton
                                  color={teamAColor}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openBet("teamA");
                                  }}
                                />
                              )}
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

                            <div className={cn("text-right text-sm leading-tight", textColor)}>
                              {(match.teamBPlayers || []).map((player, index) => (
                                <div key={index} className="font-semibold">
                                  {getPlayerShortName(player.playerId)}
                                </div>
                              ))}
                              {showBet && (
                                <BetMeButton
                                  color={teamBColor}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openBet("teamB");
                                  }}
                                />
                              )}
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

      {betCtx && tournament && (
        <PlaceBetModal
          isOpen={!!betCtx}
          onClose={() => setBetCtx(null)}
          tournamentId={tournament.id}
          market="match"
          matchId={betCtx.matchId}
          contextLabel={betCtx.contextLabel}
          sideLabels={betCtx.sideLabels}
          teamTags={{ teamA: teamAName, teamB: teamBName }}
          teamColors={{ teamA: teamAColor, teamB: teamBColor }}
          initialSide={betCtx.side}
          rosterOptions={rosterOptions}
          onPosted={() => setBetCtx(null)}
        />
      )}
    </Layout>
  );
}

/**
 * Small "Bet Me" pill shown inside a match card, under a team's names. Rendered
 * as a role=button span (not a <button>) because it lives inside the card's
 * navigation link; the handler stops the click from navigating to the match.
 */
function BetMeButton({
  color,
  onClick,
}: {
  color: string;
  onClick: (e: React.MouseEvent | React.KeyboardEvent) => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e);
        }
      }}
      style={{ borderColor: color, color }}
      className="mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-full border bg-white/90 px-2 py-0.5 text-[0.65rem] font-semibold shadow-sm transition-transform active:scale-95"
    >
      <Dices className="h-3 w-3" />
      Bet Me
    </span>
  );
}

export default memo(RoundComponent);
