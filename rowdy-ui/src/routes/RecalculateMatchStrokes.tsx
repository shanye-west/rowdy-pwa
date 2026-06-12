import { useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import StatusBanner from "../components/admin/StatusBanner";
import { useAuth } from "../contexts/AuthContext";
import { useAdminTournaments } from "../hooks/admin/useAdminTournaments";
import { useRounds } from "../hooks/admin/useRounds";
import { useMatches } from "../hooks/admin/useMatches";
import { adminApi } from "../api/admin";
import { getErrorMessage } from "../api/errors";
import type { RecalculateMatchStrokesResult } from "../api/adminContracts";

export default function RecalculateMatchStrokes() {
  const { player } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecalculateMatchStrokesResult | null>(null);

  const [tournamentId, setTournamentId] = useState("");
  const [roundId, setRoundId] = useState("");
  const [matchId, setMatchId] = useState("");

  const { tournaments, loading, error: loadError } = useAdminTournaments();
  const { rounds } = useRounds(tournamentId);
  const { matches } = useMatches(roundId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);

    try {
      if (!matchId) {
        throw new Error("Please select a match");
      }
      const response = await adminApi.recalculateMatchStrokes({ matchId });
      setResult(response);
      setMatchId(""); // Reset selection
    } catch (err) {
      console.error("Error recalculating strokes:", err);
      setError(getErrorMessage(err, "Failed to recalculate strokes"));
    } finally {
      setSubmitting(false);
    }
  };

  // Access control
  if (!player?.isAdmin) {
    return (
      <Layout title="Recalculate Match Strokes" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <div className="empty-state-text">Access Denied</div>
          <div className="text-sm text-gray-500 mt-2">Admin access required</div>
          <Link to="/" className="btn btn-primary mt-4">Go Home</Link>
        </div>
      </Layout>
    );
  }

  if (loading) {
    return (
      <Layout title="Recalculate Match Strokes" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout title="Recalculate Match Strokes" showBack>
      <div className="p-4 max-w-2xl mx-auto">
        <div className="card p-6">
          <p className="text-sm text-gray-600 mb-6">
            Recalculate strokesReceived for a match using current tournament handicap indexes and GHIN formula.
          </p>

          <StatusBanner
            error={error ?? loadError}
            success={result ? `Strokes recalculated. Course handicaps: ${result.courseHandicaps?.join(", ")}` : null}
          />

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Tournament Selection */}
            <div>
              <label className="block text-sm font-semibold mb-2">Tournament</label>
              <select
                value={tournamentId}
                onChange={(e) => {
                  setTournamentId(e.target.value);
                  setRoundId("");
                  setMatchId("");
                }}
                className="w-full p-3 border border-gray-300 rounded-lg"
                required
              >
                <option value="">Select Tournament</option>
                {tournaments.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.year} {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Round Selection */}
            {tournamentId && (
              <div>
                <label className="block text-sm font-semibold mb-2">Round</label>
                <select
                  value={roundId}
                  onChange={(e) => {
                    setRoundId(e.target.value);
                    setMatchId("");
                  }}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                  required
                >
                  <option value="">Select Round</option>
                  {rounds.map(r => (
                    <option key={r.id} value={r.id}>
                      Day {r.day} - {r.format || "Format TBD"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Match Selection */}
            {roundId && (
              <div>
                <label className="block text-sm font-semibold mb-2">Match</label>
                <select
                  value={matchId}
                  onChange={(e) => setMatchId(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                  required
                >
                  <option value="">Select Match</option>
                  {matches.map(m => {
                    const teamAPlayer = m.teamAPlayers?.[0]?.playerId;
                    const teamBPlayer = m.teamBPlayers?.[0]?.playerId;
                    return (
                      <option key={m.id} value={m.id}>
                        Match {m.matchNumber || m.id.slice(-4)} - {teamAPlayer || "?"} vs {teamBPlayer || "?"}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {/* Submit Button */}
            <div className="flex gap-4">
              <button
                type="submit"
                disabled={submitting || !matchId}
                className="btn btn-primary flex-1"
              >
                {submitting ? "Recalculating..." : "Recalculate Strokes"}
              </button>
              <Link to="/admin" className="btn btn-secondary">
                Cancel
              </Link>
            </div>
          </form>

          {/* Info Box */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-sm text-blue-800">
              <div className="font-semibold mb-2">What this does:</div>
              <ul className="list-disc list-inside space-y-1">
                <li>Fetches current handicap indexes from tournament</li>
                <li>Calculates course handicaps using GHIN formula</li>
                <li>Applies spin-down from lowest handicap</li>
                <li>Updates match strokesReceived arrays</li>
                <li>Updates match courseHandicaps array</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
