import { useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";
import { useAdminTournaments } from "../hooks/admin/useAdminTournaments";
import { useRounds } from "../hooks/admin/useRounds";
import { adminApi } from "../api/admin";
import { getErrorMessage } from "../api/errors";
import type { ComputeRoundRecapResult } from "../api/adminContracts";

export default function GenerateRoundRecap() {
  const { player } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>("");
  const [selectedRoundId, setSelectedRoundId] = useState<string>("");
  const [result, setResult] = useState<ComputeRoundRecapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { tournaments, loading: tournamentsLoading, error: tournamentsError } = useAdminTournaments();
  const { rounds, loading: roundsLoading, error: roundsError } = useRounds(selectedTournamentId);
  const loadingData = tournamentsLoading || roundsLoading;
  const loadError = tournamentsError ?? roundsError;

  const handleGenerate = async () => {
    if (!selectedRoundId) {
      setError("Please select a round");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await adminApi.computeRoundRecap({ roundId: selectedRoundId });
      setResult(response);
    } catch (err) {
      console.error("Generate failed:", err);
      setError(getErrorMessage(err, "Failed to generate recap"));
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

            {(error ?? loadError) && (
              <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg mb-4">
                {error ?? loadError}
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
                  onChange={(e) => {
                    setSelectedTournamentId(e.target.value);
                    setSelectedRoundId("");
                  }}
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
                        Day {r.day} - {r.format || "Format TBD"}
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
