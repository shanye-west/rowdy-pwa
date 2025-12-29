import { memo, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Crown,
  ListChecks,
  Target,
  Trophy,
} from "lucide-react";
import { useSkinsData } from "../hooks/useSkinsData";
import type { SkinType } from "../hooks/useSkinsData";
import { formatTeeTime } from "../utils";
import { scoreLabel } from "../utils/scoreLabel";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { cn } from "../lib/utils";

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function SkinsComponent() {
  const { roundId } = useParams();
  const {
    loading,
    error,
    round,
    tournament,
    skinsEnabled,
    holeSkinsData,
    playerTotals,
  } = useSkinsData(roundId);

  const [selectedTab, setSelectedTab] = useState<SkinType>("gross");
  const [expandedHole, setExpandedHole] = useState<number | null>(null);

  const tName = tournament?.name || "Skins Game";
  const tSeries = tournament?.series;
  const tLogo = tournament?.tournamentLogo;

  const hasGross = (round?.skinsGrossPot ?? 0) > 0;
  const hasNet = (round?.skinsNetPot ?? 0) > 0;
  const skinModeLabel = hasGross && hasNet ? "Gross + Net" : hasGross ? "Gross" : "Net";

  useEffect(() => {
    if (!round) return;
    if (hasNet && !hasGross) {
      setSelectedTab("net");
    } else if (hasGross && !hasNet) {
      setSelectedTab("gross");
    }
  }, [round, hasGross, hasNet]);

  if (loading) {
    return (
      <Layout title="Loading..." showBack series={tSeries} tournamentLogo={tLogo}>
        <div className="px-4 py-10">
          <Card className="mx-auto max-w-sm border-slate-200/80 bg-white/90">
            <CardContent className="flex items-center gap-3 py-6">
              <div className="spinner" />
              <div>
                <div className="text-sm font-semibold text-slate-900">Loading skins</div>
                <div className="text-xs text-muted-foreground">Preparing hole results.</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Skins" showBack series={tSeries} tournamentLogo={tLogo}>
        <div className="px-4 py-10">
          <Card className="mx-auto max-w-md border-red-200 bg-red-50/70">
            <CardContent className="py-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="text-sm font-semibold text-red-700">Unable to load skins</div>
              <div className="mt-1 text-sm text-red-600">{error}</div>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  if (!round || !skinsEnabled) {
    if (!round) {
      return (
        <Layout title="Skins" showBack series={tSeries} tournamentLogo={tLogo}>
          <div className="px-4 py-10">
            <Card className="mx-auto max-w-md border-slate-200/80 bg-white/90 text-center">
              <CardContent className="py-8">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                  <Target className="h-6 w-6" />
                </div>
                <div className="text-lg font-semibold text-slate-900">Round not found</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  This round is not available right now.
                </div>
                <Button asChild className="mt-4">
                  <Link to="/">Go Home</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </Layout>
      );
    }

    return (
      <Layout title="Skins" showBack series={tSeries} tournamentLogo={tLogo}>
        <div className="px-4 py-10">
          <Card className="mx-auto max-w-md border-slate-200/80 bg-white/90 text-center">
            <CardContent className="py-8">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <Target className="h-6 w-6" />
              </div>
              <div className="text-lg font-semibold text-slate-900">Skins not configured</div>
              <div className="mt-1 text-sm text-muted-foreground">
                No skins game has been set for this round.
              </div>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const leaderboard = playerTotals
    .filter((player) => (selectedTab === "gross" ? player.grossSkinsWon > 0 : player.netSkinsWon > 0))
    .sort((a, b) => {
      if (selectedTab === "gross") {
        return b.grossSkinsWon - a.grossSkinsWon || b.grossEarnings - a.grossEarnings;
      }
      return b.netSkinsWon - a.netSkinsWon || b.netEarnings - a.netEarnings;
    });

  const totalPot =
    selectedTab === "gross" ? round.skinsGrossPot ?? 0 : round.skinsNetPot ?? 0;
  const skinsWonCount = holeSkinsData.filter((hole) =>
    selectedTab === "gross" ? hole.grossWinner !== null : hole.netWinner !== null
  ).length;
  const valuePerSkin = skinsWonCount > 0 ? totalPot / skinsWonCount : 0;

  const roundLabel = round.day ? `Round ${round.day}` : "Round";

  return (
    <Layout title={tName} series={tSeries} showBack tournamentLogo={tLogo}>
      <motion.div
        className="space-y-6 px-4 py-6"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        <motion.section variants={itemVariants}>
          <Card className="relative overflow-hidden border-white/50 bg-white/85 shadow-xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.05),_transparent_65%)]" />
            <CardContent className="relative space-y-5 py-6">
              <div className="text-center">
                <div className="text-2xl font-semibold text-slate-900">Skins Game</div>
                <div className="mt-1 text-sm text-muted-foreground">{roundLabel} • {skinModeLabel}</div>
              </div>

              {hasGross && hasNet && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant={selectedTab === "gross" ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() => setSelectedTab("gross")}
                  >
                    Gross Skins
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedTab === "net" ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() => setSelectedTab("net")}
                  >
                    Net Skins
                  </Button>
                </div>
              )}

              <div className="grid gap-3">
                <Card className="border-slate-200/70 bg-slate-50/80">
                  <CardContent className="text-center py-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Total Pot
                    </div>
                    <div className="text-2xl font-semibold text-slate-900 mt-2">
                      ${totalPot.toFixed(0)}
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {skinsWonCount} skin{skinsWonCount !== 1 ? "s" : ""} won • {skinsWonCount > 0 ? `$${valuePerSkin.toFixed(2)} per skin` : "--"}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </motion.section>

        <motion.section variants={itemVariants}>
          <Card className="border-slate-200/80 bg-white/85">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trophy className="h-4 w-4 text-primary" />
                  Leaderboard
                </CardTitle>
                <CardDescription>
                  {selectedTab === "gross" ? "Gross skins results" : "Net skins results"}
                </CardDescription>
              </div>
              <Badge variant="outline" className="uppercase tracking-[0.2em]">
                {leaderboard.length} players
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {leaderboard.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center text-sm text-muted-foreground">
                  No skins won yet
                </div>
              ) : (
                leaderboard.map((player, idx) => {
                  const playerSkins =
                    selectedTab === "gross" ? player.grossSkinsWon : player.netSkinsWon;
                  const playerHoles =
                    selectedTab === "gross" ? player.grossHoles : player.netHoles;
                  const earnings =
                    selectedTab === "gross" ? player.grossEarnings : player.netEarnings;
                  const isLeader = idx === 0;

                  return (
                    <div
                      key={player.playerId}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-4 rounded-xl border px-4 py-3",
                        isLeader
                          ? "border-primary/30 bg-primary/5"
                          : "border-slate-200/80 bg-white/80"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold",
                            isLeader
                              ? "bg-primary text-primary-foreground"
                              : "bg-slate-100 text-slate-600"
                          )}
                        >
                          {isLeader ? <Crown className="h-5 w-5" /> : idx + 1}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {player.playerName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {playerSkins} skin{playerSkins !== 1 ? "s" : ""} - Holes{" "}
                            {playerHoles.join(", ")}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Earnings
                        </div>
                        <div className="text-lg font-semibold text-emerald-600">
                          ${earnings.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </motion.section>

        <motion.section variants={itemVariants}>
          <Card className="border-slate-200/80 bg-white/85">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="h-4 w-4 text-primary" />
                  Hole Results
                </CardTitle>
                <CardDescription>Tap a hole to see full scoring.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {holeSkinsData.map((hole) => {
                const isExpanded = expandedHole === hole.holeNumber;
                const winner = selectedTab === "gross" ? hole.grossWinner : hole.netWinner;
                const lowScore = selectedTab === "gross" ? hole.grossLowScore : hole.netLowScore;
                const par = hole.par;
                const tiedCount = selectedTab === "gross" ? hole.grossTiedCount : hole.netTiedCount;

                let winnerText = "--";
                if (lowScore !== null) {
                  if (winner) {
                    const playerName =
                      hole.allScores.find((score) => score.playerId === winner)?.playerName ||
                      winner;
                    winnerText = playerName;
                  } else if (tiedCount > 1) {
                    winnerText = `${tiedCount} players tied`;
                  }
                }

                const allPlayersCompleted = hole.allPlayersCompleted;
                const isHoleWinner = !!winner && lowScore !== null;

                return (
                  <Card
                    key={hole.holeNumber}
                    className={cn(
                      "overflow-hidden border-slate-200/80",
                      allPlayersCompleted ? "bg-emerald-50/40" : "bg-white"
                    )}
                  >
                    <button
                      onClick={() => setExpandedHole(isExpanded ? null : hole.holeNumber)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition",
                        allPlayersCompleted
                          ? "bg-emerald-50/70 hover:bg-emerald-50"
                          : "bg-slate-50/70 hover:bg-slate-50"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold",
                            allPlayersCompleted
                              ? "border-emerald-200 bg-white text-emerald-700"
                              : "border-slate-200 bg-white text-slate-600"
                          )}
                        >
                          {hole.holeNumber}
                        </div>
                        <div>
                          <div
                            className={cn(
                              "text-sm font-semibold",
                              isHoleWinner ? "text-slate-900" : "text-slate-700"
                            )}
                          >
                            {winnerText}
                          </div>
                          <div className="text-xs text-muted-foreground">Par {hole.par}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {lowScore !== null && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              allPlayersCompleted
                                ? "border-emerald-200 text-emerald-700"
                                : "border-slate-200 text-slate-600"
                            )}
                          >
                            {scoreLabel(lowScore, par)}
                          </Badge>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-slate-500" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-slate-500" />
                        )}
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-3 px-4 pb-4">
                            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                              <span>All Scores</span>
                              <span>{selectedTab === "gross" ? "Gross" : "Net"}</span>
                            </div>
                            <div className="space-y-2">
                              {(() => {
                                const sorted = [...hole.allScores].sort((a, b) => {
                                  const aVal = selectedTab === "gross" ? a.gross : a.net;
                                  const bVal = selectedTab === "gross" ? b.gross : b.net;

                                  const aCompleted = aVal !== null && aVal !== undefined;
                                  const bCompleted = bVal !== null && bVal !== undefined;

                                  if (aCompleted && !bCompleted) return -1;
                                  if (!aCompleted && bCompleted) return 1;

                                  if (aCompleted && bCompleted) {
                                    if (aVal !== bVal) return (aVal as number) - (bVal as number);
                                    return a.playerName.localeCompare(b.playerName);
                                  }

                                  const aThru = a.playerThru ?? 0;
                                  const bThru = b.playerThru ?? 0;
                                  if (aThru !== bThru) return bThru - aThru;

                                  const aT = a.playerTeeTime
                                    ? a.playerTeeTime.toDate
                                      ? a.playerTeeTime.toDate().getTime()
                                      : new Date(a.playerTeeTime).getTime()
                                    : null;
                                  const bT = b.playerTeeTime
                                    ? b.playerTeeTime.toDate
                                      ? b.playerTeeTime.toDate().getTime()
                                      : new Date(b.playerTeeTime).getTime()
                                    : null;

                                  if (aT !== null && bT !== null) return aT - bT;
                                  if (aT !== null && bT === null) return -1;
                                  if (aT === null && bT !== null) return 1;

                                  return a.playerName.localeCompare(b.playerName);
                                });

                                return sorted.map((score) => {
                                  const scoreValue = selectedTab === "gross" ? score.gross : score.net;
                                  const hasScore = scoreValue !== null && scoreValue !== undefined;
                                  const isWinner = score.playerId === winner;
                                  const thru = score.playerThru ?? 0;
                                  const scoreDisplay = hasScore
                                    ? scoreLabel(scoreValue as number, hole.par)
                                    : thru === 0 && score.playerTeeTime
                                      ? formatTeeTime(score.playerTeeTime)
                                      : `Thru ${thru}`;

                                  return (
                                    <div
                                      key={score.playerId}
                                      className={cn(
                                        "flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
                                        isWinner
                                          ? "border-emerald-200 bg-emerald-50"
                                          : "border-slate-200 bg-slate-50/70"
                                      )}
                                    >
                                      <div className="flex items-center gap-2 text-slate-900">
                                        <span className="font-medium">{score.playerName}</span>
                                        {selectedTab === "net" && score.hasStroke && (
                                          <span className="inline-flex h-2 w-2 rounded-full bg-blue-500" />
                                        )}
                                      </div>
                                      <div
                                        className={cn(
                                          "text-sm font-semibold",
                                          hasScore ? "text-slate-900" : "text-slate-400"
                                        )}
                                      >
                                        {scoreDisplay}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                );
              })}
            </CardContent>
          </Card>
        </motion.section>

        <motion.div variants={itemVariants}>
          <LastUpdated />
        </motion.div>
      </motion.div>
    </Layout>
  );
}

export default memo(SkinsComponent);
