import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import AdminPage from "../components/admin/AdminPage";
import AdminSection from "../components/admin/AdminSection";
import { dangerButtonClass } from "../components/admin/inputStyles";
import { Button } from "../components/ui/button";
import { useAuth } from "../contexts/AuthContext";
import { adminApi } from "../api/admin";
import { getErrorMessage } from "../api/errors";
import type {
  RecalculateAllStatsDryRunResult as DryRunResult,
  RecalculateAllStatsExecuteResult as ExecuteResult,
} from "../api/adminContracts";

/**
 * The "nuclear" stats rebuild: delete every playerMatchFact and regenerate from
 * all closed matches. Runs as a preview → confirm → execute wizard so the
 * destructive step is never one tap away.
 */
export default function RecalculateTournamentStats() {
  const { player } = useAuth();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"preview" | "confirm" | "executing" | "complete">("preview");
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Belt-and-braces: the route already sits behind RequireAdmin.
  if (!player?.isAdmin) {
    return (
      <AdminPage title="Recalculate all stats" error="Admin access required">
        <Button asChild variant="outline">
          <Link to="/">Go home</Link>
        </Button>
      </AdminPage>
    );
  }

  const handleDryRun = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await adminApi.recalculateAllStats({ dryRun: true });
      setDryRunResult(result as DryRunResult);
      setStep("preview");
    } catch (err) {
      console.error("Dry run failed:", err);
      setError(getErrorMessage(err, "Failed to run preview"));
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    setLoading(true);
    setError(null);
    setStep("executing");

    try {
      const result = await adminApi.recalculateAllStats({});
      setExecuteResult(result as ExecuteResult);
      setStep("complete");
    } catch (err) {
      console.error("Execution failed:", err);
      setError(getErrorMessage(err, "Failed to recalculate stats"));
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
    <AdminPage
      title="Recalculate all stats"
      breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Tools" }]}
      description="Rebuilds every playerMatchFact and player stat, across every tournament."
      error={error}
      wide
    >
      <AdminSection title="What this does" danger>
        <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
          <li>Deletes <strong className="text-foreground">all</strong> playerMatchFacts, in every tournament</li>
          <li>playerStats are cleaned up automatically by triggers</li>
          <li>Regenerates facts from every closed match</li>
          <li>Rebuilds all stats from the fresh facts</li>
        </ul>
        <p className="mt-3 text-sm text-destructive">
          A full reset of the statistical data. Use it when you need to guarantee integrity across
          everything — not as a routine fix.
        </p>
      </AdminSection>

      {step === "preview" && !dryRunResult && (
        <AdminSection
          title="Preview first"
          description="A dry run reports exactly what would change, without writing anything."
        >
          <div className="flex gap-2">
            <Button type="button" onClick={handleDryRun} disabled={loading} className="flex-1">
              {loading ? "Loading preview…" : "Preview changes"}
            </Button>
            <Button asChild variant="outline">
              <Link to="/admin">Cancel</Link>
            </Button>
          </div>
        </AdminSection>
      )}

      {step === "preview" && dryRunResult && (
        <AdminSection title="Preview results" description={dryRunResult.message}>
          <StatRows
            rows={[
              { label: "Facts to delete", value: dryRunResult.factsToDelete, tone: "danger" },
              { label: "Players affected", value: dryRunResult.affectedPlayers },
              { label: "Tournaments affected", value: dryRunResult.tournamentsAffected },
              { label: "Matches to regenerate", value: dryRunResult.matchesToRecalculate, tone: "good" },
            ]}
          />
          <div className="mt-4 flex gap-2">
            <Button type="button" onClick={() => setStep("confirm")} className="flex-1">
              Continue
            </Button>
            <Button type="button" variant="outline" onClick={handleReset}>
              Cancel
            </Button>
          </div>
        </AdminSection>
      )}

      {step === "confirm" && dryRunResult && (
        <AdminSection title="Final confirmation" danger>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-destructive">You are about to permanently:</p>
            <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
              <li>Delete {dryRunResult.factsToDelete} playerMatchFacts</li>
              <li>
                Affect {dryRunResult.affectedPlayers} players across {dryRunResult.tournamentsAffected}{" "}
                tournaments
              </li>
              <li>Trigger regeneration for {dryRunResult.matchesToRecalculate} matches</li>
            </ul>
            <p className="text-muted-foreground">
              playerStats are cleaned up and rebuilt by triggers. This cannot be undone.
            </p>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleExecute}
              disabled={loading}
              className={`flex-1 ${dangerButtonClass}`}
            >
              {loading ? "Executing…" : "Execute global recalculation"}
            </Button>
            <Button type="button" variant="ghost" onClick={handleReset} disabled={loading}>
              Cancel
            </Button>
          </div>
        </AdminSection>
      )}

      {step === "executing" && (
        <AdminSection title="Working…">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>
              Deleting all facts across all tournaments and triggering regeneration. This may take a
              few moments.
            </span>
          </div>
        </AdminSection>
      )}

      {step === "complete" && executeResult && (
        <AdminSection title="Recalculation complete" description={executeResult.message}>
          <StatRows
            rows={[
              { label: "Facts deleted", value: executeResult.factsDeleted, tone: "good" },
              { label: "Players auto-cleaned", value: executeResult.statsAutoCleanedUp, tone: "good" },
              { label: "Tournaments recalculated", value: executeResult.tournamentsRecalculated, tone: "good" },
              { label: "Matches regenerated", value: executeResult.matchesRecalculated, tone: "good" },
            ]}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Player stats are being rebuilt in real time by triggers.
          </p>
          <div className="mt-4 flex gap-2">
            <Button type="button" onClick={handleReset} className="flex-1">
              Run again
            </Button>
            <Button asChild variant="outline">
              <Link to="/admin">Back to Admin</Link>
            </Button>
          </div>
        </AdminSection>
      )}
    </AdminPage>
  );
}

function StatRows({
  rows,
}: {
  rows: { label: string; value: number; tone?: "danger" | "good" }[];
}) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm"
        >
          <span className="text-muted-foreground">{row.label}</span>
          <span
            className={
              row.tone === "danger"
                ? "font-bold text-destructive"
                : row.tone === "good"
                  ? "font-bold text-emerald-600"
                  : "font-bold text-foreground"
            }
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
