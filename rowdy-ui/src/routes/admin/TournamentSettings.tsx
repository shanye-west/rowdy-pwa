import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import Layout from "../../components/Layout";
import StatusBanner from "../../components/admin/StatusBanner";
import AdminSection from "../../components/admin/AdminSection";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import TournamentSettingsForm from "../../components/admin/TournamentSettingsForm";
import { useAdminTournament } from "../../contexts/AdminTournamentContext";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
import type { PlayerDoc } from "../../types";
import type { TournamentUpdates } from "../../api/adminContracts";

/** Tournament settings, rosters, handicaps, and the archive control. */
export default function TournamentSettings() {
  const navigate = useNavigate();
  const { tournamentId, tournament, loading } = useAdminTournament();

  const [allPlayers, setAllPlayers] = useState<PlayerDoc[]>([]);
  const [playersLoading, setPlayersLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    getDocs(collection(db, "players"))
      .then((snap) =>
        setAllPlayers(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as PlayerDoc))
            .sort((a, b) => (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id))
        )
      )
      .catch((err) => setError(getErrorMessage(err, "Failed to load players")))
      .finally(() => setPlayersLoading(false));
  }, []);

  const handleSubmit = async (updates: TournamentUpdates) => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await adminApi.updateTournament({ tournamentId, updates });
      setSuccess("Tournament updated.");
    } catch (err) {
      console.error("Error updating tournament:", err);
      setError(getErrorMessage(err, "Failed to update tournament"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchiveToggle = async () => {
    if (!tournament) return;
    setError(null);
    setSuccess(null);
    setArchiving(true);
    try {
      await adminApi.updateTournament({
        tournamentId,
        updates: { archived: !tournament.archived },
      });
      setConfirmArchive(false);
      if (!tournament.archived) {
        navigate("/admin");
      } else {
        setSuccess("Tournament unarchived.");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to archive tournament"));
    } finally {
      setArchiving(false);
    }
  };

  if (loading || playersLoading) {
    return (
      <Layout title="Tournament Settings" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  if (!tournament) {
    return (
      <Layout title="Tournament Settings" showBack>
        <div className="p-4">
          <StatusBanner error="Tournament not found" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Tournament Settings" showBack>
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <StatusBanner error={error} success={success} />

        <div className="card p-6">
          <TournamentSettingsForm
            key={tournament.id}
            tournament={tournament}
            allPlayers={allPlayers}
            submitting={submitting}
            onSubmit={handleSubmit}
          />

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            <div className="font-semibold mb-1">Player IDs for roster editing:</div>
            <div className="break-words">{allPlayers.map((p) => p.id).join(", ") || "No players found"}</div>
          </div>
        </div>

        <AdminSection
          title={tournament.archived ? "Unarchive Tournament" : "Archive Tournament"}
          description={
            tournament.archived
              ? "Bring this tournament back into the default admin list."
              : "Archiving hides this tournament from the default admin list. Nothing is deleted — history and stats stay intact, and you can unarchive any time."
          }
          danger={!tournament.archived}
        >
          <button
            type="button"
            onClick={() => (tournament.archived ? handleArchiveToggle() : setConfirmArchive(true))}
            disabled={archiving}
            className={tournament.archived ? "btn btn-secondary" : "btn bg-red-600 text-white"}
          >
            {archiving ? "Working..." : tournament.archived ? "Unarchive" : "Archive Tournament"}
          </button>
        </AdminSection>

        <ConfirmDialog
          isOpen={confirmArchive}
          title="Archive tournament?"
          confirmLabel="Archive"
          danger
          busy={archiving}
          onConfirm={handleArchiveToggle}
          onCancel={() => setConfirmArchive(false)}
        >
          “{tournament.year} {tournament.name}” will be hidden from the default admin list.
          Nothing is deleted and this can be undone any time.
        </ConfirmDialog>
      </div>
    </Layout>
  );
}
