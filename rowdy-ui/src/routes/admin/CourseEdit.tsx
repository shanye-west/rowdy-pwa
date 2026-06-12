import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import Layout from "../../components/Layout";
import StatusBanner from "../../components/admin/StatusBanner";
import AdminSection from "../../components/admin/AdminSection";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
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
 * unique hcpIndex 1-18, par 3-6, totals); we surface its messages directly.
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

  if (loading) {
    return (
      <Layout title="Course" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout title={isNew ? "New Course" : name || courseId} showBack>
      <div className="p-4 max-w-2xl mx-auto space-y-4">
        <StatusBanner error={error} success={success} />

        <form onSubmit={handleSubmit} className="space-y-4">
          <AdminSection
            title="Course Details"
            description="Saving rewrites the whole course. Existing matches keep their seeded strokes — use Recalculate Strokes on a match to apply course changes."
          >
            <div className="grid grid-cols-2 gap-3">
              {isNew && (
                <div className="col-span-2">
                  <label className="block text-sm font-semibold mb-1">
                    Course ID <span className="font-normal text-gray-500">(optional, auto-generated if blank)</span>
                  </label>
                  <input
                    type="text"
                    value={newCourseId}
                    onChange={(e) => setNewCourseId(e.target.value)}
                    placeholder="e.g. chambers-bay"
                    className="w-full p-2 border border-gray-300 rounded-lg font-mono text-sm"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Tees</label>
                <input
                  type="text"
                  value={tees}
                  onChange={(e) => setTees(e.target.value)}
                  placeholder="e.g. Blue"
                  className="w-full p-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Rating</label>
                <input
                  type="number"
                  step="0.1"
                  min="50"
                  max="90"
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Slope</label>
                <input
                  type="number"
                  min="55"
                  max="155"
                  value={slope}
                  onChange={(e) => setSlope(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
            </div>
            <div className="mt-3 text-sm text-gray-600">
              Par (sum of holes): <span className="font-semibold">{parTotal}</span>
            </div>
          </AdminSection>

          <AdminSection
            title="Holes"
            description="Handicap index ranks hole difficulty: 1 = hardest, 18 = easiest. Each value 1-18 must be used exactly once."
          >
            <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 items-center text-sm">
              <div className="font-semibold text-xs text-gray-500">#</div>
              <div className="font-semibold text-xs text-gray-500">Par</div>
              <div className="font-semibold text-xs text-gray-500">Hcp Index</div>
              <div className="font-semibold text-xs text-gray-500">Yards</div>
              {holes.map((h, i) => (
                <HoleRowInputs key={i} index={i} row={h} onChange={updateHole} />
              ))}
            </div>
          </AdminSection>

          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {busy ? "Saving..." : isNew ? "Create Course" : "Save Course"}
          </button>
        </form>

        {!isNew && (
          <AdminSection
            title="Delete Course"
            description="Blocked while any round references this course."
            danger
          >
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="btn bg-red-600 text-white"
            >
              Delete Course
            </button>
          </AdminSection>
        )}

        <Link to="/admin/courses" className="btn btn-secondary block text-center">Back to Courses</Link>

        <ConfirmDialog
          isOpen={confirmDelete}
          title="Delete course?"
          confirmLabel="Delete Course"
          danger
          busy={busy}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        >
          Permanently deletes <strong>{name || courseId}</strong>. The server refuses if any round
          still references it.
        </ConfirmDialog>
      </div>
    </Layout>
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
  return (
    <>
      <div className="font-semibold">{index + 1}</div>
      <input
        type="number"
        min="3"
        max="6"
        value={row.par}
        onChange={(e) => onChange(index, { par: e.target.value })}
        className="p-2 border border-gray-300 rounded-lg"
        required
      />
      <input
        type="number"
        min="1"
        max="18"
        value={row.hcpIndex}
        onChange={(e) => onChange(index, { hcpIndex: e.target.value })}
        className="p-2 border border-gray-300 rounded-lg"
        required
      />
      <input
        type="number"
        min="0"
        value={row.yards}
        onChange={(e) => onChange(index, { yards: e.target.value })}
        placeholder="—"
        className="p-2 border border-gray-300 rounded-lg"
      />
    </>
  );
}
