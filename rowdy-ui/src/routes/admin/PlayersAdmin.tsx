import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Plus, X } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import AdminPage from "../../components/admin/AdminPage";
import AdminSection from "../../components/admin/AdminSection";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import { Field, InfoNote } from "../../components/admin/fields";
import SearchInput from "../../components/admin/SearchInput";
import { dangerButtonClass, inputClass, monoInputClass } from "../../components/admin/inputStyles";
import { Modal } from "../../components/Modal";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useAuth } from "../../contexts/AuthContext";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
import { cn } from "../../lib/utils";
import type { PlayerDoc } from "../../types";

/** Player management: create, rename, link logins, admin access, delete. */
export default function PlayersAdmin() {
  const { player: me } = useAuth();
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Create form (in a modal, so the list stays at the top of the page)
  const [showCreate, setShowCreate] = useState(false);
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
  // The editor opens below a long list — bring it into view so picking a
  // player on a phone doesn't look like nothing happened.
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedId]);
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

  const visiblePlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (p) => (p.displayName ?? "").toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
  }, [players, search]);

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
      setShowCreate(false);
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

  return (
    <AdminPage
      title="Players"
      breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Players" }]}
      description="The global player list. Tournament handicaps are set per-tournament under Rosters."
      error={error}
      success={success}
      loading={loading}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          Add player
        </Button>
      }
    >
      <AdminSection
        title={`Players (${players.length})`}
        description="Pick someone to rename them, link their login, or change access."
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name or id"
          label="Search players"
          className="mb-3"
        />

        <div className="max-h-80 space-y-1 overflow-y-auto">
          {visiblePlayers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPlayer(p.id)}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                p.id === selectedId
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/70 hover:bg-muted/60"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-semibold">{p.displayName ?? p.id}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{p.id}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                  {p.isAdmin && <Badge variant="default">admin</Badge>}
                  {p.authUid ? <Badge variant="success">linked</Badge> : <Badge variant="muted">no login</Badge>}
                </div>
              </div>
            </button>
          ))}
          {visiblePlayers.length === 0 && (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              {players.length === 0 ? "No players yet." : "No players match that search."}
            </p>
          )}
        </div>
      </AdminSection>

      {selected && (
        <div ref={editorRef} className="scroll-mt-32">
        <AdminSection
          title={selected.displayName ?? selected.id}
          description={selected.id}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSelectedId("")}
              aria-label="Close player editor"
            >
              <X className="h-4 w-4" />
            </Button>
          }
        >
          <div className="space-y-5">
            <form onSubmit={handleSaveInfo} className="space-y-3">
              <Field label="Display name">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className={inputClass}
                  required
                />
              </Field>
              <Field
                label="Scouting notes"
                hint="Subjective take used by AI for draft & pairing suggestions. Not shown in stats. Leave blank to clear."
              >
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  className={inputClass}
                  placeholder="e.g. Longest hitter but inconsistent off the tee; deadly with a wedge; streaky putter."
                />
              </Field>
              <Button type="submit" variant="outline" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </form>

            <form onSubmit={handleLink} className="space-y-3 border-t border-border/60 pt-4">
              <Field
                label="Login account"
                hint="Existing matches keep their original authorized players — re-save those matches if this player needs access to them."
              >
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={linkEmail}
                    onChange={(e) => setLinkEmail(e.target.value)}
                    placeholder="player@email.com"
                    className={inputClass}
                    required
                  />
                  <Button type="submit" variant="outline" disabled={busy} className="shrink-0">
                    Link
                  </Button>
                </div>
              </Field>
              <InfoNote>
                {selected.authUid
                  ? `Linked to ${selectedEmail ?? (loadingPrivate ? "…" : "an account")}. Re-linking replaces the connection.`
                  : "Not linked. The player must have signed in once before you can link them by email."}
              </InfoNote>
            </form>

            <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-4">
              <div className="min-w-0 text-sm">
                <div className="font-semibold">Admin access</div>
                <div className="text-xs text-muted-foreground">
                  {isSelf
                    ? "You can't change your own admin access."
                    : selected.isAdmin
                      ? "Can manage tournaments, matches, players, and stats."
                      : "Regular player — score entry only."}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmAdminChange(true)}
                disabled={busy || isSelf}
                className="shrink-0"
              >
                {selected.isAdmin ? "Remove" : "Make admin"}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/30 p-3">
              <div className="min-w-0 text-sm">
                <div className="font-semibold text-destructive">Delete player</div>
                <div className="text-xs text-muted-foreground">
                  Only possible with no match history and off every roster.
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className={cn("shrink-0", dangerButtonClass)}
              >
                Delete
              </Button>
            </div>
          </div>
        </AdminSection>
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Add player" maxWidth="max-w-md">
        <form onSubmit={handleCreate} className="space-y-3 text-left">
          <Field label="Player ID" hint="Convention: pFirstLast (e.g. pShanePeterson).">
            <input
              type="text"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="pFirstLast"
              className={monoInputClass}
              required
            />
          </Field>
          <Field label="Display name">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="First Last"
              className={inputClass}
              required
            />
          </Field>
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={busy} className="flex-1">
              {busy ? "Working…" : "Create player"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={confirmAdminChange}
        title={selected?.isAdmin ? "Remove admin access?" : "Grant admin access?"}
        confirmLabel={selected?.isAdmin ? "Remove admin" : "Make admin"}
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
        confirmLabel="Delete player"
        danger
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      >
        Permanently deletes <strong>{selected?.displayName ?? selected?.id}</strong>. The server
        refuses if they have match history or are still on a tournament roster. Their login
        account (if any) is not removed.
      </ConfirmDialog>
    </AdminPage>
  );
}
