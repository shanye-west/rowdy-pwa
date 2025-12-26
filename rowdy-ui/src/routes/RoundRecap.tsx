import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { RoundRecapDoc, VsAllRecord } from "../types";
import Layout from "../components/Layout";

export default function RoundRecap() {
  const { roundId } = useParams<{ roundId: string }>();
  const [recap, setRecap] = useState<RoundRecapDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"vsAll" | "grossScoring" | "netScoring" | "holes">("vsAll");
  const [grossTab, setGrossTab] = useState<"scores" | "birdies" | "eagles">("scores");
  const [netTab, setNetTab] = useState<"scores" | "birdies" | "eagles">("scores");
  const [netScoreView, setNetScoreView] = useState<"team" | "individual">("team");

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

  // Short-circuit while loading / error / missing recap to avoid many null checks below
  if (loading) {
    return (
      <Layout title="Round Recap" showBack>
        <div className="p-4">Loading recap…</div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Round Recap" showBack>
        <div className="p-4 text-red-600">{error}</div>
      </Layout>
    );
  }

  if (!recap) {
    return (
      <Layout title="Round Recap" showBack>
        <div className="p-4">Recap not available</div>
      </Layout>
    );
  }

  // For team formats, deduplicate vsAll records by teamKey
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
      const playerNames = members.map(m => m.playerName).join(" / ");
      displayVsAll.push({
        ...firstMember,
        displayName: playerNames,
        playerId: teamKey,
      });
    }
  } else {
    // Singles: use records as-is
    displayVsAll = recap.vsAllRecords.map(r => ({ ...r, displayName: r.playerName }));
  }
  
  // Sort vsAll by win percentage
  const sortedVsAll = [...displayVsAll].sort((a, b) => {
    const totalA = a.wins + a.losses + a.ties;
    const totalB = b.wins + b.losses + b.ties;
    const winPctA = totalA > 0 ? a.wins / totalA : 0;
    const winPctB = totalB > 0 ? b.wins / totalB : 0;
    
    if (winPctB !== winPctA) return winPctB - winPctA;
    return b.wins - a.wins; // Tie-break by total wins
  });

  // (Gross/Net birdie and eagle lists are accessed directly in each scoring tab)

  const formatWinPct = (record: VsAllRecord) => {
    const total = record.wins + record.losses + record.ties;
    if (total === 0) return "—";
    const pct = (record.wins / total) * 100;
    return pct.toFixed(1) + "%";
  };

  return (
    <Layout title="Round Recap" showBack>
      <div className="p-4 space-y-4 max-w-6xl mx-auto">
        {/* Header */}
        <div className="card p-6">
          <h1 className="text-2xl font-bold mb-2">{recap.courseName}</h1>
          <div className="text-sm text-gray-600">
            Day {recap.day} • {recap.format} • Par {recap.coursePar}
          </div>
        </div>

        {/* View Mode Tabs */}
        <div className="flex gap-2 overflow-x-auto">
          <button
            onClick={() => setViewMode("vsAll")}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${viewMode === "vsAll" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            vs All
          </button>
          <button
            onClick={() => setViewMode("grossScoring")}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${viewMode === "grossScoring" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            Gross Scoring
          </button>
          <button
            onClick={() => setViewMode("netScoring")}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${viewMode === "netScoring" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            Net Scoring
          </button>
          <button
            onClick={() => setViewMode("holes")}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${viewMode === "holes" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            Hole Stats
          </button>
        </div>

        {/* vs All View */}
        {viewMode === "vsAll" && (
          <div className="card p-6">
            <p className="text-sm text-gray-600 mb-6">
              Simulated record if each player/team played against all others
            </p>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Rank</th>
                    <th className="text-left py-2 px-2">Player</th>
                    <th className="text-center py-2 px-2">W</th>
                    <th className="text-center py-2 px-2">L</th>
                    <th className="text-center py-2 px-2">T</th>
                    <th className="text-center py-2 px-2">Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedVsAll.map((record, idx) => (
                    <tr key={record.playerId} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-2 font-bold text-gray-500">{idx + 1}</td>
                      <td className="py-3 px-2 font-medium">
                        <div className="max-w-[18rem]">
                          {isTeamFormat && (record.displayName || record.playerName).includes(" / ") ? (
                            (record.displayName || record.playerName).split(" / ").map((n, i) => (
                              <div key={i} className="truncate">{n}</div>
                            ))
                          ) : (
                            <div className="truncate">{record.displayName || record.playerName}</div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center text-green-700 font-semibold">
                        {record.wins}
                      </td>
                      <td className="py-3 px-2 text-center text-red-700 font-semibold">
                        {record.losses}
                      </td>
                      <td className="py-3 px-2 text-center text-gray-600">
                        {record.ties}
                      </td>
                      <td className="py-3 px-2 text-center font-bold">
                        {formatWinPct(record)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Gross Scoring Tab */}
        {viewMode === "grossScoring" && (
          <div className="card p-6">
            <div className="flex items-center justify-center mb-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setGrossTab("scores")}
                  className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${grossTab === "scores" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  Scores
                </button>
                <button
                  onClick={() => setGrossTab("birdies")}
                  className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${grossTab === "birdies" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  Birdies
                </button>
                <button
                  onClick={() => setGrossTab("eagles")}
                  className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${grossTab === "eagles" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  Eagles
                </button>
              </div>
            </div>
            {grossTab === "scores" && (
              <div className="space-y-3">
                {/* Individual and team gross scoring leaders */}
                {recap.leaders.scoringGross && recap.leaders.scoringGross.length > 0 && (
                  <>
                    <div className="font-semibold mb-2">Individual Gross <span className="text-sm text-gray-500">— ranked by score per 18 holes</span></div>
                    {recap.leaders.scoringGross.map((leader, idx) => (
                      <div key={leader.playerId} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                        <div className="text-2xl font-bold text-gray-400 w-8">{idx + 1}</div>
                        <div className="flex-1">
                          <div className="font-semibold text-lg">{leader.playerName}</div>
                          <div className="text-sm text-gray-600">
                            {leader.totalGross != null ? `Gross ${leader.totalGross}` : `${leader.strokesVsPar > 0 ? "+" : ""}${leader.strokesVsPar}`}
                            {leader.holesCompleted < 18 && ` (thru ${leader.holesCompleted})`}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-3xl font-bold ${leader.strokesVsPar <= 0 ? "text-green-600" : "text-red-600"}`}>
                            {leader.strokesVsPar > 0 ? "+" : ""}{leader.strokesVsPar}
                          </div>
                          {/* per-18 removed; ranking note shown in header */}
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {recap.leaders.scoringTeamGross && recap.leaders.scoringTeamGross.length > 0 && (
                  <>
                    <div className="font-semibold mt-6 mb-2">Team Gross</div>
                    {recap.leaders.scoringTeamGross.map((leader, idx) => (
                      <div key={leader.playerId} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                        <div className="text-2xl font-bold text-gray-400 w-8">{idx + 1}</div>
                        <div className="flex-1">
                          <div className="font-semibold text-lg">
                            {leader.playerName.split(" / ").map((n, i) => (
                              <div key={i}>{n}</div>
                            ))}
                          </div>
                          <div className="text-sm text-gray-600">
                            {leader.strokesVsPar > 0 ? "+" : ""}{leader.strokesVsPar}
                            {leader.holesCompleted < 18 && ` (thru ${leader.holesCompleted})`}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-3xl font-bold ${leader.strokesVsPar <= 0 ? "text-green-600" : "text-red-600"}`}>
                            {leader.strokesVsPar > 0 ? "+" : ""}{leader.strokesVsPar}
                          </div>
                          {/* per-18 removed */}
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {(!recap.leaders.scoringGross || recap.leaders.scoringGross.length === 0) && (!recap.leaders.scoringTeamGross || recap.leaders.scoringTeamGross.length === 0) && (
                  <div className="text-gray-500 text-center py-8">No gross scoring data available</div>
                )}
              </div>
            )}
            {grossTab === "birdies" && (
              <div className="space-y-3">
                <div className="font-semibold mb-2">Gross Birdies</div>
                {recap.leaders.birdiesGross && recap.leaders.birdiesGross.length > 0 ? (
                  recap.leaders.birdiesGross.map((leader, idx) => (
                    <div key={leader.playerId} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-gray-400 w-8">{idx + 1}</div>
                      <div className="flex-1">
                        <div className="font-semibold">
                          <div className="max-w-[20rem]">
                            {recap.format !== "singles" && (leader.playerName || "").includes(" / ") ? (
                              (leader.playerName || "").split(" / ").map((n, i) => (
                                <div key={i} className="truncate">{n}</div>
                              ))
                            ) : (
                              <div className="truncate">{leader.playerName}</div>
                            )}
                          </div>
                        </div>
                        <div className="text-sm text-gray-600">Holes: {leader.holes.join(", ")}</div>
                      </div>
                      <div className="text-3xl font-bold text-blue-600">{leader.count}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-gray-500 text-center py-8">No gross birdies recorded</div>
                )}
              </div>
            )}
            {grossTab === "eagles" && (
              <div className="space-y-3">
                <div className="font-semibold mb-2">Gross Eagles</div>
                {recap.leaders.eaglesGross && recap.leaders.eaglesGross.length > 0 ? (
                  recap.leaders.eaglesGross.map((leader, idx) => (
                    <div key={leader.playerId} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-gray-400 w-8">{idx + 1}</div>
                      <div className="flex-1">
                        <div className="font-semibold">
                          <div className="max-w-[20rem]">
                            {recap.format !== "singles" && (leader.playerName || "").includes(" / ") ? (
                              (leader.playerName || "").split(" / ").map((n, i) => (
                                <div key={i} className="truncate">{n}</div>
                              ))
                            ) : (
                              <div className="truncate">{leader.playerName}</div>
                            )}
                          </div>
                        </div>
                        <div className="text-sm text-gray-600">Holes: {leader.holes.join(", ")}</div>
                      </div>
                      <div className="text-3xl font-bold text-yellow-600">{leader.count}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-gray-500 text-center py-8">No gross eagles recorded</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Net Scoring Tab */}
        {viewMode === "netScoring" && (
          <div className="card p-6">
            <div className="flex items-center justify-center mb-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setNetTab("scores")}
                  className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${netTab === "scores" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  Scores
                </button>
                <button
                  onClick={() => setNetTab("birdies")}
                  className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${netTab === "birdies" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  Birdies
                </button>
                <button
                  onClick={() => setNetTab("eagles")}
                  className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${netTab === "eagles" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  Eagles
                </button>
              </div>
            </div>
            {netTab === "scores" && (
              <div className="space-y-3">
                {/* For twoManBestBall, allow toggling between Team and Individual Net views */}
                {recap.format === "twoManBestBall" && (
                  <div className="flex gap-2 justify-center mb-2">
                    <button
                      onClick={() => setNetScoreView("team")}
                      className={`px-3 py-1 rounded-lg font-medium ${netScoreView === "team" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                    >
                      Team Score
                    </button>
                    <button
                      onClick={() => setNetScoreView("individual")}
                      className={`px-3 py-1 rounded-lg font-medium ${netScoreView === "individual" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                    >
                      Individual Score
                    </button>
                  </div>
                )}

                {/* Individual Net */}
                {(recap.format !== "twoManBestBall" || netScoreView === "individual") && (
                  recap.leaders.scoringNet && recap.leaders.scoringNet.length > 0 ? (
                    <>
                      <div className="font-semibold mb-2">Individual Net <span className="text-sm text-gray-500">— ranked by score per 18 holes</span></div>
                      {recap.leaders.scoringNet.map((leader, idx) => (
                        <div key={leader.playerId} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                          <div className="text-2xl font-bold text-gray-400 w-8">{idx + 1}</div>
                          <div className="flex-1">
                            <div className="font-semibold text-lg">{leader.playerName}</div>
                            <div className="text-sm text-gray-600">
                              {leader.totalNet != null ? `Net ${leader.totalNet}` : `${leader.strokesVsPar > 0 ? "+" : ""}${leader.strokesVsPar}`}
                              {leader.holesCompleted < 18 && ` (thru ${leader.holesCompleted})`}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-3xl font-bold ${leader.strokesVsPar <= 0 ? "text-green-600" : "text-red-600"}`}>
                              {leader.strokesVsPar > 0 ? "+" : ""}{leader.strokesVsPar}
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  ) : null
                )}

                {/* Team Net */}
                {(recap.format !== "twoManBestBall" || netScoreView === "team") && (
                  recap.leaders.scoringTeamNet && recap.leaders.scoringTeamNet.length > 0 ? (
                    <>
                      <div className="font-semibold mt-6 mb-2">Team Net</div>
                      {recap.leaders.scoringTeamNet.map((leader, idx) => (
                        <div key={leader.playerId} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                          <div className="text-2xl font-bold text-gray-400 w-8">{idx + 1}</div>
                          <div className="flex-1">
                            <div className="font-semibold text-lg">
                              {leader.playerName.split(" / ").map((n, i) => (
                                <div key={i}>{n}</div>
                              ))}
                            </div>
                            <div className="text-sm text-gray-600">
                              {leader.totalNet != null ? `Net ${leader.totalNet}` : `${leader.strokesVsPar > 0 ? "+" : ""}${leader.strokesVsPar}`}
                              {leader.holesCompleted < 18 && ` (thru ${leader.holesCompleted})`}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-3xl font-bold ${leader.strokesVsPar <= 0 ? "text-green-600" : "text-red-600"}`}>
                              {leader.strokesVsPar > 0 ? "+" : ""}{leader.strokesVsPar}
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  ) : null
                )}

                {(!recap.leaders.scoringNet || recap.leaders.scoringNet.length === 0) && (!recap.leaders.scoringTeamNet || recap.leaders.scoringTeamNet.length === 0) && (
                  <div className="text-gray-500 text-center py-8">No net scoring data available</div>
                )}
              </div>
            )}
            {netTab === "birdies" && (
              <div className="space-y-3">
                <div className="font-semibold mb-2">Net Birdies</div>
                {recap.leaders.birdiesNet && recap.leaders.birdiesNet.length > 0 ? (
                  recap.leaders.birdiesNet.map((leader, idx) => (
                    <div key={leader.playerId} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-gray-400 w-8">{idx + 1}</div>
                      <div className="flex-1">
                        <div className="font-semibold">
                          <div className="max-w-[20rem]">
                            {recap.format !== "singles" && (leader.playerName || "").includes(" / ") ? (
                              (leader.playerName || "").split(" / ").map((n, i) => (
                                <div key={i} className="truncate">{n}</div>
                              ))
                            ) : (
                              <div className="truncate">{leader.playerName}</div>
                            )}
                          </div>
                        </div>
                        <div className="text-sm text-gray-600">Holes: {leader.holes.join(", ")}</div>
                      </div>
                      <div className="text-3xl font-bold text-blue-600">{leader.count}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-gray-500 text-center py-8">No net birdies recorded</div>
                )}
              </div>
            )}
            {netTab === "eagles" && (
              <div className="space-y-3">
                <div className="font-semibold mb-2">Net Eagles</div>
                {recap.leaders.eaglesNet && recap.leaders.eaglesNet.length > 0 ? (
                  recap.leaders.eaglesNet.map((leader, idx) => (
                    <div key={leader.playerId} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-gray-400 w-8">{idx + 1}</div>
                      <div className="flex-1">
                        <div className="font-semibold">
                          <div className="max-w-[20rem]">
                            {recap.format !== "singles" && (leader.playerName || "").includes(" / ") ? (
                              (leader.playerName || "").split(" / ").map((n, i) => (
                                <div key={i} className="truncate">{n}</div>
                              ))
                            ) : (
                              <div className="truncate">{leader.playerName}</div>
                            )}
                          </div>
                        </div>
                        <div className="text-sm text-gray-600">Holes: {leader.holes.join(", ")}</div>
                      </div>
                      <div className="text-3xl font-bold text-yellow-600">{leader.count}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-gray-500 text-center py-8">No net eagles recorded</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Hole Stats View */}
        {viewMode === "holes" && (
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4">Hole-by-Hole Statistics</h2>

            {/* Best/Worst Hole Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {recap.leaders.bestHole && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-sm font-medium text-green-800 mb-1">Easiest Hole</div>
                  <div className="text-2xl font-bold text-green-900">
                    Hole {recap.leaders.bestHole.holeNumber}
                  </div>
                  <div className="text-sm text-green-700">
                    {recap.leaders.bestHole.avgStrokesUnderPar.toFixed(2)} under par (avg)
                  </div>
                </div>
              )}
              {recap.leaders.worstHole && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="text-sm font-medium text-red-800 mb-1">Hardest Hole</div>
                  <div className="text-2xl font-bold text-red-900">
                    Hole {recap.leaders.worstHole.holeNumber}
                  </div>
                  <div className="text-sm text-red-700">
                    +{recap.leaders.worstHole.avgStrokesOverPar.toFixed(2)} over par (avg)
                  </div>
                </div>
              )}
            </div>

            {/* Hole Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Hole</th>
                    <th className="text-center py-2 px-2">Par</th>
                    <th className="text-center py-2 px-2">Avg Gross</th>
                    <th className="text-center py-2 px-2">Avg Net</th>
                    <th className="text-center py-2 px-2">Low Gross</th>
                    <th className="text-center py-2 px-2">High Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {recap.holeAverages.map((hole) => (
                    <tr key={hole.holeNumber} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-2 font-bold">{hole.holeNumber}</td>
                      <td className="py-2 px-2 text-center">{hole.par}</td>
                      <td className="py-2 px-2 text-center font-semibold">
                        {hole.avgGross?.toFixed(2) || "—"}
                      </td>
                      <td className="py-2 px-2 text-center text-gray-600">
                        {hole.avgNet?.toFixed(2) || "—"}
                      </td>
                      <td className="py-2 px-2 text-center text-green-700">
                        {hole.lowestGross || "—"}
                      </td>
                      <td className="py-2 px-2 text-center text-red-700">
                        {hole.highestGross || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
