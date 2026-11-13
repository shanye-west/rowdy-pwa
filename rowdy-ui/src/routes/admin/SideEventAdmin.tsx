import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { ExternalLink, Plus } from "lucide-react";
import { db } from "../../firebase";
import AdminPage, { AdminNotFound } from "../../components/admin/AdminPage";
import AdminSection from "../../components/admin/AdminSection";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import DangerZone from "../../components/admin/DangerZone";
import { EmptyRow } from "../../components/admin/NavRow";
import SideEventForm from "../../components/admin/SideEventForm";
import { dangerButtonClass, inputClass } from "../../components/admin/inputStyles";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { useAdminTournament } from "../../contexts/AdminTournamentContext";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
import { holeNumbersForNine } from "../../utils/sideEventScoring";
import type { SideEventUpdates } from "../../api/adminContracts";
import type { CourseDoc, SideEventDoc, SideEventTeamDoc } from "../../types";

/** Default team size — a 3-man scramble, but 2–4 is allowed for odd headcounts. */
const DEFAULT_TEAM_SIZE = 3;
const MIN_TEAM_SIZE = 2;
const MAX_TEAM_SIZE = 4;

/**
 * Admin page for one side event: settings + payouts, its free-form teams, and
 * deletion. `sideEventId === "new"` is the create sentinel, matching RoundAdmin.
 *
 * The team builder is deliberately NOT roster-scoped: a side event's teams mix
 * both Cup rosters freely (a Pecker can play with two Bushwhackers), which is
 * exactly why this can't reuse MatchForm.
 */
export default function SideEventAdmin() {
  const navigate = useNavigate();
  const { sideEventId = "" } = useParams<{ sideEventId: string }>();
  const isNew = sideEventId === "new";
  const { tournamentId, tournament, players, loading: ctxLoading } = useAdminTournament();

  const [event, setEvent] = useState<SideEventDoc | null>(null);
  const [eventLoaded, setEventLoaded] = useState(false);
  const [teams, setTeams] = useState<SideEventTeamDoc[]>([]);
  const [courses, setCourses] = useState<CourseDoc[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [teamBusyId, setTeamBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeTeamId, setRemoveTeamId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Draft rows for teams being built/edited. teamId "new" is the add-a-team row.
  const [draftTeams, setDraftTeams] = useState<Record<string, string[]>>({});
  const [newTeam, setNewTeam] = useState<string[]>(Array(DEFAULT_TEAM_SIZE).fill(""));
  // teamId -> { holeNumber: rawInput }. Only present while an admin is editing.
  const [draftScores, setDraftScores] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    getDocs(collection(db, "courses"))
      .then((snap) => setCourses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CourseDoc))))
      .catch((err) => setError(getErrorMessage(err, "Failed to load courses")))
      .finally(() => setCoursesLoading(false));
  }, []);

  useEffect(() => {
    if (isNew) {
      setEventLoaded(true);
      return;
    }
    getDoc(doc(db, "sideEvents", sideEventId))
      .then((snap) => setEvent(snap.exists() ? ({ id: snap.id, ...snap.data() } as SideEventDoc) : null))
      .catch((err) => setError(getErrorMessage(err, "Failed to load side event")))
      .finally(() => setEventLoaded(true));
  }, [isNew, sideEventId]);

  useEffect(() => {
    if (isNew) return;
    const unsub = onSnapshot(
      query(collection(db, "sideEventTeams"), where("sideEventId", "==", sideEventId)),
      (snap) => {
        setTeams(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as SideEventTeamDoc))
            .sort((a, b) => (a.teamNumber ?? 0) - (b.teamNumber ?? 0))
        );
      },
      (err) => setError(getErrorMessage(err, "Failed to load teams"))
    );
    return unsub;
  }, [isNew, sideEventId]);

  /**
   * Every rostered player, both teams merged and sorted by name — the whole
   * point of a side event is that teams aren't restricted to one Cup roster.
   */
  const allPlayers = useMemo(
    () => [...players].sort((a, b) => (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id)),
    [players]
  );

  /** playerId -> the team it is already on, so the UI can warn about doubles. */
  const assignedElsewhere = useCallback(
    (playerId: string, exceptTeamId: string | null) => {
      if (!playerId) return null;
      const owner = teams.find((t) => t.id !== exceptTeamId && t.playerIds?.includes(playerId));
      return owner ? owner.teamNumber : null;
    },
    [teams]
  );

  const slotsFor = (team: SideEventTeamDoc) =>
    draftTeams[team.id] ?? [...(team.playerIds ?? [])];

  const setSlot = (teamId: string, index: number, value: string, current: string[]) => {
    const next = [...current];
    next[index] = value;
    setDraftTeams((prev) => ({ ...prev, [teamId]: next }));
  };

  const handleSubmit = async (updates: SideEventUpdates) => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      if (isNew) {
        const res = await adminApi.createSideEvent({ tournamentId, ...updates });
        navigate(`/admin/t/${tournamentId}/side-event/${res.sideEventId}`, { replace: true });
      } else {
        await adminApi.updateSideEvent({ sideEventId, updates });
        const snap = await getDoc(doc(db, "sideEvents", sideEventId));
        if (snap.exists()) setEvent({ id: snap.id, ...snap.data() } as SideEventDoc);
        setSuccess("Side event updated.");
      }
    } catch (err) {
      console.error("Error saving side event:", err);
      setError(getErrorMessage(err, "Failed to save side event"));
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Admin score correction. Players enter their own scores on the scorecard,
   * but an admin needs a way in when the event is locked, a phone died, or a
   * player never linked their account. Mirrors adminOverrideHoleScore for
   * matches. Sends the whole nine so a cleared hole round-trips as `null`.
   */
  const saveTeamScores = async (team: SideEventTeamDoc, scores: Record<string, string>) => {
    setError(null);
    setSuccess(null);
    setTeamBusyId(team.id);
    try {
      const holes: Record<string, { gross: number | null }> = {};
      for (const [hole, raw] of Object.entries(scores)) {
        const trimmed = raw.trim();
        holes[hole] = { gross: trimmed === "" ? null : Number(trimmed) };
      }
      await adminApi.saveSideEventTeam({
        sideEventId,
        teamId: team.id,
        playerIds: team.playerIds ?? [],
        holes,
      });
      setDraftScores((prev) => {
        const next = { ...prev };
        delete next[team.id];
        return next;
      });
      setSuccess("Scores saved.");
    } catch (err) {
      console.error("Save scores failed:", err);
      setError(getErrorMessage(err, "Failed to save scores"));
    } finally {
      setTeamBusyId(null);
    }
  };

  const saveTeam = async (teamId: string | null, playerIds: string[]) => {
    const clean = playerIds.filter(Boolean);
    if (clean.length < MIN_TEAM_SIZE) {
      setError(`A team needs at least ${MIN_TEAM_SIZE} players.`);
      return;
    }
    if (new Set(clean).size !== clean.length) {
      setError("A player can only appear once on a team.");
      return;
    }
    setError(null);
    setSuccess(null);
    setTeamBusyId(teamId ?? "new");
    try {
      await adminApi.saveSideEventTeam({
        sideEventId,
        ...(teamId ? { teamId } : {}),
        playerIds: clean,
      });
      if (teamId) {
        setDraftTeams((prev) => {
          const next = { ...prev };
          delete next[teamId];
          return next;
        });
        setSuccess("Team saved.");
      } else {
        setNewTeam(Array(DEFAULT_TEAM_SIZE).fill(""));
        setSuccess("Team added.");
      }
    } catch (err) {
      console.error("Save team failed:", err);
      setError(getErrorMessage(err, "Failed to save team"));
    } finally {
      setTeamBusyId(null);
    }
  };

  const removeTeam = async (teamId: string) => {
    setError(null);
    setSuccess(null);
    setTeamBusyId(teamId);
    try {
      await adminApi.deleteSideEventTeam({ sideEventId, teamId });
      setSuccess("Team removed.");
    } catch (err) {
      console.error("Delete team failed:", err);
      setError(getErrorMessage(err, "Failed to remove team"));
    } finally {
      setTeamBusyId(null);
    }
  };

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    try {
      await adminApi.deleteSideEvent({ sideEventId });
      navigate(`/admin/t/${tournamentId}`, { replace: true });
    } catch (err) {
      console.error("Delete side event failed:", err);
      setError(getErrorMessage(err, "Failed to delete side event"));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const breadcrumbs = [
    { label: "Admin", to: "/admin" },
    { label: tournament?.name ?? "Tournament", to: `/admin/t/${tournamentId}` },
    { label: isNew ? "New side event" : event?.name ?? "Side event" },
  ];

  if (ctxLoading || coursesLoading || !eventLoaded) {
    return (
      <AdminPage title={isNew ? "New side event" : "Side event"} breadcrumbs={breadcrumbs} loading>
        {null}
      </AdminPage>
    );
  }

  if (!isNew && !event) {
    return (
      <AdminNotFound
        title="Side event"
        message="Side event not found"
        backTo={`/admin/t/${tournamentId}`}
        backLabel="Back to tournament"
        breadcrumbs={breadcrumbs}
      />
    );
  }

  /** One team's row of player pickers. */
  const renderSlots = (teamId: string | null, slots: string[], onChange: (i: number, v: string) => void) => (
    <div className="space-y-2">
      {slots.map((pid, idx) => {
        const clash = assignedElsewhere(pid, teamId);
        return (
          <div key={idx}>
            <select
              value={pid}
              onChange={(e) => onChange(idx, e.target.value)}
              className={inputClass}
              aria-label={`Player slot ${idx + 1}`}
            >
              <option value="">— empty —</option>
              {allPlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName || p.id}</option>
              ))}
            </select>
            {clash !== null && (
              <div className="mt-1 text-xs text-amber-700" role="alert">
                Already on team {clash} — saving will be rejected.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  /** Compact 9-box score override for one team. */
  const renderScores = (team: SideEventTeamDoc) => {
    const holes = holeNumbersForNine(event!.nine === "back" ? "back" : "front");
    const draft = draftScores[team.id];
    const valueFor = (hole: number) => {
      if (draft) return draft[String(hole)] ?? "";
      const gross = team.holes?.[String(hole)]?.gross;
      return typeof gross === "number" ? String(gross) : "";
    };
    const setScore = (hole: number, value: string) => {
      const base = draft ?? Object.fromEntries(holes.map((h) => [String(h), valueFor(h)]));
      setDraftScores((prev) => ({ ...prev, [team.id]: { ...base, [String(hole)]: value } }));
    };

    return (
      <div className="pt-2">
        <div className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Scores <span className="font-normal normal-case tracking-normal">(admin override — blank clears)</span>
        </div>
        <div className="grid grid-cols-9 gap-1">
          {holes.map((hole) => (
            <div key={hole}>
              <div className="text-center text-[0.6rem] text-muted-foreground">{hole}</div>
              <input
                type="number"
                min="1"
                max="30"
                inputMode="numeric"
                aria-label={`Hole ${hole} score for team ${team.teamNumber}`}
                value={valueFor(hole)}
                onChange={(e) => setScore(hole, e.target.value)}
                className={cn(inputClass, "px-1 py-1 text-center")}
              />
            </div>
          ))}
        </div>
        {draft && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => saveTeamScores(team, draft)}
            disabled={teamBusyId === team.id}
            className="mt-2"
          >
            {teamBusyId === team.id ? "Saving…" : "Save scores"}
          </Button>
        )}
      </div>
    );
  };

  const title = isNew ? "New side event" : event!.name;
  const removingTeam = teams.find((t) => t.id === removeTeamId);

  const settingsSection = (
      <AdminSection
        title={isNew ? "New side event" : "Settings & payouts"}
        description="Name, course and nine, the lock, menu visibility, and the payout schedule."
      >
        <SideEventForm
          key={isNew ? "new" : event!.id}
          initial={isNew ? undefined : event!}
          courses={courses}
          submitting={submitting}
          submitLabel={isNew ? "Create side event" : "Save side event"}
          onSubmit={handleSubmit}
        />
      </AdminSection>
  );

  return (
    <AdminPage
      headerTitle={tournament ? `${tournament.year} ${tournament.name}` : "Admin"}
      breadcrumbs={breadcrumbs}
      eyebrow="Side event"
      title={title}
      description="Awards no Cup points and records no player stats — it lives in its own collections, apart from rounds and matches. Players reach it from the hamburger menu only."
      badges={
        !isNew ? (
          <>
            {event!.locked && <Badge variant="muted">locked</Badge>}
            {event!.hidden && <Badge variant="warning">hidden</Badge>}
            <Badge variant="outline">{event!.nine === "back" ? "back 9" : "front 9"}</Badge>
          </>
        ) : null
      }
      error={error}
      success={success}
      actions={
        !isNew ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/side-event/${sideEventId}`}>
              <ExternalLink className="h-4 w-4" />
              View
            </Link>
          </Button>
        ) : null
      }
    >
      {isNew && settingsSection}

      {!isNew && (
        <>
          <AdminSection
            title={`Teams (${teams.length})`}
            description={`Pick any ${MIN_TEAM_SIZE}–${MAX_TEAM_SIZE} players from either roster — teams are not restricted to ${tournament?.teamA?.name ?? "Team A"} or ${tournament?.teamB?.name ?? "Team B"}.`}
          >
            <div className="space-y-4">
              {teams.map((team) => {
                const slots = slotsFor(team);
                const dirty = draftTeams[team.id] !== undefined;
                return (
                  <div key={team.id} className="space-y-2 rounded-xl border border-border/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">Team {team.teamNumber}</div>
                      {dirty && <Badge variant="warning">unsaved</Badge>}
                    </div>

                    {renderSlots(team.id, slots, (i, v) => setSlot(team.id, i, v, slots))}

                    {renderScores(team)}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSlot(team.id, slots.length, "", slots)}
                        disabled={slots.length >= MAX_TEAM_SIZE}
                      >
                        <Plus className="h-4 w-4" />
                        Slot
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => saveTeam(team.id, slots)}
                        disabled={!dirty || teamBusyId === team.id}
                      >
                        {teamBusyId === team.id ? "Saving…" : "Save team"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRemoveTeamId(team.id)}
                        disabled={teamBusyId === team.id}
                        className={cn("ml-auto", dangerButtonClass)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}

              {teams.length === 0 && <EmptyRow>No teams yet — build the first one below.</EmptyRow>}

              <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
                <div className="text-sm font-semibold">Add a team</div>
                {renderSlots(null, newTeam, (i, v) => {
                  const next = [...newTeam];
                  next[i] = v;
                  setNewTeam(next);
                })}
                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setNewTeam([...newTeam, ""])}
                    disabled={newTeam.length >= MAX_TEAM_SIZE}
                  >
                    <Plus className="h-4 w-4" />
                    Slot
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => saveTeam(null, newTeam)}
                    disabled={teamBusyId === "new"}
                  >
                    {teamBusyId === "new" ? "Adding…" : "Add team"}
                  </Button>
                </div>
              </div>
            </div>
          </AdminSection>

          {settingsSection}

          <DangerZone
            title="Delete side event"
            description="Removes the event and all of its teams and scores. Nothing else is affected — side events never touch Cup points or stats."
            actionLabel="Delete side event"
            onAction={() => setConfirmDelete(true)}
            disabled={deleting}
          />

          <ConfirmDialog
            isOpen={removeTeamId !== null}
            title={`Remove team ${removingTeam?.teamNumber ?? ""}?`}
            confirmLabel="Remove team"
            danger
            busy={teamBusyId !== null && teamBusyId === removeTeamId}
            onConfirm={() => {
              const id = removeTeamId;
              setRemoveTeamId(null);
              if (id) void removeTeam(id);
            }}
            onCancel={() => setRemoveTeamId(null)}
          >
            Removes the team and any scores it has entered. The players go back into the pool.
          </ConfirmDialog>

          <ConfirmDialog
            isOpen={confirmDelete}
            title="Delete side event?"
            confirmLabel="Delete side event"
            danger
            busy={deleting}
            onConfirm={handleDelete}
            onCancel={() => setConfirmDelete(false)}
          >
            This permanently deletes <strong>{event!.name}</strong> and its{" "}
            <strong>{teams.length} team{teams.length === 1 ? "" : "s"}</strong> with their scores.
          </ConfirmDialog>
        </>
      )}
    </AdminPage>
  );
}
