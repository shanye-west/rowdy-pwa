import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { RoundRecapDoc, VsAllRecord } from "../types";
import Layout from "../components/Layout";

export default function RoundRecap() {
  const { roundId } = useParams<{ roundId: string }>();
  const [recap, setRecap] = useState<RoundRecapDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"vsAll" | "birdies" | "eagles" | "holes">("vsAll");
  const [birdieMode, setbirdieMode] = useState<"gross" | "net">("gross");
  const [eagleMode, setEagleMode] = useState<"gross" | "net">("gross");

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
          setRecap(recapSnap.data() as RoundRecapDoc);
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

  if (loading) {
    return (
      <Layout title="Round Recap" showBack>
        <div className="flex items-center justify-center p-8">
          <div className="text-lg text-gray-500">Loading recap...</div>
        </div>
      </Layout>
    );
  }

  if (error || !recap) {
    return (
      <Layout title="Round Recap" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-text">{error || "Recap not available"}</div>
          <Link to={`/round/${roundId}`} className="btn btn-primary mt-4">
            Back to Round
          </Link>
        </div>
      </Layout>
    );
  }

  // Sort vsAll by win percentage
  const sortedVsAll = [...recap.vsAllRecords].sort((a, b) => {
    const totalA = a.wins + a.losses + a.ties;
    const totalB = b.wins + b.losses + b.ties;
    const winPctA = totalA > 0 ? a.wins / totalA : 0;
    const winPctB = totalB > 0 ? b.wins / totalB : 0;
    
    if (winPctB !== winPctA) return winPctB - winPctA;
    return b.wins - a.wins; // Tie-break by total wins
  });

  // Get current birdie/eagle leaders
  const currentBirdies = birdieMode === "gross" ? recap.leaders.birdiesGross : recap.leaders.birdiesNet;
  const currentEagles = eagleMode === "gross" ? recap.leaders.eaglesGross : recap.leaders.eaglesNet;

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
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${
              viewMode === "vsAll"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            vs All
          </button>
          <button
            onClick={() => setViewMode("birdies")}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${
              viewMode === "birdies"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Birdies
          </button>
          <button
            onClick={() => setViewMode("eagles")}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${
              viewMode === "eagles"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Eagles
          </button>
          <button
            onClick={() => setViewMode("holes")}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${
              viewMode === "holes"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Hole Stats
          </button>
        </div>

        {/* vs All View */}
        {viewMode === "vsAll" && (
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4">vs All Simulation</h2>
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
                      <td className="py-3 px-2 font-medium">{record.playerName}</td>
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

        {/* Birdies View */}
        {viewMode === "birdies" && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Birdie Leaders</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setbirdieMode("gross")}
                  className={`px-3 py-1 text-sm rounded ${
                    birdieMode === "gross"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-700"
                  }`}
                >
                  Gross
                </button>
                <button
                  onClick={() => setbirdieMode("net")}
                  className={`px-3 py-1 text-sm rounded ${
                    birdieMode === "net"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-700"
                  }`}
                >
                  Net
                </button>
              </div>
            </div>

            {currentBirdies.length === 0 ? (
              <div className="text-gray-500 text-center py-8">No birdies recorded</div>
            ) : (
              <div className="space-y-3">
                {currentBirdies.map((leader, idx) => (
                  <div key={leader.playerId} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                    <div className="text-2xl font-bold text-gray-400 w-8">{idx + 1}</div>
                    <div className="flex-1">
                      <div className="font-semibold">{leader.playerName}</div>
                      <div className="text-sm text-gray-600">
                        Holes: {leader.holes.join(", ")}
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-blue-600">{leader.count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Eagles View */}
        {viewMode === "eagles" && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Eagle Leaders</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setEagleMode("gross")}
                  className={`px-3 py-1 text-sm rounded ${
                    eagleMode === "gross"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-700"
                  }`}
                >
                  Gross
                </button>
                <button
                  onClick={() => setEagleMode("net")}
                  className={`px-3 py-1 text-sm rounded ${
                    eagleMode === "net"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-700"
                  }`}
                >
                  Net
                </button>
              </div>
            </div>

            {currentEagles.length === 0 ? (
              <div className="text-gray-500 text-center py-8">No eagles recorded</div>
            ) : (
              <div className="space-y-3">
                {currentEagles.map((leader, idx) => (
                  <div key={leader.playerId} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                    <div className="text-2xl font-bold text-gray-400 w-8">{idx + 1}</div>
                    <div className="flex-1">
                      <div className="font-semibold">{leader.playerName}</div>
                      <div className="text-sm text-gray-600">
                        Holes: {leader.holes.join(", ")}
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-yellow-600">{leader.count}</div>
                  </div>
                ))}
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
