import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { Trophy } from "lucide-react";
import { db } from "../firebase";
import type { RoundRecapDoc, TournamentDoc, VsAllRecord } from "../types";
import Layout from "../components/Layout";
import { useTournamentContextOptional } from "../contexts/TournamentContext";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "../components/ui/card";
import { cn } from "../lib/utils";

export default function RoundRecap() {
  const { roundId } = useParams<{ roundId: string }>();
  const [recap, setRecap] = useState<RoundRecapDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"vsAll" | "grossScoring" | "netScoring" | "holes">("grossScoring");
  const [grossTab, setGrossTab] = useState<"scores" | "birdies" | "eagles">("scores");
  const [netTab, setNetTab] = useState<"scores" | "birdies" | "eagles">("scores");
  const [netScoreView, setNetScoreView] = useState<"team" | "individual">("team");
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const tournamentContext = useTournamentContextOptional();

  useEffect(() => {
    if (!roundId) return;

    const fetchRecap = async () => {
      setLoading(true);
      setError(null);
      try {
        const recapSnap = await getDoc(doc(db, "roundRecaps", roundId));
        if (!recapSnap.exists()) {
          setError("Recap not found");
          setRecap(null);
        } else {
          const recapData = recapSnap.data() as RoundRecapDoc;
          setRecap(recapData);
        }
      } catch (err) {
        console.error("Failed to load recap:", err);
        setError("Failed to load recap");
      } finally {
        setLoading(false);
      }
    };

    fetchRecap();
  }, [roundId]);

  useEffect(() => {
    const tournamentId = recap?.tournamentId;
    if (!tournamentId) {
      setTournament(null);
      return;
    }
    const tournamentIdSafe = tournamentId;

    if (tournamentContext?.tournament?.id === tournamentIdSafe) {
      setTournament(tournamentContext.tournament);
      return;
    }

    let cancelled = false;
    async function fetchTournament() {
      try {
        const snap = await getDoc(doc(db, "tournaments", tournamentIdSafe));
        if (cancelled) return;
        if (snap.exists()) {
          setTournament({ id: snap.id, ...snap.data() } as TournamentDoc);
        }
      } catch (err) {
        console.error("Failed to load tournament:", err);
      }
    }
    fetchTournament();

    return () => {
      cancelled = true;
    };
  }, [recap?.tournamentId, tournamentContext?.tournament]);

  if (loading) {
    return (
      <Layout title="Round Recap" showBack series={tournament?.series} tournamentLogo={tournament?.tournamentLogo}>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="spinner-lg"></div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Round Recap" showBack series={tournament?.series} tournamentLogo={tournament?.tournamentLogo}>
        <div className="px-4 py-10">
          <Card className="mx-auto max-w-md border-red-200 bg-red-50/70 text-center">
            <CardContent className="py-6 text-sm font-semibold text-red-700">
              {error}
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  if (!recap) {
    return (
      <Layout title="Round Recap" showBack series={tournament?.series} tournamentLogo={tournament?.tournamentLogo}>
        <div className="px-4 py-10">
          <Card className="mx-auto max-w-md border-slate-200/80 bg-white/90 text-center">
            <CardContent className="py-6 text-sm text-muted-foreground">
              Recap not available.
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const isTeamFormat = recap.format !== "singles";
  let displayVsAll: Array<VsAllRecord & { displayName?: string }> = [];

  if (isTeamFormat) {
    const teamMap = new Map<string, VsAllRecord[]>();
    for (const record of recap.vsAllRecords) {
      const key = record.teamKey || record.playerId;
      if (!teamMap.has(key)) teamMap.set(key, []);
      teamMap.get(key)!.push(record);
    }

    for (const [teamKey, members] of teamMap.entries()) {
      const firstMember = members[0];
      const playerNames = members.map((member) => member.playerName).join(" / ");
      displayVsAll.push({
        ...firstMember,
        displayName: playerNames,
        playerId: teamKey,
      });
    }
  } else {
    displayVsAll = recap.vsAllRecords.map((record) => ({
      ...record,
      displayName: record.playerName,
    }));
  }
  
  const sortedVsAll = [...displayVsAll].sort((a, b) => {
    const totalA = a.wins + a.losses + a.ties;
    const totalB = b.wins + b.losses + b.ties;
    const winPctA = totalA > 0 ? a.wins / totalA : 0;
    const winPctB = totalB > 0 ? b.wins / totalB : 0;
    
    if (winPctB !== winPctA) return winPctB - winPctA;
    return b.wins - a.wins;
  });

  const formatWinPct = (record: VsAllRecord) => {
    const total = record.wins + record.losses + record.ties;
    if (total === 0) return "--";
    const pct = (record.wins / total) * 100;
    return `${pct.toFixed(1)}%`;
  };

  const formatPar = (value: number) => {
    if (value === 0) return "E";
    return value > 0 ? `+${value}` : `${value}`;
  };

  const formatLabel = (format?: string | null) => {
    switch (format) {
      case "singles":
        return "Singles";
      case "twoManBestBall":
        return "2-man Best Ball";
      case "twoManShamble":
        return "2-man Shamble";
      case "twoManScramble":
        return "2-man Scramble";
      case "fourManScramble":
        return "4-man Scramble";
      default:
        return format || "";
    }
  };

  const renderNameLines = (name: string) => {
    const parts = name.split(" / ").filter(Boolean);
    if (parts.length > 1) {
      return parts.map((part, index) => (
        <div key={`${name}-${index}`} className="truncate">
          {part}
        </div>
      ));
    }
    return <div className="truncate">{name}</div>;
  };

  const courseLine = `${formatLabel(recap.format)} - Par ${recap.coursePar}`;
  const dayLine = recap.day ? `Day ${recap.day}` : "Round Recap";

  return (
    <Layout title="Round Recap" showBack series={tournament?.series} tournamentLogo={tournament?.tournamentLogo}>
      <div className="space-y-6 px-4 py-6">
        <section>
          <Card className="relative overflow-hidden border-white/50 bg-white/85 shadow-xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.05),_transparent_65%)]" />
            <CardContent className="relative space-y-5 py-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  <Trophy className="h-4 w-4 text-primary" />
                  Round Recap
                </div>
                <Badge variant="secondary" className="uppercase tracking-[0.2em]">
                  {dayLine}
                </Badge>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-slate-900">{recap.courseName}</div>
                <div className="mt-1 text-sm text-muted-foreground">{courseLine}</div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="sm"
              variant={viewMode === "grossScoring" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setViewMode("grossScoring")}
            >
              Gross Scoring
            </Button>
            <Button
              size="sm"
              variant={viewMode === "netScoring" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setViewMode("netScoring")}
            >
              Net Scoring
            </Button>
            <Button
              size="sm"
              variant={viewMode === "vsAll" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setViewMode("vsAll")}
            >
              vs All
            </Button>
            <Button
              size="sm"
              variant={viewMode === "holes" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setViewMode("holes")}
            >
              Hole Stats
            </Button>
          </div>
        </section>

        <section>
          {viewMode === "vsAll" && (
            <div>
              <Card className="border-slate-200/80 bg-white/85">
                  <CardHeader>
                    <CardDescription>
                      Simulated record if each player or team played all others.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto rounded-xl border border-slate-200/70">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left">Rank</th>
                            <th className="px-3 py-2 text-left">Player</th>
                            <th className="px-3 py-2 text-center">W</th>
                            <th className="px-3 py-2 text-center">L</th>
                            <th className="px-3 py-2 text-center">T</th>
                            <th className="px-3 py-2 text-center">Win %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedVsAll.map((record, idx) => (
                            <tr key={record.playerId} className="border-t border-slate-100">
                              <td className="px-3 py-3 text-left font-semibold text-slate-500">
                                {idx + 1}
                              </td>
                              <td className="px-3 py-3">
                                <div className="max-w-[18rem] text-sm font-semibold text-slate-900">
                                  {renderNameLines(record.displayName || record.playerName)}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-center font-semibold text-emerald-600">
                                {record.wins}
                              </td>
                              <td className="px-3 py-3 text-center font-semibold text-rose-600">
                                {record.losses}
                              </td>
                              <td className="px-3 py-3 text-center text-slate-500">
                                {record.ties}
                              </td>
                              <td className="px-3 py-3 text-center font-semibold text-slate-900">
                                {formatWinPct(record)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {viewMode === "grossScoring" && (
              <div>
                <Card className="border-slate-200/80 bg-white/85">
                  <CardHeader className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={grossTab === "scores" ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => setGrossTab("scores")}
                      >
                        Scores
                      </Button>
                      <Button
                        size="sm"
                        variant={grossTab === "birdies" ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => setGrossTab("birdies")}
                      >
                        Birdies
                      </Button>
                      <Button
                        size="sm"
                        variant={grossTab === "eagles" ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => setGrossTab("eagles")}
                      >
                        Eagles
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {grossTab === "scores" && (
                      <div className="space-y-5">
                        {recap.leaders.scoringGross && recap.leaders.scoringGross.length > 0 && (
                          <div className="space-y-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                              Individual Gross
                            </div>
                            {recap.leaders.scoringGross.map((leader, idx) => (
                              <div
                                key={leader.playerId}
                                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                                    {idx + 1}
                                  </div>
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">
                                      {leader.playerName}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {leader.totalGross != null ? `Gross ${leader.totalGross}` : formatPar(leader.strokesVsPar)}
                                      {leader.holesCompleted < 18 && ` (thru ${leader.holesCompleted})`}
                                    </div>
                                  </div>
                                </div>
                                <div
                                  className={cn(
                                    "text-lg font-semibold",
                                    leader.strokesVsPar <= 0 ? "text-emerald-600" : "text-rose-600"
                                  )}
                                >
                                  {formatPar(leader.strokesVsPar)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {recap.leaders.scoringTeamGross && recap.leaders.scoringTeamGross.length > 0 && (
                          <div className="space-y-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                              Team Gross
                            </div>
                            {recap.leaders.scoringTeamGross.map((leader, idx) => (
                              <div
                                key={leader.playerId}
                                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                                    {idx + 1}
                                  </div>
                                  <div className="text-sm font-semibold text-slate-900">
                                    {renderNameLines(leader.playerName)}
                                  </div>
                                </div>
                                <div
                                  className={cn(
                                    "text-lg font-semibold",
                                    leader.strokesVsPar <= 0 ? "text-emerald-600" : "text-rose-600"
                                  )}
                                >
                                  {formatPar(leader.strokesVsPar)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {(!recap.leaders.scoringGross || recap.leaders.scoringGross.length === 0) &&
                          (!recap.leaders.scoringTeamGross || recap.leaders.scoringTeamGross.length === 0) && (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center text-sm text-muted-foreground">
                              No gross scoring data available.
                            </div>
                          )}
                      </div>
                    )}

                    {grossTab === "birdies" && (
                      <div className="space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Gross Birdies
                        </div>
                        {recap.leaders.birdiesGross && recap.leaders.birdiesGross.length > 0 ? (
                          recap.leaders.birdiesGross.map((leader, idx) => (
                            <div
                              key={leader.playerId}
                              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3"
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                                  {idx + 1}
                                </div>
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">
                                    {renderNameLines(leader.playerName)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Holes: {leader.holes.join(", ")}
                                  </div>
                                </div>
                              </div>
                              <div className="text-lg font-semibold text-sky-600">
                                {leader.count}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center text-sm text-muted-foreground">
                            No gross birdies recorded.
                          </div>
                        )}
                      </div>
                    )}

                    {grossTab === "eagles" && (
                      <div className="space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Gross Eagles
                        </div>
                        {recap.leaders.eaglesGross && recap.leaders.eaglesGross.length > 0 ? (
                          recap.leaders.eaglesGross.map((leader, idx) => (
                            <div
                              key={leader.playerId}
                              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3"
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                                  {idx + 1}
                                </div>
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">
                                    {renderNameLines(leader.playerName)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Holes: {leader.holes.join(", ")}
                                  </div>
                                </div>
                              </div>
                              <div className="text-lg font-semibold text-amber-500">
                                {leader.count}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center text-sm text-muted-foreground">
                            No gross eagles recorded.
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {viewMode === "netScoring" && (
              <div>
                <Card className="border-slate-200/80 bg-white/85">
                  <CardHeader className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={netTab === "scores" ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => setNetTab("scores")}
                      >
                        Scores
                      </Button>
                      <Button
                        size="sm"
                        variant={netTab === "birdies" ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => setNetTab("birdies")}
                      >
                        Birdies
                      </Button>
                      <Button
                        size="sm"
                        variant={netTab === "eagles" ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => setNetTab("eagles")}
                      >
                        Eagles
                      </Button>
                    </div>
                    {recap.format === "twoManBestBall" && netTab === "scores" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant={netScoreView === "team" ? "default" : "outline"}
                          className="rounded-full"
                          onClick={() => setNetScoreView("team")}
                        >
                          Team Score
                        </Button>
                        <Button
                          size="sm"
                          variant={netScoreView === "individual" ? "default" : "outline"}
                          className="rounded-full"
                          onClick={() => setNetScoreView("individual")}
                        >
                          Individual Score
                        </Button>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {netTab === "scores" && (
                      <div className="space-y-5">
                        {(recap.format !== "twoManBestBall" || netScoreView === "individual") &&
                          recap.leaders.scoringNet &&
                          recap.leaders.scoringNet.length > 0 && (
                            <div className="space-y-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                                Individual Net
                              </div>
                              {recap.leaders.scoringNet.map((leader, idx) => (
                                <div
                                  key={leader.playerId}
                                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                                      {idx + 1}
                                    </div>
                                    <div>
                                      <div className="text-sm font-semibold text-slate-900">
                                        {leader.playerName}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {leader.totalNet != null ? `Net ${leader.totalNet}` : formatPar(leader.strokesVsPar)}
                                        {leader.holesCompleted < 18 && ` (thru ${leader.holesCompleted})`}
                                      </div>
                                    </div>
                                  </div>
                                  <div
                                    className={cn(
                                      "text-lg font-semibold",
                                      leader.strokesVsPar <= 0 ? "text-emerald-600" : "text-rose-600"
                                    )}
                                  >
                                    {formatPar(leader.strokesVsPar)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                        {(recap.format !== "twoManBestBall" || netScoreView === "team") &&
                          recap.leaders.scoringTeamNet &&
                          recap.leaders.scoringTeamNet.length > 0 && (
                            <div className="space-y-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                                Team Net
                              </div>
                              {recap.leaders.scoringTeamNet.map((leader, idx) => (
                                <div
                                  key={leader.playerId}
                                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                                      {idx + 1}
                                    </div>
                                    <div className="text-sm font-semibold text-slate-900">
                                      {renderNameLines(leader.playerName)}
                                    </div>
                                  </div>
                                  <div
                                    className={cn(
                                      "text-lg font-semibold",
                                      leader.strokesVsPar <= 0 ? "text-emerald-600" : "text-rose-600"
                                    )}
                                  >
                                    {formatPar(leader.strokesVsPar)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                        {(!recap.leaders.scoringNet || recap.leaders.scoringNet.length === 0) &&
                          (!recap.leaders.scoringTeamNet || recap.leaders.scoringTeamNet.length === 0) && (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center text-sm text-muted-foreground">
                              No net scoring data available.
                            </div>
                          )}
                      </div>
                    )}

                    {netTab === "birdies" && (
                      <div className="space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Net Birdies
                        </div>
                        {recap.leaders.birdiesNet && recap.leaders.birdiesNet.length > 0 ? (
                          recap.leaders.birdiesNet.map((leader, idx) => (
                            <div
                              key={leader.playerId}
                              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3"
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                                  {idx + 1}
                                </div>
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">
                                    {renderNameLines(leader.playerName)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Holes: {leader.holes.join(", ")}
                                  </div>
                                </div>
                              </div>
                              <div className="text-lg font-semibold text-sky-600">
                                {leader.count}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center text-sm text-muted-foreground">
                            No net birdies recorded.
                          </div>
                        )}
                      </div>
                    )}

                    {netTab === "eagles" && (
                      <div className="space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Net Eagles
                        </div>
                        {recap.leaders.eaglesNet && recap.leaders.eaglesNet.length > 0 ? (
                          recap.leaders.eaglesNet.map((leader, idx) => (
                            <div
                              key={leader.playerId}
                              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3"
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                                  {idx + 1}
                                </div>
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">
                                    {renderNameLines(leader.playerName)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Holes: {leader.holes.join(", ")}
                                  </div>
                                </div>
                              </div>
                              <div className="text-lg font-semibold text-amber-500">
                                {leader.count}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center text-sm text-muted-foreground">
                            No net eagles recorded.
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {viewMode === "holes" && (
              <div>
                <Card className="border-slate-200/80 bg-white/85">
                  <CardHeader className="space-y-4" />
                  <CardContent className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-2">
                      {recap.leaders.bestHole && (
                        <Card className="border-emerald-200 bg-emerald-50/60">
                          <CardContent className="py-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                              Easiest Hole
                            </div>
                            <div className="text-2xl font-semibold text-emerald-900">
                              Hole {recap.leaders.bestHole.holeNumber}
                            </div>
                            <div className="text-sm text-emerald-700">
                              {recap.leaders.bestHole.avgStrokesUnderPar.toFixed(2)} under par avg
                            </div>
                          </CardContent>
                        </Card>
                      )}
                      {recap.leaders.worstHole && (
                        <Card className="border-rose-200 bg-rose-50/60">
                          <CardContent className="py-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">
                              Hardest Hole
                            </div>
                            <div className="text-2xl font-semibold text-rose-900">
                              Hole {recap.leaders.worstHole.holeNumber}
                            </div>
                            <div className="text-sm text-rose-700">
                              +{recap.leaders.worstHole.avgStrokesOverPar.toFixed(2)} over par avg
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200/70">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left">Hole</th>
                            <th className="px-3 py-2 text-center">Par</th>
                            <th className="px-3 py-2 text-center">Avg Gross</th>
                            <th className="px-3 py-2 text-center">Avg Net</th>
                            <th className="px-3 py-2 text-center">Low Gross</th>
                            <th className="px-3 py-2 text-center">High Gross</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recap.holeAverages.map((hole) => (
                            <tr key={hole.holeNumber} className="border-t border-slate-100">
                              <td className="px-3 py-3 font-semibold text-slate-900">{hole.holeNumber}</td>
                              <td className="px-3 py-3 text-center text-slate-600">{hole.par}</td>
                              <td className="px-3 py-3 text-center font-semibold text-slate-900">
                                {hole.avgGross != null ? hole.avgGross.toFixed(2) : "--"}
                              </td>
                              <td className="px-3 py-3 text-center text-slate-500">
                                {hole.avgNet != null ? hole.avgNet.toFixed(2) : "--"}
                              </td>
                              <td className="px-3 py-3 text-center text-emerald-600">
                                {hole.lowestGross != null ? hole.lowestGross : "--"}
                              </td>
                              <td className="px-3 py-3 text-center text-rose-600">
                                {hole.highestGross != null ? hole.highestGross : "--"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
        </section>
      </div>
    </Layout>
  );
}
