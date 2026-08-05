import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import Layout from "../../components/Layout";
import StatusBanner from "../../components/admin/StatusBanner";
import AdminSection from "../../components/admin/AdminSection";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import SideEventForm from "../../components/admin/SideEventForm";
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

  if (ctxLoading || coursesLoading || !eventLoaded) {
    return (
      <Layout title={isNew ? "Create Side Event" : "Side Event Admin"} showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  if (!isNew && !event) {
    return (
      <Layout title="Side Event Admin" showBack>
        <div className="p-4 space-y-4">
          <StatusBanner error="Side event not found" />
          <Link to={`/admin/t/${tournamentId}`} className="btn btn-secondary">Back to Tournament</Link>
        </div>
      </Layout>
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
              className="w-full p-2 border border-gray-300 rounded-lg"
            >
              <option value="">— empty —</option>
              {allPlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName || p.id}</option>
              ))}
            </select>
            {clash !== null && (
              <div className="mt-1 text-xs text-amber-700">
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
        <div className="text-xs font-semibold text-gray-600 mb-1">
          Scores <span className="font-normal text-gray-500">(admin override — blank clears)</span>
        </div>
        <div className="grid grid-cols-9 gap-1">
          {holes.map((hole) => (
            <div key={hole}>
              <div className="text-center text-[0.6rem] text-gray-500">{hole}</div>
              <input
                type="number"
                min="1"
                max="30"
                inputMode="numeric"
                aria-label={`Hole ${hole} score for team ${team.teamNumber}`}
                value={valueFor(hole)}
                onChange={(e) => setScore(hole, e.target.value)}
                className="w-full p-1 text-center border border-gray-300 rounded"
              />
            </div>
          ))}
        </div>
        {draft && (
          <button
            type="button"
            onClick={() => saveTeamScores(team, draft)}
            disabled={teamBusyId === team.id}
            className="btn btn-secondary text-sm mt-2"
          >
            {teamBusyId === team.id ? "Saving..." : "Save scores"}
          </button>
        )}
      </div>
    );
  };

  const title = isNew ? "Create Side Event" : event!.name;

  return (
    <Layout title={title} showBack>
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <StatusBanner error={error} success={success} />

        {!isNew && (
          <p className="text-sm text-gray-600">
            This event awards <strong>no Cup points</strong> and records{" "}
            <strong>no player stats</strong> — it lives in its own collections, apart from rounds
            and matches. It never appears on the tournament home page; players reach it from the
            hamburger menu.
          </p>
        )}

        <AdminSection
          title={isNew ? "New Side Event" : "Settings & Payouts"}
          description="Name, course and nine, the lock, menu visibility, and the payout schedule."
        >
          <SideEventForm
            key={isNew ? "new" : event!.id}
            initial={isNew ? undefined : event!}
            courses={courses}
            submitting={submitting}
            submitLabel={isNew ? "Create Side Event" : "Save Side Event"}
            onSubmit={handleSubmit}
          />
        </AdminSection>

        {!isNew && (
          <>
            <AdminSection
              title="Teams"
              description={`Pick any ${MIN_TEAM_SIZE}–${MAX_TEAM_SIZE} players from either roster — teams are not restricted to ${tournament?.teamA?.name ?? "Team A"} or ${tournament?.teamB?.name ?? "Team B"}.`}
            >
              <div className="space-y-4">
                {teams.map((team) => {
                  const slots = slotsFor(team);
                  const dirty = draftTeams[team.id] !== undefined;
                  return (
                    <div key={team.id} className="p-3 border border-gray-200 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">Team {team.teamNumber}</div>
                        <div className="text-xs text-gray-500 font-mono">{team.id}</div>
                      </div>

                      {renderSlots(team.id, slots, (i, v) => setSlot(team.id, i, v, slots))}

                      {renderScores(team)}

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setSlot(team.id, slots.length, "", slots)}
                          disabled={slots.length >= MAX_TEAM_SIZE}
                          className="btn btn-secondary text-sm"
                        >
                          + Add slot
                        </button>
                        <button
                          type="button"
                          onClick={() => saveTeam(team.id, slots)}
                          disabled={!dirty || teamBusyId === team.id}
                          className="btn btn-primary text-sm"
                        >
                          {teamBusyId === team.id ? "Saving..." : "Save team"}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTeam(team.id)}
                          disabled={teamBusyId === team.id}
                          className="btn btn-secondary text-sm text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}

                {teams.length === 0 && <div className="text-sm text-gray-500">No teams yet.</div>}

                <div className="p-3 border border-dashed border-gray-300 rounded-lg space-y-2">
                  <div className="font-semibold">Add a team</div>
                  {renderSlots(null, newTeam, (i, v) => {
                    const next = [...newTeam];
                    next[i] = v;
                    setNewTeam(next);
                  })}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setNewTeam([...newTeam, ""])}
                      disabled={newTeam.length >= MAX_TEAM_SIZE}
                      className="btn btn-secondary text-sm"
                    >
                      + Add slot
                    </button>
                    <button
                      type="button"
                      onClick={() => saveTeam(null, newTeam)}
                      disabled={teamBusyId === "new"}
                      className="btn btn-primary text-sm"
                    >
                      {teamBusyId === "new" ? "Adding..." : "Add team"}
                    </button>
                  </div>
                </div>
              </div>
            </AdminSection>

            <AdminSection title="View" description="The player-facing leaderboard for this event.">
              <Link to={`/side-event/${sideEventId}`} className="btn btn-primary">
                Open leaderboard
              </Link>
            </AdminSection>

            <AdminSection
              title="Delete Side Event"
              description="Removes the event and all of its teams and scores. Nothing else is affected — side events never touch Cup points or stats."
              danger
            >
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
                className="btn bg-red-600 text-white"
              >
                Delete Side Event
              </button>
            </AdminSection>

            <ConfirmDialog
              isOpen={confirmDelete}
              title="Delete side event?"
              confirmLabel="Delete Side Event"
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
      </div>
    </Layout>
  );
}
