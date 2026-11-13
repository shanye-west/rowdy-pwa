import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { ChevronDown, ChevronUp, ExternalLink, Lock, Plus, Users } from "lucide-react";
import { db } from "../../firebase";
import AdminPage, { AdminNotFound } from "../../components/admin/AdminPage";
import AdminSection from "../../components/admin/AdminSection";
import NavRow, { EmptyRow } from "../../components/admin/NavRow";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import DangerZone from "../../components/admin/DangerZone";
import IndexTile from "../../components/admin/IndexTile";
import { ToggleCard } from "../../components/admin/fields";
import RoundForm from "../../components/admin/RoundForm";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useAdminTournament } from "../../contexts/AdminTournamentContext";
import { useMatches } from "../../hooks/admin/useMatches";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
import { formatRoundType } from "../../utils";
import { storedToLocalInput } from "../../utils/teeTime";
import type { ComputeRoundRecapResult, RoundUpdates } from "../../api/adminContracts";
import type { CourseDoc, MatchDoc } from "../../types";

/** "2026-08-07T08:40" → "Tee time 8:40 AM". Tee times are wall-clock strings, so no Date maths. */
function teeTimeLabel(teeTime: MatchDoc["teeTime"]): string | null {
  const m = /T(\d{2}):(\d{2})/.exec(storedToLocalInput(teeTime));
  if (!m) return null;
  const hour = Number(m[1]);
  return `Tee time ${hour % 12 || 12}:${m[2]} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * One round in context. Ordered by what an admin actually does during an
 * event: matches first (that's the day-of work), then the draft, the recap,
 * and only then the round's own settings. Route round/new renders the create
 * form instead.
 */
export default function RoundAdmin() {
  const navigate = useNavigate();
  const { roundId = "" } = useParams<{ roundId: string }>();
  const isNew = roundId === "new";
  const { tournamentId, tournament, players, rounds, loading: ctxLoading, refreshRounds } = useAdminTournament();
  const round = rounds.find((r) => r.id === roundId);

  const [courses, setCourses] = useState<CourseDoc[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [lockBusy, setLockBusy] = useState(false);
  const [recapBusy, setRecapBusy] = useState(false);
  const [recapResult, setRecapResult] = useState<ComputeRoundRecapResult | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // null = follow the round's state (open during setup, collapsed once matches exist).
  const [settingsOpen, setSettingsOpen] = useState<boolean | null>(null);

  const { matches, error: matchesError } = useMatches(isNew ? null : roundId);

  useEffect(() => {
    getDocs(collection(db, "courses"))
      .then((snap) => setCourses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CourseDoc))))
      .catch((err) => setError(getErrorMessage(err, "Failed to load courses")))
      .finally(() => setCoursesLoading(false));
  }, []);

  const playerName = useMemo(() => {
    const map: Record<string, string> = {};
    players.forEach((p) => { map[p.id] = p.displayName ?? p.id; });
    return map;
  }, [players]);

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

  const handleToggleLock = async (locked: boolean) => {
    setError(null);
    setSuccess(null);
    setLockBusy(true);
    try {
      await adminApi.updateRound({ roundId, updates: { locked } });
      await refreshRounds();
      setSuccess(locked ? "Round locked — score entry is frozen." : "Round unlocked — players can enter scores.");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update round lock"));
    } finally {
      setLockBusy(false);
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

  const tournamentLabel = tournament ? `${tournament.year} ${tournament.name}` : "Tournament";
  const breadcrumbs = [
    { label: "Admin", to: "/admin" },
    { label: tournament?.name ?? "Tournament", to: `/admin/t/${tournamentId}` },
    { label: isNew ? "New round" : `Day ${round?.day ?? "?"}` },
  ];

  if (ctxLoading || coursesLoading) {
    return (
      <AdminPage title={isNew ? "New round" : "Round"} breadcrumbs={breadcrumbs} loading>
        {null}
      </AdminPage>
    );
  }

  if (!isNew && !round) {
    return (
      <AdminNotFound
        title="Round"
        message="Round not found"
        backTo={`/admin/t/${tournamentId}`}
        backLabel="Back to tournament"
        breadcrumbs={breadcrumbs}
      />
    );
  }

  if (isNew) {
    return (
      <AdminPage
        headerTitle={tournamentLabel}
        breadcrumbs={breadcrumbs}
        title="New round"
        description="One round per day of play. You can add its matches — or run the captains' draft — once it exists."
        error={error}
      >
        <AdminSection title="Round settings" description="Format, course, points, drive tracking, and skins.">
          <RoundForm
            key="new"
            defaultDay={rounds.length + 1}
            courses={courses}
            showRoundIdInput
            submitting={submitting}
            submitLabel="Create round"
            onSubmit={handleSubmit}
          />
        </AdminSection>
      </AdminPage>
    );
  }

  const course = courses.find((c) => c.id === round!.courseId);
  const showSettings = settingsOpen ?? matches.length === 0;

  const matchLabel = (m: MatchDoc) => {
    const side = (list: MatchDoc["teamAPlayers"]) =>
      (list ?? []).map((p) => playerName[p.playerId] ?? p.playerId).join(" & ") || "TBD";
    return `${side(m.teamAPlayers)} vs ${side(m.teamBPlayers)}`;
  };

  const matchStatus = (m: MatchDoc) => {
    if (m.status?.closed) {
      const winner = m.result?.winner;
      const label =
        winner === "AS" ? "halved" : winner === "teamA" ? tournament?.teamA?.name ?? "Team A" : winner === "teamB" ? tournament?.teamB?.name ?? "Team B" : "final";
      return <Badge variant="success">{label}</Badge>;
    }
    const thru = m.status?.thru ?? 0;
    return thru > 0 ? <Badge variant="info">thru {thru}</Badge> : <Badge variant="muted">not started</Badge>;
  };

  return (
    <AdminPage
      headerTitle={tournamentLabel}
      breadcrumbs={breadcrumbs}
      eyebrow={`Day ${round!.day}`}
      title={formatRoundType(round!.format)}
      description={course ? `${course.name}${course.tees ? ` · ${course.tees} tees` : ""} · par ${course.par ?? "?"}` : "No course assigned yet."}
      badges={
        <>
          {round!.locked ? (
            <Badge variant="muted"><Lock className="mr-1 h-3 w-3" />locked</Badge>
          ) : (
            <Badge variant="success">open for scoring</Badge>
          )}
          <Badge variant="outline">{round!.pointsValue ?? 1} pt per match</Badge>
          {round!.trackDrives && <Badge variant="outline">drives tracked</Badge>}
        </>
      }
      error={error ?? matchesError}
      success={success}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to={`/round/${roundId}`}>
            <ExternalLink className="h-4 w-4" />
            View
          </Link>
        </Button>
      }
    >
      <ToggleCard
        label="Lock score entry"
        description={
          round!.locked
            ? "Locked — nobody can enter or change scores in this round."
            : "Open — rostered players can enter scores for their matches."
        }
        checked={!!round!.locked}
        onChange={handleToggleLock}
        disabled={lockBusy}
      />

      <AdminSection
        title={`Matches (${matches.length})`}
        description="Open a match to edit players, lock it, or fix a score."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to={`/admin/t/${tournamentId}/round/${roundId}/match/new`}>
              <Plus className="h-4 w-4" />
              Match
            </Link>
          </Button>
        }
      >
        <div className="space-y-2">
          {matches.map((m) => (
            <NavRow
              key={m.id}
              to={`/admin/t/${tournamentId}/match/${m.id}`}
              leading={<IndexTile value={m.matchNumber ?? "–"} />}
              title={matchLabel(m)}
              subtitle={teeTimeLabel(m.teeTime) ?? "No tee time set"}
              badges={
                <>
                  {m.locked && <Badge variant="muted"><Lock className="h-3 w-3" /></Badge>}
                  {matchStatus(m)}
                </>
              }
            />
          ))}
          {matches.length === 0 && (
            <EmptyRow>
              No matches yet — run the pairings draft below, or add them by hand.
            </EmptyRow>
          )}
        </div>
      </AdminSection>

      <AdminSection
        title="Pairings draft"
        description="Run the live captains' snake draft to set this round's matchups, then create the matches automatically."
      >
        <div className="flex flex-wrap gap-2">
          <Button asChild variant={matches.length === 0 ? "default" : "outline"}>
            <Link to={`/round/${roundId}/pairings`}>
              <Users className="h-4 w-4" />
              Open pairings draft
            </Link>
          </Button>
        </div>
      </AdminSection>

      <AdminSection
        title="Round recap"
        description={'The "vs All" simulation, scoring leaders, and hole averages. Every match must be closed first. Only one recap per round — delete the existing one in Firestore before regenerating.'}
      >
        {recapResult ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-700">
              {recapResult.message} — {recapResult.stats.playersAnalyzed} players analyzed, birdie leader{" "}
              {recapResult.stats.birdiesGrossLeader} ({recapResult.stats.birdiesGrossCount}).
            </p>
            <Button asChild>
              <Link to={`/round/${roundId}/recap`}>View recap</Link>
            </Button>
          </div>
        ) : (
          <Button type="button" onClick={handleGenerateRecap} disabled={recapBusy}>
            {recapBusy ? "Generating…" : "Generate recap"}
          </Button>
        )}
      </AdminSection>

      <AdminSection
        title="Round settings"
        description="Format, course, points, drive tracking, and skins."
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(!showSettings)}
            aria-expanded={showSettings}
          >
            {showSettings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {showSettings ? "Hide" : "Edit"}
          </Button>
        }
      >
        {showSettings ? (
          <RoundForm
            key={round!.id}
            initial={round}
            defaultDay={rounds.length + 1}
            courses={courses}
            hideLock
            submitting={submitting}
            submitLabel="Save round"
            onSubmit={handleSubmit}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {formatRoundType(round!.format)} · {course?.name ?? "no course"} · {round!.pointsValue ?? 1} pt per match
            {(round!.skinsGrossPot ?? 0) > 0 || (round!.skinsNetPot ?? 0) > 0
              ? ` · skins $${round!.skinsGrossPot ?? 0} gross / $${round!.skinsNetPot ?? 0} net`
              : ""}
          </p>
        )}
      </AdminSection>

      <DangerZone
        title="Delete round"
        description="Removes the round, all its matches, their stats, skins results, and any recap. Stats recompute automatically."
        actionLabel="Delete round"
        onAction={() => setConfirmDelete(true)}
        disabled={deleting}
      />

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Delete round?"
        confirmLabel="Delete round"
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
    </AdminPage>
  );
}
