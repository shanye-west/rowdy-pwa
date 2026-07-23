import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import Layout from "../../components/Layout";
import StatusBanner from "../../components/admin/StatusBanner";
import AdminSection from "../../components/admin/AdminSection";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import { useAuth } from "../../contexts/AuthContext";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
import type { PlayerDoc } from "../../types";

/** Player management: create, rename, link logins, admin access, delete. */
export default function PlayersAdmin() {
  const { player: me } = useAuth();
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create form
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");

  // Selected player edit form
  const [selectedId, setSelectedId] = useState("");
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  // The linked account's email, for display. Like scoutingNotes, it's PII that no
  // longer lives on the world-readable player doc — both are fetched on select via
  // the admin-gated getPlayerPrivate callable.
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [loadingPrivate, setLoadingPrivate] = useState(false);
  // Guards against a slow private-fields fetch for a previously-selected player
  // clobbering the fields after the admin has clicked a different player.
  const selectRef = useRef("");
  const [confirmAdminChange, setConfirmAdminChange] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected = players.find((p) => p.id === selectedId);
  const isSelf = selected?.id === me?.id;

  const fetchPlayers = useCallback(async () => {
    const snap = await getDocs(collection(db, "players"));
    setPlayers(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as PlayerDoc))
        .sort((a, b) => (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id))
    );
  }, []);

  useEffect(() => {
    fetchPlayers()
      .catch((err) => setError(getErrorMessage(err, "Failed to load players")))
      .finally(() => setLoading(false));
  }, [fetchPlayers]);

  const runAction = async (action: () => Promise<string>) => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const message = await action();
      setSuccess(message);
      await fetchPlayers();
    } catch (err) {
      console.error("Player action failed:", err);
      setError(getErrorMessage(err, "Action failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(async () => {
      await adminApi.createPlayer({ id: newId.trim(), displayName: newName.trim() });
      const created = newId.trim();
      setNewId("");
      setNewName("");
      return `Player "${created}" created.`;
    });
  };

  const selectPlayer = (id: string) => {
    setSelectedId(id);
    setSuccess(null);
    setError(null);
    selectRef.current = id;
    const p = players.find((x) => x.id === id);
    setEditName(p?.displayName ?? "");
    // Reset PII fields, then load them from the server-only private subcollection
    // via the admin callable (they're not on the world-readable player doc).
    setEditNotes("");
    setLinkEmail("");
    setSelectedEmail(null);
    setLoadingPrivate(true);
    adminApi
      .getPlayerPrivate({ playerId: id })
      .then((priv) => {
        if (selectRef.current !== id) return; // selection moved on — ignore
        setEditNotes(priv.scoutingNotes ?? "");
        setLinkEmail(priv.email ?? "");
        setSelectedEmail(priv.email);
      })
      .catch((err) => {
        if (selectRef.current !== id) return;
        setError(getErrorMessage(err, "Failed to load player details"));
      })
      .finally(() => {
        if (selectRef.current === id) setLoadingPrivate(false);
      });
  };

  const handleSaveInfo = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(async () => {
      await adminApi.updatePlayerInfo({
        playerId: selectedId,
        displayName: editName.trim(),
        scoutingNotes: editNotes.trim(),
      });
      return "Player updated.";
    });
  };

  const handleLink = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(async () => {
      const email = linkEmail.trim();
      await adminApi.linkAuthToPlayer({ playerId: selectedId, email });
      setSelectedEmail(email);
      return `Linked ${email} to ${selectedId}.`;
    });
  };

  const handleAdminToggle = () => {
    setConfirmAdminChange(false);
    runAction(async () => {
      const next = !selected?.isAdmin;
      await adminApi.setPlayerAdmin({ playerId: selectedId, isAdmin: next });
      return next ? `${selectedId} is now an admin.` : `Admin access removed from ${selectedId}.`;
    });
  };

  const handleDelete = () => {
    setConfirmDelete(false);
    runAction(async () => {
      await adminApi.deletePlayer({ playerId: selectedId });
      const deleted = selectedId;
      setSelectedId("");
      return `Player "${deleted}" deleted.`;
    });
  };

  if (loading) {
    return (
      <Layout title="Players" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout title="Players" showBack>
      <div className="p-4 max-w-2xl mx-auto space-y-4">
        <StatusBanner error={error} success={success} />

        {/* Create player */}
        <AdminSection
          title="Add Player"
          description={
            <>
              ID convention: <span className="font-mono">pFirstLast</span> (e.g.{" "}
              <span className="font-mono">pShanePeterson</span>). Tournament handicaps are set
              per-tournament in Tournament Settings.
            </>
          }
        >
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="Player ID"
              className="p-2 border border-gray-300 rounded-lg font-mono text-sm"
              required
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Display name"
              className="p-2 border border-gray-300 rounded-lg"
              required
            />
            <button type="submit" disabled={busy} className="btn btn-primary col-span-2">
              {busy ? "Working..." : "Create Player"}
            </button>
          </form>
        </AdminSection>

        {/* Player list + editor */}
        <div className="card p-6">
          <h2 className="font-bold mb-4">Players ({players.length})</h2>
          <div className="space-y-1 max-h-80 overflow-y-auto mb-4">
            {players.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPlayer(p.id)}
                className={`w-full text-left p-2 rounded-lg border transition-colors ${
                  p.id === selectedId ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold">{p.displayName ?? p.id}</span>
                    <span className="text-xs text-gray-500 ml-2 font-mono">{p.id}</span>
                  </div>
                  <div className="flex gap-1 text-xs">
                    {p.isAdmin && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">admin</span>}
                    {p.authUid ? (
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">linked</span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">no login</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <div className="border-t border-gray-200 pt-4 space-y-4">
              <form onSubmit={handleSaveInfo} className="space-y-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                  placeholder="Display name"
                  required
                />
                <div>
                  <label className="block text-sm font-semibold mb-1">Scouting notes</label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={3}
                    className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="e.g. Longest hitter but inconsistent off the tee; deadly with a wedge; streaky putter."
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    Subjective take used by AI for draft &amp; pairing suggestions. Not shown in
                    stats. Leave blank to clear.
                  </div>
                </div>
                <button type="submit" disabled={busy} className="btn btn-secondary">
                  {busy ? "Saving..." : "Save"}
                </button>
              </form>

              <form onSubmit={handleLink} className="space-y-2">
                <div className="text-sm text-gray-600">
                  {selected.authUid
                    ? `Linked to ${selectedEmail ?? (loadingPrivate ? "…" : "an account")}. Re-linking replaces the connection.`
                    : "Link this player to their login account by email (they must have signed in once)."}
                </div>
                <div className="flex gap-3">
                  <input
                    type="email"
                    value={linkEmail}
                    onChange={(e) => setLinkEmail(e.target.value)}
                    placeholder="player@email.com"
                    className="flex-1 p-2 border border-gray-300 rounded-lg"
                    required
                  />
                  <button type="submit" disabled={busy} className="btn btn-secondary">
                    Link Account
                  </button>
                </div>
                <div className="text-xs text-gray-500">
                  Note: existing matches keep their original authorized players — re-save those
                  matches in the match admin if this player needs access to them.
                </div>
              </form>

              {/* Admin access */}
              <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                <div className="text-sm">
                  <div className="font-semibold">Admin access</div>
                  <div className="text-gray-500">
                    {isSelf
                      ? "You can't change your own admin access."
                      : selected.isAdmin
                        ? "Can manage tournaments, matches, players, and stats."
                        : "Regular player — score entry only."}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmAdminChange(true)}
                  disabled={busy || isSelf}
                  className="btn btn-secondary disabled:opacity-40"
                >
                  {selected.isAdmin ? "Remove Admin" : "Make Admin"}
                </button>
              </div>

              {/* Delete */}
              <div className="flex items-center justify-between p-3 border border-red-200 rounded-lg">
                <div className="text-sm">
                  <div className="font-semibold text-red-700">Delete player</div>
                  <div className="text-gray-500">
                    Only possible if they have no match history and are off every roster.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                  className="btn bg-red-600 text-white disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>

        <Link to="/admin" className="btn btn-secondary block text-center">Back to Admin</Link>

        <ConfirmDialog
          isOpen={confirmAdminChange}
          title={selected?.isAdmin ? "Remove admin access?" : "Grant admin access?"}
          confirmLabel={selected?.isAdmin ? "Remove Admin" : "Make Admin"}
          danger={!!selected?.isAdmin}
          busy={busy}
          onConfirm={handleAdminToggle}
          onCancel={() => setConfirmAdminChange(false)}
        >
          {selected?.isAdmin
            ? `${selected.displayName ?? selected.id} will lose access to all admin pages and operations.`
            : `${selected?.displayName ?? selected?.id} will be able to manage tournaments, matches, scores, players, and stats.`}
        </ConfirmDialog>

        <ConfirmDialog
          isOpen={confirmDelete}
          title="Delete player?"
          confirmLabel="Delete Player"
          danger
          busy={busy}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        >
          Permanently deletes <strong>{selected?.displayName ?? selected?.id}</strong>. The server
          refuses if they have match history or are still on a tournament roster. Their login
          account (if any) is not removed.
        </ConfirmDialog>
      </div>
    </Layout>
  );
}
