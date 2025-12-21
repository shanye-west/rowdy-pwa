import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";
import type { TournamentDoc, RoundDoc, MatchDoc } from "../types";

export default function RecalculateMatchStrokes() {
  const { player } = useAuth();

  const [tournaments, setTournaments] = useState<TournamentDoc[]>([]);
  const [rounds, setRounds] = useState<RoundDoc[]>([]);
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [result, setResult] = useState<any>(null);

  const [tournamentId, setTournamentId] = useState("");
  const [roundId, setRoundId] = useState("");
  const [matchId, setMatchId] = useState("");

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

  // Fetch tournaments on mount
  useEffect(() => {
    const fetchTournaments = async () => {
      try {
        // Fetch active tournaments and test tournaments, then merge (dedupe)
        const activeSnap = await getDocs(query(collection(db, "tournaments"), where("active", "==", true)));
        const testSnap = await getDocs(query(collection(db, "tournaments"), where("test", "==", true)));
        const combinedDocs = [...activeSnap.docs, ...testSnap.docs];
        const map = new Map<string, TournamentDoc>();
        combinedDocs.forEach(d => map.set(d.id, ({ id: d.id, ...d.data() } as TournamentDoc)));
        const tournamentsData = Array.from(map.values());
        setTournaments(tournamentsData);
        setLoading(false);
      } catch (err: any) {
        console.error("Error fetching tournaments:", err);
        setError(err.message || "Failed to fetch tournaments");
        setLoading(false);
      }
    };

    fetchTournaments();
  }, []);

  // Fetch rounds when tournament changes
  useEffect(() => {
    if (!tournamentId) {
      setRounds([]);
      setMatches([]);
      return;
    }

    const fetchRounds = async () => {
      try {
        const roundsSnap = await getDocs(query(collection(db, "rounds"), where("tournamentId", "==", tournamentId)));
        const roundsData = roundsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RoundDoc));
        setRounds(roundsData.sort((a, b) => (a.day ?? 0) - (b.day ?? 0)));
      } catch (err: any) {
        console.error("Error fetching rounds:", err);
        setError(err.message || "Failed to fetch rounds");
      }
    };

    fetchRounds();
  }, [tournamentId]);

  // Fetch matches when round changes
  useEffect(() => {
    if (!roundId) {
      setMatches([]);
      return;
    }

    const fetchMatches = async () => {
      try {
        const matchesSnap = await getDocs(query(collection(db, "matches"), where("roundId", "==", roundId)));
        const matchesData = matchesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MatchDoc));
        setMatches(matchesData.sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0)));
      } catch (err: any) {
        console.error("Error fetching matches:", err);
        setError(err.message || "Failed to fetch matches");
      }
    };

    fetchMatches();
  }, [roundId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setResult(null);
    setSubmitting(true);

    try {
      if (!matchId) {
        throw new Error("Please select a match");
      }

      const recalculateFn = httpsCallable(functions, "recalculateMatchStrokes");
      const response = await recalculateFn({ matchId });

      setSuccess(true);
      setResult(response.data);
      setMatchId(""); // Reset selection
    } catch (err: any) {
      console.error("Error recalculating strokes:", err);
      setError(err.message || "Failed to recalculate strokes");
    } finally {
      setSubmitting(false);
    }
  };

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

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          {success && result && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 font-semibold mb-2">✓ Strokes recalculated successfully!</p>
              <p className="text-sm text-green-700">Course Handicaps: {result.courseHandicaps?.join(", ")}</p>
            </div>
          )}

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
