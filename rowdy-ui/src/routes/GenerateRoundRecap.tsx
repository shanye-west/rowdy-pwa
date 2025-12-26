import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";

type TournamentOption = {
  id: string;
  name: string;
  year: number;
};

type RoundOption = {
  id: string;
  day: number;
  format: string;
};

type ComputeResult = {
  success: boolean;
  roundId: string;
  stats: {
    playersAnalyzed: number;
    vsAllMatchupsSimulated: number;
    birdiesGrossLeader: string;
    birdiesGrossCount: number;
    eaglesGrossLeader: string;
    eaglesGrossCount: number;
  };
  message: string;
};

export default function GenerateRoundRecap() {
  const { player } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [rounds, setRounds] = useState<RoundOption[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>("");
  const [selectedRoundId, setSelectedRoundId] = useState<string>("");
  const [result, setResult] = useState<ComputeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Access control: only admins can view this page
  if (!player?.isAdmin) {
    return (
      <Layout title="Generate Round Recap" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <div className="empty-state-text">Access Denied</div>
          <div className="text-sm text-gray-500 mt-2">Admin access required</div>
          <Link to="/" className="btn btn-primary mt-4">Go Home</Link>
        </div>
      </Layout>
    );
  }

  // Load tournaments
  useEffect(() => {
    const loadTournaments = async () => {
      setLoadingData(true);
      try {
        const tournamentsSnap = await getDocs(
          query(collection(db, "tournaments"), orderBy("year", "desc"))
        );
        const tournamentOptions = tournamentsSnap.docs.map((doc) => ({
          id: doc.id,
          name: doc.data().name || "Unnamed Tournament",
          year: doc.data().year || 0,
        }));
        setTournaments(tournamentOptions);
      } catch (err) {
        console.error("Error loading tournaments:", err);
        setError("Failed to load tournaments");
      } finally {
        setLoadingData(false);
      }
    };

    loadTournaments();
  }, []);

  // Load rounds when tournament is selected
  useEffect(() => {
    if (!selectedTournamentId) {
      setRounds([]);
      setSelectedRoundId("");
      return;
    }

    const loadRounds = async () => {
      setLoadingData(true);
      try {
        const roundsSnap = await getDocs(
          query(
            collection(db, "rounds"),
            where("tournamentId", "==", selectedTournamentId),
            orderBy("day", "asc")
          )
        );
        const roundOptions = roundsSnap.docs.map((doc) => ({
          id: doc.id,
          day: doc.data().day || 0,
          format: doc.data().format || "Unknown",
        }));
        setRounds(roundOptions);
        setSelectedRoundId("");
      } catch (err) {
        console.error("Error loading rounds:", err);
        setError("Failed to load rounds");
      } finally {
        setLoadingData(false);
      }
    };

    loadRounds();
  }, [selectedTournamentId]);

  const handleGenerate = async () => {
    if (!selectedRoundId) {
      setError("Please select a round");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const functions = getFunctions();
      const computeRecap = httpsCallable<{ roundId: string }, ComputeResult>(
        functions,
        "computeRoundRecap"
      );

      const response = await computeRecap({ roundId: selectedRoundId });
      setResult(response.data);
    } catch (err: any) {
      console.error("Generate failed:", err);
      setError(err.message || "Failed to generate recap");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    setSelectedTournamentId("");
    setSelectedRoundId("");
  };

  return (
    <Layout title="Generate Round Recap" showBack>
      <div className="p-4 space-y-4 max-w-3xl mx-auto">
        {/* Info Banner */}
        <div className="card p-4 bg-blue-50 border-2 border-blue-300">
          <div className="flex items-start gap-3">
            <div className="text-3xl">📊</div>
            <div>
              <div className="font-bold text-blue-900 mb-2 text-lg">Round Recap Generation</div>
              <div className="text-sm text-blue-800 space-y-2">
                <p>Generate comprehensive round statistics including:</p>
                <ul className="list-disc ml-4 mt-1 space-y-1">
                  <li><strong>"vs All" simulation</strong> - Each player/team vs all others</li>
                  <li><strong>Birdie/Eagle leaders</strong> - Both gross and net</li>
                  <li><strong>Hole-by-hole averages</strong> - Scoring analysis per hole</li>
                  <li><strong>Best/worst holes</strong> - Easiest and hardest holes</li>
                </ul>
                <p className="mt-3 font-bold bg-blue-100 p-2 rounded">
                  ⚠️ Only one recap per round. Delete existing recap manually before regenerating.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Success Result */}
        {result && (
          <div className="card p-6 bg-green-50 border-2 border-green-300">
            <div className="flex items-start gap-3 mb-4">
              <div className="text-3xl">✅</div>
              <div>
                <div className="font-bold text-green-900 text-lg">Recap Generated Successfully</div>
                <div className="text-sm text-green-800 mt-1">{result.message}</div>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex justify-between p-3 bg-white rounded">
                <span className="font-medium">Players Analyzed:</span>
                <span className="font-bold">{result.stats.playersAnalyzed}</span>
              </div>
              <div className="flex justify-between p-3 bg-white rounded">
                <span className="font-medium">Matchups Simulated:</span>
                <span className="font-bold">{result.stats.vsAllMatchupsSimulated}</span>
              </div>
              <div className="flex justify-between p-3 bg-white rounded">
                <span className="font-medium">Most Birdies (Gross):</span>
                <span className="font-bold">
                  {result.stats.birdiesGrossLeader} ({result.stats.birdiesGrossCount})
                </span>
              </div>
              <div className="flex justify-between p-3 bg-white rounded">
                <span className="font-medium">Most Eagles (Gross):</span>
                <span className="font-bold">
                  {result.stats.eaglesGrossLeader} ({result.stats.eaglesGrossCount})
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <Link
                to={`/round/${result.roundId}/recap`}
                className="btn btn-primary flex-1"
              >
                View Recap
              </Link>
              <button onClick={handleReset} className="btn btn-secondary">
                Generate Another
              </button>
            </div>
          </div>
        )}

        {/* Form */}
        {!result && (
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4">Select Round</h2>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg mb-4">
                {error}
              </div>
            )}

            <div className="space-y-4">
              {/* Tournament Selector */}
              <div>
                <label htmlFor="tournament" className="block text-sm font-medium mb-2">
                  Tournament
                </label>
                <select
                  id="tournament"
                  value={selectedTournamentId}
                  onChange={(e) => setSelectedTournamentId(e.target.value)}
                  disabled={loadingData || loading}
                  className="w-full p-3 border rounded-lg"
                >
                  <option value="">Select a tournament...</option>
                  {tournaments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.year})
                    </option>
                  ))}
                </select>
              </div>

              {/* Round Selector */}
              {selectedTournamentId && (
                <div>
                  <label htmlFor="round" className="block text-sm font-medium mb-2">
                    Round
                  </label>
                  <select
                    id="round"
                    value={selectedRoundId}
                    onChange={(e) => setSelectedRoundId(e.target.value)}
                    disabled={loadingData || loading || rounds.length === 0}
                    className="w-full p-3 border rounded-lg"
                  >
                    <option value="">Select a round...</option>
                    {rounds.map((r) => (
                      <option key={r.id} value={r.id}>
                        Day {r.day} - {r.format}
                      </option>
                    ))}
                  </select>
                  {rounds.length === 0 && !loadingData && (
                    <p className="text-sm text-gray-500 mt-2">No rounds found for this tournament</p>
                  )}
                </div>
              )}

              {/* Generate Button */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleGenerate}
                  disabled={!selectedRoundId || loading || loadingData}
                  className="btn btn-primary flex-1"
                >
                  {loading ? "Generating..." : "Generate Recap"}
                </button>
                <Link to="/admin" className="btn btn-secondary">
                  Cancel
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
