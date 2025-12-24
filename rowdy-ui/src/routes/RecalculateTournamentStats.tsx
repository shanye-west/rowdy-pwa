import { useState } from "react";
import { Link } from "react-router-dom";
import { getFunctions, httpsCallable } from "firebase/functions";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";

type DryRunResult = {
  success: boolean;
  dryRun: boolean;
  factsToDelete: number;
  affectedPlayers: number;
  tournamentsAffected: number;
  matchesToRecalculate: number;
  message: string;
};

type ExecuteResult = {
  success: boolean;
  dryRun: boolean;
  factsDeleted: number;
  statsAutoCleanedUp: number;
  tournamentsRecalculated: number;
  matchesRecalculated: number;
  message: string;
};

export default function RecalculateTournamentStats() {
  const { player } = useAuth();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"preview" | "confirm" | "executing" | "complete">("preview");
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setLoading(true);
    setError(null);

    try {
      const functions = getFunctions();
      const recalc = httpsCallable<{ dryRun: boolean }, DryRunResult>(
        functions,
        "recalculateAllStats"
      );

      const result = await recalc({ dryRun: true });
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
    setLoading(true);
    setError(null);
    setStep("executing");

    try {
      const functions = getFunctions();
      const recalc = httpsCallable<{}, ExecuteResult>(
        functions,
        "recalculateAllStats"
      );

      const result = await recalc({});
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
    setStep("preview");
    setDryRunResult(null);
    setExecuteResult(null);
    setError(null);
  };

  return (
    <Layout title="Recalculate All Stats" showBack>
      <div className="p-4 space-y-4 max-w-3xl mx-auto">
        {/* Warning Banner */}
        <div className="card p-4 bg-red-50 border-2 border-red-300">
          <div className="flex items-start gap-3">
            <div className="text-3xl">🔥</div>
            <div>
              <div className="font-bold text-red-900 mb-2 text-lg">CRITICAL: Global Recalculation</div>
              <div className="text-sm text-red-800 space-y-2">
                <p className="font-semibold">This will recalculate ALL tournaments:</p>
                <ul className="list-disc ml-4 mt-1 space-y-1">
                  <li>Delete ALL playerMatchFacts across ALL tournaments</li>
                  <li>playerStats automatically cleaned up via triggers</li>
                  <li>Regenerate facts from ALL closed matches</li>
                  <li>Rebuild all stats from fresh data</li>
                </ul>
                <p className="mt-3 font-bold bg-red-100 p-2 rounded">⚠️ This is a "nuclear" reset of all statistical data</p>
                <p className="text-xs mt-2">Use this when you need to ensure complete data integrity across everything.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Initial Preview Button */}
        {step === "preview" && !dryRunResult && (
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4">Ready to Preview</h2>
            
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg mb-4">
                {error}
              </div>
            )}

            <p className="text-gray-700 mb-6">
              Click below to run a dry-run preview. This will show you exactly what will happen 
              without making any changes.
            </p>

            <div className="flex gap-3">
              <button
                onClick={handleDryRun}
                disabled={loading}
                className="btn btn-primary flex-1"
              >
                {loading ? "Loading Preview..." : "Preview Changes"}
              </button>
              <Link to="/admin" className="btn btn-secondary">
                Cancel
              </Link>
            </div>
          </div>
        )}

        {/* Dry Run Results */}
        {step === "preview" && dryRunResult && (
          <div className="space-y-4">
            <div className="card p-6">
              <h2 className="text-xl font-bold mb-4">Preview Results</h2>
              
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg mb-4">
                  {error}
                </div>
              )}

              <div className="space-y-3 mb-6">
                <div className="flex justify-between p-3 bg-red-50 rounded">
                  <span className="font-medium">Facts to Delete:</span>
                  <span className="font-bold text-red-700">{dryRunResult.factsToDelete}</span>
                </div>
                <div className="flex justify-between p-3 bg-orange-50 rounded">
                  <span className="font-medium">Players Affected:</span>
                  <span className="font-bold text-orange-700">{dryRunResult.affectedPlayers}</span>
                </div>
                <div className="flex justify-between p-3 bg-orange-50 rounded">
                  <span className="font-medium">Tournaments Affected:</span>
                  <span className="font-bold text-orange-700">{dryRunResult.tournamentsAffected}</span>
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

        {/* Final Confirmation */}
        {step === "confirm" && dryRunResult && (
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 text-red-700">🔥 FINAL CONFIRMATION</h2>
            
            <div className="bg-red-50 border-2 border-red-300 p-4 rounded-lg mb-6">
              <div className="text-red-900 space-y-2">
                <p className="font-bold text-lg">You are about to PERMANENTLY:</p>
                <ul className="list-disc ml-6 space-y-1">
                  <li>Delete {dryRunResult.factsToDelete} playerMatchFacts</li>
                  <li>Affect {dryRunResult.affectedPlayers} players across {dryRunResult.tournamentsAffected} tournaments</li>
                  <li>Trigger regeneration for {dryRunResult.matchesToRecalculate} matches</li>
                </ul>
                <p className="mt-4 font-bold text-xl bg-red-200 p-3 rounded">⚠️ ALL TOURNAMENTS WILL BE RECALCULATED</p>
                <p className="text-sm mt-2">playerStats will be automatically cleaned up and rebuilt by triggers.</p>
                <p className="mt-3 font-bold">This action cannot be undone.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleExecute}
                disabled={loading}
                className="btn bg-red-600 hover:bg-red-700 text-white flex-1"
              >
                {loading ? "Executing..." : "Execute Global Recalculation"}
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

        {/* Executing */}
        {step === "executing" && (
          <div className="card p-6 text-center">
            <div className="text-4xl mb-4">⏳</div>
            <h2 className="text-xl font-bold mb-2">Processing Global Recalculation...</h2>
            <p className="text-gray-600">
              Deleting all facts across all tournaments and triggering regeneration.
            </p>
            <p className="text-sm text-gray-500 mt-2">This may take a few moments.</p>
          </div>
        )}

        {/* Complete */}
        {step === "complete" && executeResult && (
          <div className="space-y-4">
            <div className="card p-6">
              <div className="text-center mb-6">
                <div className="text-5xl mb-3">✅</div>
                <h2 className="text-2xl font-bold text-green-700 mb-2">Global Recalculation Complete!</h2>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between p-3 bg-green-50 rounded">
                  <span className="font-medium">Facts Deleted:</span>
                  <span className="font-bold text-green-700">{executeResult.factsDeleted}</span>
                </div>
                <div className="flex justify-between p-3 bg-green-50 rounded">
                  <span className="font-medium">Players Auto-Cleaned:</span>
                  <span className="font-bold text-green-700">{executeResult.statsAutoCleanedUp}</span>
                </div>
                <div className="flex justify-between p-3 bg-green-50 rounded">
                  <span className="font-medium">Tournaments Recalculated:</span>
                  <span className="font-bold text-green-700">{executeResult.tournamentsRecalculated}</span>
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
                  <p className="mt-3 text-xs font-semibold">All player stats are being automatically rebuilt in real-time by triggers.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleReset}
                  className="btn btn-primary flex-1"
                >
                  Run Again
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
