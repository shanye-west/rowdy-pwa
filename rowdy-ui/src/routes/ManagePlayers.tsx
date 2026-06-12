import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import Layout from "../components/Layout";
import type { PlayerDoc } from "../types";

export default function ManagePlayers() {
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
  const [linkEmail, setLinkEmail] = useState("");

  const selected = players.find((p) => p.id === selectedId);

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
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load players"))
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
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(async () => {
      const fn = httpsCallable(functions, "createPlayer");
      await fn({ id: newId.trim(), displayName: newName.trim() });
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
    const p = players.find((x) => x.id === id);
    setEditName(p?.displayName ?? "");
    setLinkEmail(p?.email ?? "");
  };

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(async () => {
      const fn = httpsCallable(functions, "updatePlayerInfo");
      await fn({ playerId: selectedId, displayName: editName.trim() });
      return "Player updated.";
    });
  };

  const handleLink = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(async () => {
      const fn = httpsCallable(functions, "linkAuthToPlayer");
      await fn({ playerId: selectedId, email: linkEmail.trim() });
      return `Linked ${linkEmail.trim()} to ${selectedId}.`;
    });
  };

  if (loading) {
    return (
      <Layout title="Manage Players" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout title="Manage Players" showBack>
      <div className="p-4 max-w-2xl mx-auto space-y-4">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}
        {success && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-800 text-sm">✓ {success}</p>
          </div>
        )}

        {/* Create player */}
        <div className="card p-6">
          <h2 className="font-bold mb-2">Add Player</h2>
          <p className="text-sm text-gray-600 mb-4">
            ID convention: <span className="font-mono">pFirstLast</span> (e.g.{" "}
            <span className="font-mono">pShanePeterson</span>). Tournament handicaps are set
            per-tournament in Manage Tournament.
          </p>
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
        </div>

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
              <form onSubmit={handleRename} className="flex gap-3">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 p-2 border border-gray-300 rounded-lg"
                  required
                />
                <button type="submit" disabled={busy} className="btn btn-secondary">
                  Rename
                </button>
              </form>

              <form onSubmit={handleLink} className="space-y-2">
                <div className="text-sm text-gray-600">
                  {selected.authUid
                    ? `Linked to ${selected.email ?? "an account"}. Re-linking replaces the connection.`
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
                  matches in Edit Match if this player needs access to them.
                </div>
              </form>
            </div>
          )}
        </div>

        <Link to="/admin" className="btn btn-secondary block text-center">Back to Admin</Link>
      </div>
    </Layout>
  );
}
