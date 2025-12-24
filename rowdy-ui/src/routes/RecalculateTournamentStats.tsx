import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";
import type { TournamentDoc } from "../types";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";

type DryRunResult = {
  success: boolean;
  dryRun: boolean;
  tournamentId: string;
  tournamentName: string;
  series: string;
  factsToDelete: number;
  affectedPlayers: number;
  playerIds: string[];
  matchesToRecalculate: number;
  message: string;
};

type ExecuteResult = {
  success: boolean;
  dryRun: boolean;
  tournamentId: string;
  tournamentName: string;
  series: string;
  factsDeleted: number;
  statsReset: number;
  matchesRecalculated: number;
  matchIds: string[];
  message: string;
};

export default function RecalculateTournamentStats() {
  const { player } = useAuth();
  const [tournaments, setTournaments] = useState<TournamentDoc[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"select" | "preview" | "confirm" | "executing" | "complete">("select");
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch all tournaments
  useEffect(() => {
    let mounted = true;
    const fetchTournaments = async () => {
      try {
        const snap = await getDocs(collection(db, "tournaments"));
        const docs = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as TournamentDoc))
          .sort((a, b) => (b.year || 0) - (a.year || 0));
        if (mounted) setTournaments(docs);
      } catch (err) {
        console.error("Failed to fetch tournaments:", err);
      }
    };
    fetchTournaments();
    return () => { mounted = false; };
  }, []);

  // Access control: only admins can view this page
  if (!player?.isAdmin) {
    return (
      <Layout title="Recalculate Tournament Stats" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <div className="empty-state-text">Access Denied</div>
          <div className="text-sm text-gray-500 mt-2">Admin access required</div>
          <Link to="/" className="btn btn-primary mt-4">Go Home</Link>
        </div>
      </Layout>
    );
  }

  const handleDryRun = async () => {
    if (!selectedTournamentId) {
      setError("Please select a tournament");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const functions = getFunctions();
      const recalc = httpsCallable<{ tournamentId: string; dryRun: boolean }, DryRunResult>(
        functions,
        "recalculateTournamentStats"
      );

      const result = await recalc({ tournamentId: selectedTournamentId, dryRun: true });
      setDryRunResult(result.data);
      setStep("preview");
    } catch (err: any) {
      console.error("Dry run failed:", err);
      setError(err.message || "Failed to run preview");
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!selectedTournamentId) return;

    setLoading(true);
    setError(null);
    setStep("executing");

    try {
      const functions = getFunctions();
      const recalc = httpsCallable<{ tournamentId: string }, ExecuteResult>(
        functions,
        "recalculateTournamentStats"
      );

      const result = await recalc({ tournamentId: selectedTournamentId });
      setExecuteResult(result.data);
      setStep("complete");
    } catch (err: any) {
      console.error("Execution failed:", err);
      setError(err.message || "Failed to recalculate stats");
      setStep("preview");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep("select");
    setSelectedTournamentId("");
    setDryRunResult(null);
    setExecuteResult(null);
    setError(null);
  };

  return (
    <Layout title="Recalculate Tournament Stats" showBack>
      <div className="p-4 space-y-4 max-w-3xl mx-auto">
        {/* Warning Banner */}
        <div className="card p-4 bg-amber-50 border border-amber-200">
          <div className="flex items-start gap-3">
            <div className="text-2xl">⚠️</div>
            <div>
              <div className="font-semibold text-amber-900 mb-1">Important: Data Recalculation</div>
              <div className="text-sm text-amber-800 space-y-1">
                <p>This function will:</p>
                <ul className="list-disc ml-4 mt-1">
                  <li>Delete all existing playerMatchFacts for the tournament</li>
                  <li>Delete all playerStats for affected players</li>
                  <li>Regenerate facts and stats from closed matches</li>
                </ul>
                <p className="mt-2 font-semibold">Always preview first before executing.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Step 1: Select Tournament */}
        {step === "select" && (
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4">Select Tournament</h2>
            
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg mb-4">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Tournament</label>
                <select
                  value={selectedTournamentId}
                  onChange={e => setSelectedTournamentId(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                  disabled={loading}
                >
                  <option value="">-- Select a tournament --</option>
                  {tournaments.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.year}) - {t.series}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleDryRun}
                  disabled={!selectedTournamentId || loading}
                  className="btn btn-primary flex-1"
                >
                  {loading ? "Loading..." : "Preview Changes"}
                </button>
                <Link to="/admin" className="btn btn-secondary">
                  Cancel
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Preview Dry Run Results */}
        {step === "preview" && dryRunResult && (
          <div className="space-y-4">
            <div className="card p-6">
              <h2 className="text-xl font-bold mb-4">Preview: {dryRunResult.tournamentName}</h2>
              
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg mb-4">
                  {error}
                </div>
              )}

              <div className="space-y-3 mb-6">
                <div className="flex justify-between p-3 bg-gray-50 rounded">
                  <span className="font-medium">Tournament:</span>
                  <span>{dryRunResult.tournamentName} ({dryRunResult.series})</span>
                </div>
                <div className="flex justify-between p-3 bg-red-50 rounded">
                  <span className="font-medium">Facts to Delete:</span>
                  <span className="font-bold text-red-700">{dryRunResult.factsToDelete}</span>
                </div>
                <div className="flex justify-between p-3 bg-red-50 rounded">
                  <span className="font-medium">Player Stats to Reset:</span>
                  <span className="font-bold text-red-700">{dryRunResult.affectedPlayers}</span>
                </div>
                <div className="flex justify-between p-3 bg-green-50 rounded">
                  <span className="font-medium">Matches to Regenerate:</span>
                  <span className="font-bold text-green-700">{dryRunResult.matchesToRecalculate}</span>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-6">
                <div className="text-sm text-blue-900">
                  <strong>What will happen:</strong>
                  <p className="mt-2">{dryRunResult.message}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("confirm")}
                  className="btn btn-primary flex-1"
                >
                  Continue to Confirmation
                </button>
                <button
                  onClick={handleReset}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Final Confirmation */}
        {step === "confirm" && dryRunResult && (
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 text-red-700">⚠️ Final Confirmation</h2>
            
            <div className="bg-red-50 border-2 border-red-300 p-4 rounded-lg mb-6">
              <div className="text-red-900 space-y-2">
                <p className="font-bold">You are about to permanently:</p>
                <ul className="list-disc ml-6 space-y-1">
                  <li>Delete {dryRunResult.factsToDelete} playerMatchFacts</li>
                  <li>Reset stats for {dryRunResult.affectedPlayers} players</li>
                  <li>Trigger regeneration for {dryRunResult.matchesToRecalculate} matches</li>
                </ul>
                <p className="mt-4 font-bold">This action cannot be undone.</p>
                <p className="text-sm mt-2">The system will automatically regenerate fresh data from closed matches.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleExecute}
                disabled={loading}
                className="btn bg-red-600 hover:bg-red-700 text-white flex-1"
              >
                {loading ? "Executing..." : "Execute Recalculation"}
              </button>
              <button
                onClick={handleReset}
                disabled={loading}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Executing */}
        {step === "executing" && (
          <div className="card p-6 text-center">
            <div className="text-4xl mb-4">⏳</div>
            <h2 className="text-xl font-bold mb-2">Processing...</h2>
            <p className="text-gray-600">
              Deleting old data and triggering regeneration. This may take a moment.
            </p>
          </div>
        )}

        {/* Step 5: Complete */}
        {step === "complete" && executeResult && (
          <div className="space-y-4">
            <div className="card p-6">
              <div className="text-center mb-6">
                <div className="text-5xl mb-3">✅</div>
                <h2 className="text-2xl font-bold text-green-700 mb-2">Recalculation Complete!</h2>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between p-3 bg-gray-50 rounded">
                  <span className="font-medium">Tournament:</span>
                  <span>{executeResult.tournamentName}</span>
                </div>
                <div className="flex justify-between p-3 bg-green-50 rounded">
                  <span className="font-medium">Facts Deleted:</span>
                  <span className="font-bold text-green-700">{executeResult.factsDeleted}</span>
                </div>
                <div className="flex justify-between p-3 bg-green-50 rounded">
                  <span className="font-medium">Stats Reset:</span>
                  <span className="font-bold text-green-700">{executeResult.statsReset}</span>
                </div>
                <div className="flex justify-between p-3 bg-green-50 rounded">
                  <span className="font-medium">Matches Regenerated:</span>
                  <span className="font-bold text-green-700">{executeResult.matchesRecalculated}</span>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-6">
                <div className="text-sm text-blue-900">
                  <strong>Result:</strong>
                  <p className="mt-2">{executeResult.message}</p>
                  <p className="mt-2 text-xs">Player stats will be automatically updated in real-time.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleReset}
                  className="btn btn-primary flex-1"
                >
                  Recalculate Another Tournament
                </button>
                <Link to="/admin" className="btn btn-secondary">
                  Back to Admin
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
