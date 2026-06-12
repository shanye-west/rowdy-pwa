import { useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../../components/Layout";
import StatusBanner from "../../components/admin/StatusBanner";
import AdminSection from "../../components/admin/AdminSection";
import { useAdminTournament } from "../../contexts/AdminTournamentContext";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";

/**
 * Tournament admin home: rounds at a glance with day-of lock toggles, plus
 * links to settings. Match work happens inside each round.
 */
export default function TournamentHome() {
  const { tournamentId, tournament, rounds, loading, error: ctxError, refreshRounds } = useAdminTournament();
  const [busyRoundId, setBusyRoundId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const toggleRoundLock = async (roundId: string, locked: boolean) => {
    setError(null);
    setSuccess(null);
    setBusyRoundId(roundId);
    try {
      await adminApi.updateRound({ roundId, updates: { locked } });
      await refreshRounds();
      setSuccess(locked ? "Round locked." : "Round unlocked.");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update round lock"));
    } finally {
      setBusyRoundId(null);
    }
  };

  if (loading) {
    return (
      <Layout title="Tournament Admin" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  if (!tournament) {
    return (
      <Layout title="Tournament Admin" showBack>
        <div className="p-4">
          <StatusBanner error={ctxError ?? "Tournament not found"} />
          <Link to="/admin" className="btn btn-secondary">Back to Admin</Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={`${tournament.year} ${tournament.name}`} showBack>
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <StatusBanner error={error ?? ctxError} success={success} />

        <div className="flex gap-2 text-xs">
          {tournament.active && <span className="px-2 py-1 bg-green-100 text-green-700 rounded">active</span>}
          {tournament.test && <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded">test</span>}
          {tournament.archived && <span className="px-2 py-1 bg-gray-200 text-gray-600 rounded">archived</span>}
          {tournament.openPublicEdits && <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">public edits open</span>}
        </div>

        <AdminSection
          title="Rounds"
          description="Lock toggles freeze score entry for the whole round. Open a round to manage its settings, matches, and recap."
        >
          <div className="space-y-2">
            {rounds.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                <Link to={`/admin/t/${tournamentId}/round/${r.id}`} className="flex-1 hover:underline">
                  <div className="font-semibold">
                    Day {r.day} — {r.format || "Format TBD"} {r.locked ? "🔒" : ""}
                  </div>
                  <div className="text-xs text-gray-500 font-mono">{r.id}</div>
                </Link>
                <button
                  type="button"
                  onClick={() => toggleRoundLock(r.id, !r.locked)}
                  disabled={busyRoundId === r.id}
                  className="btn btn-secondary text-sm"
                >
                  {busyRoundId === r.id ? "..." : r.locked ? "Unlock" : "Lock"}
                </button>
              </div>
            ))}
            {rounds.length === 0 && <div className="text-sm text-gray-500">No rounds yet.</div>}
          </div>

          <Link
            to={`/admin/t/${tournamentId}/round/new`}
            className="inline-block mt-4 text-sm text-blue-600 hover:underline"
          >
            + Create new round
          </Link>
        </AdminSection>

        <AdminSection title="Tournament" description="Rosters, handicaps, captains, flags, and archiving.">
          <div className="flex gap-3">
            <Link to={`/admin/t/${tournamentId}/settings`} className="btn btn-primary flex-1 text-center">
              Settings & Rosters
            </Link>
            <Link to={`/tournament/${tournamentId}`} className="btn btn-secondary flex-1 text-center">
              View Public Page
            </Link>
          </div>
        </AdminSection>
      </div>
    </Layout>
  );
}
