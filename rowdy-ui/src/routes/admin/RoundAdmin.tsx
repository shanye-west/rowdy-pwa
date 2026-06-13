import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import Layout from "../../components/Layout";
import StatusBanner from "../../components/admin/StatusBanner";
import AdminSection from "../../components/admin/AdminSection";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import RoundForm from "../../components/admin/RoundForm";
import { useAdminTournament } from "../../contexts/AdminTournamentContext";
import { useMatches } from "../../hooks/admin/useMatches";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
import type { ComputeRoundRecapResult, RoundUpdates } from "../../api/adminContracts";
import type { CourseDoc, MatchDoc } from "../../types";

/**
 * One round in context: settings, its matches, recap generation, and deletion.
 * Route round/new renders the create form instead.
 */
export default function RoundAdmin() {
  const navigate = useNavigate();
  const { roundId = "" } = useParams<{ roundId: string }>();
  const isNew = roundId === "new";
  const { tournamentId, rounds, loading: ctxLoading, refreshRounds } = useAdminTournament();
  const round = rounds.find((r) => r.id === roundId);

  const [courses, setCourses] = useState<CourseDoc[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [recapBusy, setRecapBusy] = useState(false);
  const [recapResult, setRecapResult] = useState<ComputeRoundRecapResult | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { matches, error: matchesError } = useMatches(isNew ? null : roundId);

  useEffect(() => {
    getDocs(collection(db, "courses"))
      .then((snap) => setCourses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CourseDoc))))
      .catch((err) => setError(getErrorMessage(err, "Failed to load courses")))
      .finally(() => setCoursesLoading(false));
  }, []);

  const handleSubmit = async (updates: RoundUpdates, newRoundId: string) => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      if (isNew) {
        const res = await adminApi.createRound({
          tournamentId,
          ...(newRoundId ? { id: newRoundId } : {}),
          ...updates,
        });
        await refreshRounds();
        navigate(`/admin/t/${tournamentId}/round/${res.roundId}`, { replace: true });
      } else {
        await adminApi.updateRound({ roundId, updates });
        await refreshRounds();
        setSuccess("Round updated.");
      }
    } catch (err) {
      console.error("Error saving round:", err);
      setError(getErrorMessage(err, "Failed to save round"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateRecap = async () => {
    setError(null);
    setSuccess(null);
    setRecapBusy(true);
    setRecapResult(null);
    try {
      const res = await adminApi.computeRoundRecap({ roundId });
      setRecapResult(res);
    } catch (err) {
      console.error("Generate recap failed:", err);
      setError(getErrorMessage(err, "Failed to generate recap"));
    } finally {
      setRecapBusy(false);
    }
  };

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    try {
      await adminApi.deleteRound({ roundId, force: matches.length > 0 });
      await refreshRounds();
      navigate(`/admin/t/${tournamentId}`, { replace: true });
    } catch (err) {
      console.error("Delete round failed:", err);
      setError(getErrorMessage(err, "Failed to delete round"));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  if (ctxLoading || coursesLoading) {
    return (
      <Layout title={isNew ? "Create Round" : "Round Admin"} showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  if (!isNew && !round) {
    return (
      <Layout title="Round Admin" showBack>
        <div className="p-4 space-y-4">
          <StatusBanner error="Round not found" />
          <Link to={`/admin/t/${tournamentId}`} className="btn btn-secondary">Back to Tournament</Link>
        </div>
      </Layout>
    );
  }

  const matchLabel = (m: MatchDoc) => {
    const a = m.teamAPlayers?.map((p) => p.playerId).join("/") || "?";
    const b = m.teamBPlayers?.map((p) => p.playerId).join("/") || "?";
    return `Match ${m.matchNumber ?? m.id.slice(-4)} — ${a} vs ${b}`;
  };

  const title = isNew ? "Create Round" : `Day ${round!.day} — ${round!.format || "Format TBD"}`;

  return (
    <Layout title={title} showBack>
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <StatusBanner error={error ?? matchesError} success={success} />

        <AdminSection
          title={isNew ? "New Round" : "Round Settings"}
          description="Format, course, points, drive tracking, skins, and the round lock."
        >
          <RoundForm
            key={isNew ? "new" : round!.id}
            initial={isNew ? undefined : round}
            defaultDay={rounds.length + 1}
            courses={courses}
            showRoundIdInput={isNew}
            submitting={submitting}
            submitLabel={isNew ? "Create Round" : "Save Round"}
            onSubmit={handleSubmit}
          />
        </AdminSection>

        {!isNew && (
          <>
            <AdminSection
              title="Pairings Draft"
              description="Run the live captains' snake draft to set this round's matchups, then create the matches automatically."
            >
              <Link to={`/round/${roundId}/pairings`} className="btn btn-primary">
                Open pairings draft
              </Link>
            </AdminSection>

            <AdminSection title="Matches" description="Open a match to edit players, lock it, fix a score, or delete it.">
              <div className="space-y-2">
                {matches.map((m) => (
                  <Link
                    key={m.id}
                    to={`/admin/t/${tournamentId}/match/${m.id}`}
                    className="block p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold">{matchLabel(m)}</div>
                        <div className="text-xs text-gray-500 font-mono">{m.id}</div>
                      </div>
                      <div className="flex gap-1 text-xs items-center">
                        {m.locked && <span className="px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded">🔒 locked</span>}
                        {m.status?.closed ? (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">closed</span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">thru {m.status?.thru ?? 0}</span>
                        )}
                        <span className="text-xl ml-1">→</span>
                      </div>
                    </div>
                  </Link>
                ))}
                {matches.length === 0 && <div className="text-sm text-gray-500">No matches yet.</div>}
              </div>
              <Link
                to={`/admin/t/${tournamentId}/round/${roundId}/match/new`}
                className="inline-block mt-4 text-sm text-blue-600 hover:underline"
              >
                + Add match
              </Link>
            </AdminSection>

            <AdminSection
              title="Round Recap"
              description={'Compute the "vs All" simulation, leaders, and hole averages. All matches must be closed. Only one recap per round — delete the existing one in Firestore before regenerating.'}
            >
              {recapResult ? (
                <div className="space-y-3">
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                    ✓ {recapResult.message} — {recapResult.stats.playersAnalyzed} players analyzed,
                    birdie leader {recapResult.stats.birdiesGrossLeader} ({recapResult.stats.birdiesGrossCount}).
                  </div>
                  <Link to={`/round/${roundId}/recap`} className="btn btn-primary">View Recap</Link>
                </div>
              ) : (
                <button type="button" onClick={handleGenerateRecap} disabled={recapBusy} className="btn btn-primary">
                  {recapBusy ? "Generating..." : "Generate Recap"}
                </button>
              )}
            </AdminSection>

            <AdminSection
              title="Delete Round"
              description="Removes the round, all its matches, their stats, skins results, and any recap. Stats recompute automatically."
              danger
            >
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
                className="btn bg-red-600 text-white"
              >
                Delete Round
              </button>
            </AdminSection>

            <ConfirmDialog
              isOpen={confirmDelete}
              title="Delete round?"
              confirmLabel="Delete Round"
              danger
              busy={deleting}
              onConfirm={handleDelete}
              onCancel={() => setConfirmDelete(false)}
            >
              {matches.length > 0 ? (
                <>
                  This round has <strong>{matches.length} match{matches.length === 1 ? "" : "es"}</strong>.
                  Deleting it permanently removes them, their player stats, skins results, and any recap.
                </>
              ) : (
                <>This round has no matches. It will be permanently deleted.</>
              )}
            </ConfirmDialog>
          </>
        )}
      </div>
    </Layout>
  );
}
