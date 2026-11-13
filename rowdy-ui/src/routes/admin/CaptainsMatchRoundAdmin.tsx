import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { ExternalLink } from "lucide-react";
import { db } from "../../firebase";
import AdminPage, { AdminNotFound, type Crumb } from "../../components/admin/AdminPage";
import AdminSection from "../../components/admin/AdminSection";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import DangerZone from "../../components/admin/DangerZone";
import SaveBar from "../../components/admin/SaveBar";
import { Field, InfoNote } from "../../components/admin/fields";
import { inputClass } from "../../components/admin/inputStyles";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useAdminTournament } from "../../contexts/AdminTournamentContext";
import { usePlayers } from "../../contexts/TournamentContext";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
import { cn } from "../../lib/utils";
import { isValidGross } from "../../utils/matchScoring";
import { getTeamColor } from "../../utils/teamColors";
import {
  HOLES_PER_ROUND,
  allocateStrokes,
  formatCaptainsMatchStatus,
  formatRoundRanges,
  summarizeCaptainsMatch,
  type CaptainsHoleResult,
  type CaptainsSide,
} from "../../utils/captainsMatchScoring";
import type { CaptainsMatchDoc, CaptainsMatchRound, CourseDoc, TournamentDoc } from "../../types";

/** Course select value for a course that isn't in the app. */
const OTHER_COURSE = "__other__";

/** Stored scores → input strings ("" for blank). */
function toInputs(values: (number | null)[] | undefined): string[] {
  return Array.from({ length: HOLES_PER_ROUND }, (_, i) => {
    const v = values?.[i];
    return isValidGross(v) ? String(v) : "";
  });
}

function toStrokes(values: number[] | undefined): number[] {
  return Array.from({ length: HOLES_PER_ROUND }, (_, i) => (Number(values?.[i]) === 1 ? 1 : 0));
}

const countStrokes = (strokes: number[]) => strokes.reduce((sum, s) => sum + s, 0);

/** "" → blank; a plausible whole-number score → that number; anything else → "invalid". */
function parseScore(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return isValidGross(n) ? n : "invalid";
}

/**
 * Admin page for one round's card in the captains' match: date, course,
 * handicap strokes, and both players' 18 gross scores, with a live preview of
 * the round and the running match. Loads the match and courses, then hands off
 * to the editor so its state initializes once from the saved card.
 */
export default function CaptainsMatchRoundAdmin() {
  const { roundNumber: roundParam = "" } = useParams<{ roundNumber: string }>();
  const roundNumber = Number(roundParam);
  const { tournamentId, tournament, loading: ctxLoading } = useAdminTournament();

  const [match, setMatch] = useState<CaptainsMatchDoc | null>(null);
  const [matchLoaded, setMatchLoaded] = useState(false);
  const [courses, setCourses] = useState<CourseDoc[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getDoc(doc(db, "captainsMatches", tournamentId))
      .then((snap) => setMatch(snap.exists() ? ({ id: snap.id, ...snap.data() } as CaptainsMatchDoc) : null))
      .catch((err) => setLoadError(getErrorMessage(err, "Failed to load the captains' match")))
      .finally(() => setMatchLoaded(true));
  }, [tournamentId]);

  useEffect(() => {
    getDocs(collection(db, "courses"))
      .then((snap) =>
        setCourses(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as CourseDoc))
            .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
        )
      )
      .catch((err) => setLoadError(getErrorMessage(err, "Failed to load courses")))
      .finally(() => setCoursesLoading(false));
  }, []);

  const breadcrumbs: Crumb[] = [
    { label: "Admin", to: "/admin" },
    { label: tournament?.name ?? "Tournament", to: `/admin/t/${tournamentId}` },
    { label: "Captains' match", to: `/admin/t/${tournamentId}/captains-match` },
    { label: `Round ${roundParam}` },
  ];

  if (ctxLoading || !matchLoaded || coursesLoading) {
    return (
      <AdminPage title={`Round ${roundParam}`} breadcrumbs={breadcrumbs} loading>
        {null}
      </AdminPage>
    );
  }

  if (!tournament || !match) {
    return (
      <AdminNotFound
        title={`Round ${roundParam}`}
        message={loadError ?? (tournament ? "This tournament has no captains' match yet." : "Tournament not found")}
        backTo={tournament ? `/admin/t/${tournamentId}/captains-match` : "/admin"}
        backLabel="Back"
        breadcrumbs={breadcrumbs}
      />
    );
  }

  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > match.totalRounds) {
    return (
      <AdminNotFound
        title="Round"
        message={`Rounds run from 1 to ${match.totalRounds}.`}
        backTo={`/admin/t/${tournamentId}/captains-match`}
        backLabel="Back to the captains' match"
        breadcrumbs={breadcrumbs}
      />
    );
  }

  return (
    <RoundCardEditor
      key={`${tournamentId}-${roundNumber}`}
      tournamentId={tournamentId}
      tournament={tournament}
      match={match}
      roundNumber={roundNumber}
      courses={courses}
      breadcrumbs={breadcrumbs}
      onSaved={(round) =>
        setMatch((prev) =>
          prev ? { ...prev, rounds: { ...(prev.rounds ?? {}), [String(round.roundNumber)]: round } } : prev
        )
      }
    />
  );
}

interface RoundCardEditorProps {
  tournamentId: string;
  tournament: TournamentDoc;
  match: CaptainsMatchDoc;
  roundNumber: number;
  courses: CourseDoc[];
  breadcrumbs: Crumb[];
  onSaved: (round: CaptainsMatchRound) => void;
}

function RoundCardEditor({
  tournamentId,
  tournament,
  match,
  roundNumber,
  courses,
  breadcrumbs,
  onSaved,
}: RoundCardEditorProps) {
  const navigate = useNavigate();
  const existing = match.rounds?.[String(roundNumber)] ?? null;
  const { players } = usePlayers([match.playerAId, match.playerBId]);

  const [playedOn, setPlayedOn] = useState(existing?.playedOn ?? "");
  const [courseChoice, setCourseChoice] = useState(
    existing?.courseId ?? (existing?.courseName ? OTHER_COURSE : "")
  );
  const [courseName, setCourseName] = useState(existing && !existing.courseId ? existing.courseName ?? "" : "");
  const [grossA, setGrossA] = useState(() => toInputs(existing?.grossA));
  const [grossB, setGrossB] = useState(() => toInputs(existing?.grossB));
  const [strokesA, setStrokesA] = useState(() => toStrokes(existing?.strokesA));
  const [strokesB, setStrokesB] = useState(() => toStrokes(existing?.strokesB));
  // Each player's course handicap for the day. The captains' match is played
  // off FULL handicaps — no spin-down to the lower player like Cup singles — so
  // each number places that player's own strokes. Seeded from the saved card;
  // the per-hole stroke arrays above stay the source of truth (the grid's dots
  // edit them).
  const [handicapA, setHandicapA] = useState(() =>
    existing ? String(countStrokes(toStrokes(existing.strokesA))) : ""
  );
  const [handicapB, setHandicapB] = useState(() =>
    existing ? String(countStrokes(toStrokes(existing.strokesB))) : ""
  );

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const nameA = players[match.playerAId]?.displayName?.trim().split(/\s+/)[0] || "Player A";
  const nameB = players[match.playerBId]?.displayName?.trim().split(/\s+/)[0] || "Player B";
  const colorA = getTeamColor(tournament.series, "teamA", tournament.teamA?.color);
  const colorB = getTeamColor(tournament.series, "teamB", tournament.teamB?.color);

  const selectedCourse =
    courseChoice && courseChoice !== OTHER_COURSE ? courses.find((c) => c.id === courseChoice) ?? null : null;
  const holeInfo = new Map((selectedCourse?.holes ?? []).map((h) => [h.number, h]));
  const canPlaceStrokes = allocateStrokes(0, selectedCourse?.holes) !== null;

  /**
   * Put one player's strokes on the course's hardest holes. Runs only when a
   * handicap or the course changes — never on load — so hand-ticked holes on a
   * saved card survive until the admin asks for a re-placement.
   */
  const placeStrokes = (side: CaptainsSide, handicap: string, course: CourseDoc | null) => {
    const placed = allocateStrokes(Number(handicap) || 0, course?.holes);
    if (!placed) return; // no usable handicap indexes — the admin ticks holes by hand
    (side === "A" ? setStrokesA : setStrokesB)(placed);
  };

  const handleHandicapChange = (side: CaptainsSide, value: string) => {
    const digits = value.replace(/[^0-9]/g, "").slice(0, 2);
    (side === "A" ? setHandicapA : setHandicapB)(digits);
    placeStrokes(side, digits, selectedCourse);
  };

  const handleCourseChange = (next: string) => {
    setCourseChoice(next);
    const course = courses.find((c) => c.id === next) ?? null;
    placeStrokes("A", handicapA, course);
    placeStrokes("B", handicapB, course);
  };

  const toggleStroke = (side: CaptainsSide, i: number) => {
    const setter = side === "A" ? setStrokesA : setStrokesB;
    setter((prev) => prev.map((s, idx) => (idx === i ? (s === 1 ? 0 : 1) : s)));
  };

  const setScore = (side: CaptainsSide, i: number, value: string) => {
    const setter = side === "A" ? setGrossA : setGrossB;
    // Digits only: a golf score is a whole number, and this keeps "4." or "4.5" out.
    setter((prev) => prev.map((v, idx) => (idx === i ? value.replace(/[^0-9]/g, "").slice(0, 2) : v)));
  };

  const parsedA = grossA.map(parseScore);
  const parsedB = grossB.map(parseScore);
  const invalidHoles = parsedA
    .map((v, i) => (v === "invalid" || parsedB[i] === "invalid" ? i + 1 : 0))
    .filter((hole) => hole > 0);
  const clean = (v: number | null | "invalid") => (v === "invalid" ? null : v);

  const draft: CaptainsMatchRound = {
    roundNumber,
    playedOn: playedOn || null,
    courseId: selectedCourse?.id ?? null,
    courseName: selectedCourse
      ? selectedCourse.name ?? null
      : courseChoice === OTHER_COURSE
        ? courseName.trim() || null
        : null,
    tees: selectedCourse?.tees ?? null,
    grossA: parsedA.map(clean),
    grossB: parsedB.map(clean),
    strokesA,
    strokesB,
  };

  // The whole season with this draft in place of the saved card — cheap enough
  // (20 rounds x 18 holes) to recompute on every keystroke.
  const preview = summarizeCaptainsMatch({
    totalRounds: match.totalRounds,
    rounds: { ...(match.rounds ?? {}), [String(roundNumber)]: draft },
  });
  const previewRound = preview.rounds.find((r) => r.roundNumber === roundNumber) ?? null;

  const blankHoles = draft.grossA
    .map((g, i) => (g === null || draft.grossB[i] === null ? i + 1 : 0))
    .filter((hole) => hole > 0);
  const earlierMissing = Array.from({ length: roundNumber - 1 }, (_, i) => i + 1).filter(
    (n) => !match.rounds?.[String(n)]
  );

  const marginText = (m: number) => (m === 0 ? "All Square" : `${m > 0 ? nameA : nameB} ${Math.abs(m)} UP`);
  const roundLine =
    previewRound && previewRound.thru > 0
      ? `This round: ${nameA} ${previewRound.holesWonA} · ${nameB} ${previewRound.holesWonB} · ${previewRound.halved} halved`
      : "This round: no holes scored yet";
  const matchLine = !previewRound
    ? ""
    : previewRound.postMatch
      ? "The match was already decided before this round"
      : preview.state.kind === "won" && preview.state.roundNumber === roundNumber
        ? formatCaptainsMatchStatus(preview.state, nameA, nameB)
        : `After this round: ${marginText(previewRound.endMargin)}`;

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    if (invalidHoles.length > 0) {
      setError(
        `Fix the score on hole${invalidHoles.length === 1 ? "" : "s"} ${invalidHoles.join(", ")} — scores are whole numbers from 1 to 30.`
      );
      return;
    }
    setSaving(true);
    try {
      await adminApi.saveCaptainsMatchRound({
        tournamentId,
        roundNumber,
        playedOn: draft.playedOn,
        courseId: draft.courseId,
        // The server copies the name from an app course; free text only otherwise.
        courseName: selectedCourse ? null : draft.courseName,
        grossA: draft.grossA,
        grossB: draft.grossB,
        strokesA,
        strokesB,
      });
      onSaved(draft);
      setSuccess(`Round ${roundNumber} saved.`);
    } catch (err) {
      console.error("Save round failed:", err);
      setError(getErrorMessage(err, "Failed to save the round"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    try {
      await adminApi.deleteCaptainsMatchRound({ tournamentId, roundNumber });
      navigate(`/admin/t/${tournamentId}/captains-match`, { replace: true });
    } catch (err) {
      console.error("Delete round failed:", err);
      setError(getErrorMessage(err, "Failed to delete the round"));
      setConfirmDelete(false);
      setDeleting(false);
    }
  };

  const sumRange = (values: (number | null)[], from: number, to: number) => {
    const scored = values.slice(from, to).filter((v): v is number => v !== null);
    return scored.length > 0 ? scored.reduce((sum, v) => sum + v, 0) : "–";
  };

  const headerCell = "truncate text-center text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground";

  const renderScoreInput = (side: CaptainsSide, i: number) => {
    const values = side === "A" ? grossA : grossB;
    const invalid = (side === "A" ? parsedA : parsedB)[i] === "invalid";
    return (
      <input
        type="text"
        inputMode="numeric"
        value={values[i]}
        onChange={(e) => setScore(side, i, e.target.value)}
        aria-label={`Hole ${i + 1} score for ${side === "A" ? nameA : nameB}`}
        aria-invalid={invalid}
        className={cn(inputClass, "px-1 py-1.5 text-center", invalid && "border-destructive")}
      />
    );
  };

  const renderStrokeToggle = (side: CaptainsSide, i: number) => {
    const on = (side === "A" ? strokesA : strokesB)[i] === 1;
    return (
      <button
        type="button"
        onClick={() => toggleStroke(side, i)}
        aria-pressed={on}
        aria-label={`Hole ${i + 1}: ${side === "A" ? nameA : nameB} gets a stroke`}
        className={cn(
          "mx-auto flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
          on ? "border-sky-400 bg-sky-50" : "border-border bg-card hover:bg-muted"
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", on ? "bg-sky-400" : "bg-transparent")} />
      </button>
    );
  };

  const renderResult = (result: CaptainsHoleResult) => {
    if (result === "A" || result === "B") {
      return (
        <span className="text-center text-xs font-bold" style={{ color: result === "A" ? colorA : colorB }}>
          {(result === "A" ? nameA : nameB).charAt(0)}
        </span>
      );
    }
    return <span className="text-center text-xs text-muted-foreground">{result === "halved" ? "½" : ""}</span>;
  };

  const renderSubtotal = (label: string, from: number, to: number) => (
    <Fragment key={label}>
      <div className="col-span-3 pt-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="pt-1 text-center text-sm font-bold text-foreground">{sumRange(draft.grossA, from, to)}</div>
      <div />
      <div className="pt-1 text-center text-sm font-bold text-foreground">{sumRange(draft.grossB, from, to)}</div>
      <div />
      <div />
    </Fragment>
  );

  return (
    <AdminPage
      headerTitle={`${tournament.year} ${tournament.name}`}
      breadcrumbs={breadcrumbs}
      eyebrow={match.name}
      title={`Round ${roundNumber}`}
      description={`Enter the card as it was played: both gross scores on every hole, plus each player's handicap strokes. Lower net score wins the hole${
        roundNumber < match.totalRounds ? `, and the margin carries into round ${roundNumber + 1}` : ""
      }.`}
      badges={existing ? <Badge variant="success">saved</Badge> : <Badge variant="muted">new card</Badge>}
      error={error}
      success={success}
      actions={
        existing ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/captains-match/${tournamentId}/round/${roundNumber}`}>
              <ExternalLink className="h-4 w-4" />
              View
            </Link>
          </Button>
        ) : null
      }
    >
      {earlierMissing.length > 0 && (
        <InfoNote tone="warning">
          Round{earlierMissing.length === 1 ? "" : "s"} {formatRoundRanges(earlierMissing)}{" "}
          {earlierMissing.length === 1 ? "hasn't" : "haven't"} been entered. Rounds count in order, so this card's
          running score will shift once {earlierMissing.length === 1 ? "it is" : "they are"}.
        </InfoNote>
      )}

      <AdminSection title="Round details">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" optional>
            <input
              type="date"
              value={playedOn}
              onChange={(e) => setPlayedOn(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Course" optional>
            <select value={courseChoice} onChange={(e) => handleCourseChange(e.target.value)} className={inputClass}>
              <option value="">No course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id}
                  {c.tees ? ` (${c.tees})` : ""}
                </option>
              ))}
              <option value={OTHER_COURSE}>Other — type the name</option>
            </select>
          </Field>
          {courseChoice === OTHER_COURSE && (
            <Field label="Course name" className="col-span-2" hint="Add the course under Admin → Courses to get par and handicap indexes on the card.">
              <input
                type="text"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                maxLength={60}
                placeholder="e.g. Hawks Landing"
                className={inputClass}
              />
            </Field>
          )}
        </div>
      </AdminSection>

      <AdminSection
        title="Handicap strokes"
        description="Full handicaps: each player gets strokes off their own course handicap for the day — no spin-down to the lower player. They land on the course's hardest holes; tap a dot in the card below to change any hole by hand."
      >
        <div className="grid grid-cols-2 gap-3">
          {(["A", "B"] as const).map((side) => (
            <Field
              key={side}
              label={`${side === "A" ? nameA : nameB}'s strokes`}
              hint="Course handicap for the day"
            >
              <input
                type="text"
                inputMode="numeric"
                value={side === "A" ? handicapA : handicapB}
                onChange={(e) => handleHandicapChange(side, e.target.value)}
                placeholder="0"
                aria-label={`${side === "A" ? nameA : nameB}'s course handicap`}
                className={inputClass}
              />
            </Field>
          ))}
        </div>
        {!canPlaceStrokes && (Number(handicapA) > 0 || Number(handicapB) > 0) && (
          <InfoNote className="mt-3">
            {selectedCourse ? "This course has no handicap indexes" : "Without an app course there are no handicap indexes"}{" "}
            — tap the stroke dots in the card to mark the holes by hand.
          </InfoNote>
        )}
        <InfoNote className="mt-3">
          Strokes on this card: {nameA} {countStrokes(strokesA)} · {nameB} {countStrokes(strokesB)}
        </InfoNote>
      </AdminSection>

      <AdminSection title="Scorecard" description="Gross scores. A hole counts once both scores are in.">
        <div className="grid grid-cols-[1.25rem_1.75rem_1.75rem_minmax(0,1fr)_1.75rem_minmax(0,1fr)_1.75rem_1.25rem] items-center gap-x-1.5 gap-y-1">
          <div className={headerCell}>#</div>
          <div className={headerCell}>Par</div>
          <div className={headerCell}>Hcp</div>
          <div className={headerCell} style={{ color: colorA }}>{nameA}</div>
          <div className={headerCell} title="Stroke">●</div>
          <div className={headerCell} style={{ color: colorB }}>{nameB}</div>
          <div className={headerCell} title="Stroke">●</div>
          <div className={headerCell} title="Hole winner">W</div>

          {Array.from({ length: HOLES_PER_ROUND }, (_, i) => (
            <Fragment key={i}>
              {i === 9 && renderSubtotal("Out", 0, 9)}
              <div className="text-sm font-semibold text-muted-foreground">{i + 1}</div>
              <div className="text-center text-xs text-muted-foreground">{holeInfo.get(i + 1)?.par ?? "–"}</div>
              <div className="text-center text-xs text-muted-foreground">{holeInfo.get(i + 1)?.hcpIndex || "–"}</div>
              {renderScoreInput("A", i)}
              {renderStrokeToggle("A", i)}
              {renderScoreInput("B", i)}
              {renderStrokeToggle("B", i)}
              {renderResult(previewRound?.holeResults[i] ?? null)}
            </Fragment>
          ))}
          {renderSubtotal("In", 9, 18)}
          {renderSubtotal("Total", 0, 18)}
        </div>
      </AdminSection>

      <AdminSection title="Result">
        <div className="space-y-1 text-sm">
          <div className="text-muted-foreground">{roundLine}</div>
          <div className="font-semibold text-foreground">{matchLine}</div>
          <div className="text-xs text-muted-foreground">
            Match: {formatCaptainsMatchStatus(preview.state, nameA, nameB)}
          </div>
        </div>
        {blankHoles.length > 0 && blankHoles.length < HOLES_PER_ROUND && (
          <InfoNote className="mt-3">
            {blankHoles.length} hole{blankHoles.length === 1 ? " is" : "s are"} blank ({blankHoles.join(", ")}) and
            won't count until both scores are in.
          </InfoNote>
        )}
      </AdminSection>

      {existing && (
        <DangerZone
          title="Delete round"
          description="Removes this round's card. Later rounds' running scores are recalculated without it."
          actionLabel={`Delete round ${roundNumber}`}
          onAction={() => setConfirmDelete(true)}
          disabled={deleting}
        />
      )}

      <SaveBar status={matchLine || roundLine}>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : existing ? "Save round" : "Add round"}
        </Button>
      </SaveBar>

      <ConfirmDialog
        isOpen={confirmDelete}
        title={`Delete round ${roundNumber}?`}
        confirmLabel="Delete round"
        danger
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      >
        This permanently deletes round {roundNumber}'s card.
      </ConfirmDialog>
    </AdminPage>
  );
}
