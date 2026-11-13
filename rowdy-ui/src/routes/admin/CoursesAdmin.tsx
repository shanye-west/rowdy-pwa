import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Flag, Plus } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import AdminPage from "../../components/admin/AdminPage";
import AdminSection from "../../components/admin/AdminSection";
import NavRow, { EmptyRow } from "../../components/admin/NavRow";
import SearchInput from "../../components/admin/SearchInput";
import { Button } from "../../components/ui/button";
import { getErrorMessage } from "../../api/errors";
import type { CourseDoc } from "../../types";

/** Course list — open one to edit, or create a new one. */
export default function CoursesAdmin() {
  const [courses, setCourses] = useState<CourseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getDocs(collection(db, "courses"))
      .then((snap) =>
        setCourses(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as CourseDoc))
            .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
        )
      )
      .catch((err) => setError(getErrorMessage(err, "Failed to load courses")))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) => (c.name ?? "").toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    );
  }, [courses, search]);

  return (
    <AdminPage
      title="Courses"
      breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Courses" }]}
      description="Hole pars, handicap indexes, and yardages — the inputs for stroke calculations and skins."
      error={error}
      loading={loading}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/courses/new">
            <Plus className="h-4 w-4" />
            New course
          </Link>
        </Button>
      }
    >
      <AdminSection title={`Courses (${courses.length})`}>
        {courses.length > 6 && (
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search courses"
            label="Search courses"
            className="mb-3"
          />
        )}

        <div className="space-y-2">
          {visible.map((c) => (
            <NavRow
              key={c.id}
              to={`/admin/courses/${c.id}`}
              leading={<Flag className="h-5 w-5 text-muted-foreground" />}
              title={c.name || c.id}
              subtitle={`${c.tees ? `${c.tees} tees · ` : ""}par ${c.par ?? "?"} · rating ${c.rating ?? "?"} · slope ${c.slope ?? "?"}`}
            />
          ))}
          {visible.length === 0 && (
            <EmptyRow>{courses.length === 0 ? "No courses yet." : "No courses match that search."}</EmptyRow>
          )}
        </div>
      </AdminSection>
    </AdminPage>
  );
}
