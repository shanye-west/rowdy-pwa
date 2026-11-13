import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import AdminPage from "../../components/admin/AdminPage";
import AdminSection from "../../components/admin/AdminSection";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import DangerZone from "../../components/admin/DangerZone";
import { Field, InfoNote } from "../../components/admin/fields";
import { inputClass, monoInputClass } from "../../components/admin/inputStyles";
import { Button } from "../../components/ui/button";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
import { cn } from "../../lib/utils";
import type { CourseDoc } from "../../types";

interface HoleRow {
  par: string;
  hcpIndex: string;
  yards: string;
}

const blankHoles = (): HoleRow[] =>
  Array.from({ length: 18 }, () => ({ par: "4", hcpIndex: "", yards: "" }));

/**
 * Create or edit a course: name/tees/rating/slope plus the 18-hole grid.
 * Server-side upsertCourse enforces the full invariants (unique hole numbers,
 * unique hcpIndex 1-18, par 3-6, totals); the handicap-index check below is a
 * client-side preview of the same rule so you catch it before submitting.
 */
export default function CourseEdit() {
  const navigate = useNavigate();
  const { courseId = "" } = useParams<{ courseId: string }>();
  const isNew = courseId === "new";

  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [newCourseId, setNewCourseId] = useState("");
  const [name, setName] = useState("");
  const [tees, setTees] = useState("");
  const [rating, setRating] = useState("");
  const [slope, setSlope] = useState("");
  const [holes, setHoles] = useState<HoleRow[]>(blankHoles());

  useEffect(() => {
    if (isNew) return;
    getDoc(doc(db, "courses", courseId))
      .then((snap) => {
        if (!snap.exists()) {
          setError("Course not found");
          return;
        }
        const c = { id: snap.id, ...snap.data() } as CourseDoc;
        setName(c.name ?? "");
        setTees(c.tees ?? "");
        setRating(c.rating != null ? String(c.rating) : "");
        setSlope(c.slope != null ? String(c.slope) : "");
        const rows = blankHoles();
        (c.holes ?? []).forEach((h) => {
          if (h.number >= 1 && h.number <= 18) {
            rows[h.number - 1] = {
              par: String(h.par ?? 4),
              hcpIndex: h.hcpIndex ? String(h.hcpIndex) : "",
              yards: h.yards != null ? String(h.yards) : "",
            };
          }
        });
        setHoles(rows);
      })
      .catch((err) => setError(getErrorMessage(err, "Failed to load course")))
      .finally(() => setLoading(false));
  }, [courseId, isNew]);

  const parTotal = useMemo(
    () => holes.reduce((sum, h) => sum + (Number(h.par) || 0), 0),
    [holes]
  );

  const yardsTotal = useMemo(
    () => holes.reduce((sum, h) => sum + (Number(h.yards) || 0), 0),
    [holes]
  );

  /** Handicap indexes must use each of 1-18 exactly once — flag it early. */
  const hcpProblem = useMemo(() => {
    const used = holes.map((h) => Number(h.hcpIndex)).filter((n) => Number.isFinite(n) && n > 0);
    const dupes = used.filter((n, i) => used.indexOf(n) !== i);
    if (dupes.length > 0) return `Handicap index repeated: ${[...new Set(dupes)].sort((a, b) => a - b).join(", ")}`;
    const missing = Array.from({ length: 18 }, (_, i) => i + 1).filter((n) => !used.includes(n));
    if (missing.length > 0) return `Handicap index missing: ${missing.join(", ")}`;
    return null;
  }, [holes]);

  const updateHole = (idx: number, patch: Partial<HoleRow>) => {
    setHoles((prev) => prev.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await adminApi.upsertCourse({
        ...(isNew
          ? (newCourseId.trim() ? { courseId: newCourseId.trim() } : {})
          : { courseId }),
        name: name.trim(),
        ...(tees.trim() ? { tees: tees.trim() } : {}),
        par: parTotal,
        rating: Number(rating),
        slope: Number(slope),
        holes: holes.map((h, i) => ({
          number: i + 1,
          par: Number(h.par),
          hcpIndex: Number(h.hcpIndex),
          ...(h.yards !== "" ? { yards: Number(h.yards) } : {}),
        })),
      });
      if (isNew) {
        navigate(`/admin/courses/${res.courseId}`, { replace: true });
      } else {
        setSuccess("Course saved.");
      }
    } catch (err) {
      console.error("Save course failed:", err);
      setError(getErrorMessage(err, "Failed to save course"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setError(null);
    setBusy(true);
    try {
      await adminApi.deleteCourse({ courseId });
      navigate("/admin/courses", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to delete course"));
      setConfirmDelete(false);
      setBusy(false);
    }
  };

  const breadcrumbs = [
    { label: "Admin", to: "/admin" },
    { label: "Courses", to: "/admin/courses" },
    { label: isNew ? "New course" : name || courseId },
  ];

  return (
    <AdminPage
      title={isNew ? "New course" : name || courseId}
      breadcrumbs={breadcrumbs}
      description={
        isNew
          ? "Pars and handicap indexes drive stroke allocation and skins, so get them right before a round points here."
          : "Saving rewrites the whole course. Existing matches keep their seeded strokes — use Recalculate strokes on a match to apply changes."
      }
      error={error}
      success={success}
      loading={loading}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AdminSection title="Course details">
          <div className="grid grid-cols-2 gap-3">
            {isNew && (
              <Field label="Course ID" optional hint="Auto-generated when blank." className="col-span-2">
                <input
                  type="text"
                  value={newCourseId}
                  onChange={(e) => setNewCourseId(e.target.value)}
                  placeholder="e.g. chambers-bay"
                  className={monoInputClass}
                />
              </Field>
            )}
            <Field label="Name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field label="Tees">
              <input
                type="text"
                value={tees}
                onChange={(e) => setTees(e.target.value)}
                placeholder="e.g. Blue"
                className={inputClass}
              />
            </Field>
            <Field label="Rating">
              <input
                type="number"
                step="0.1"
                min="50"
                max="90"
                value={rating}
                onChange={(e) => setRating(e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field label="Slope">
              <input
                type="number"
                min="55"
                max="155"
                value={slope}
                onChange={(e) => setSlope(e.target.value)}
                className={inputClass}
                required
              />
            </Field>
          </div>
          <InfoNote className="mt-3">
            Par <span className="font-semibold text-foreground">{parTotal}</span>
            {yardsTotal > 0 && (
              <> · <span className="font-semibold text-foreground">{yardsTotal.toLocaleString()}</span> yards</>
            )}{" "}
            — totalled from the holes below.
          </InfoNote>
        </AdminSection>

        <AdminSection
          title="Holes"
          description="Handicap index ranks hole difficulty: 1 = hardest, 18 = easiest. Each value 1-18 must be used exactly once."
        >
          {hcpProblem && (
            <InfoNote tone="warning" className="mb-3">
              {hcpProblem}
            </InfoNote>
          )}
          <div className="grid grid-cols-[1.75rem_1fr_1fr_1fr] items-center gap-2">
            <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">#</div>
            <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Par</div>
            <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Hcp</div>
            <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Yards</div>
            {holes.map((h, i) => (
              <HoleRowInputs key={i} index={i} row={h} onChange={updateHole} />
            ))}
          </div>
        </AdminSection>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Saving…" : isNew ? "Create course" : "Save course"}
        </Button>
      </form>

      {!isNew && (
        <DangerZone
          title="Delete course"
          description="Blocked while any round still references this course."
          actionLabel="Delete course"
          onAction={() => setConfirmDelete(true)}
          disabled={busy}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Delete course?"
        confirmLabel="Delete course"
        danger
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      >
        Permanently deletes <strong>{name || courseId}</strong>. The server refuses if any round
        still references it.
      </ConfirmDialog>
    </AdminPage>
  );
}

function HoleRowInputs({
  index,
  row,
  onChange,
}: {
  index: number;
  row: HoleRow;
  onChange: (idx: number, patch: Partial<HoleRow>) => void;
}) {
  const cell = cn(inputClass, "px-2 py-1.5 text-center");
  return (
    <>
      <div className="text-sm font-semibold text-muted-foreground">{index + 1}</div>
      <input
        type="number"
        min="3"
        max="6"
        value={row.par}
        onChange={(e) => onChange(index, { par: e.target.value })}
        className={cell}
        aria-label={`Hole ${index + 1} par`}
        required
      />
      <input
        type="number"
        min="1"
        max="18"
        value={row.hcpIndex}
        onChange={(e) => onChange(index, { hcpIndex: e.target.value })}
        className={cell}
        aria-label={`Hole ${index + 1} handicap index`}
        required
      />
      <input
        type="number"
        min="0"
        value={row.yards}
        onChange={(e) => onChange(index, { yards: e.target.value })}
        placeholder="—"
        className={cell}
        aria-label={`Hole ${index + 1} yards`}
      />
    </>
  );
}
