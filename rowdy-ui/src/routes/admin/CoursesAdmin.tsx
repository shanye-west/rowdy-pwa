import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import Layout from "../../components/Layout";
import StatusBanner from "../../components/admin/StatusBanner";
import AdminSection from "../../components/admin/AdminSection";
import { getErrorMessage } from "../../api/errors";
import type { CourseDoc } from "../../types";

/** Course list — open one to edit, or create a new one. */
export default function CoursesAdmin() {
  const [courses, setCourses] = useState<CourseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <Layout title="Courses" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout title="Courses" showBack>
      <div className="p-4 max-w-2xl mx-auto space-y-4">
        <StatusBanner error={error} />

        <AdminSection
          title="Courses"
          description="Hole pars, handicap indexes, and yardages used for stroke calculations and skins."
        >
          <div className="space-y-2">
            {courses.map((c) => (
              <Link
                key={c.id}
                to={`/admin/courses/${c.id}`}
                className="block p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{c.name || c.id}</div>
                    <div className="text-sm text-gray-600">
                      {c.tees ? `${c.tees} tees · ` : ""}Par {c.par ?? "?"} · Rating {c.rating ?? "?"} · Slope {c.slope ?? "?"}
                    </div>
                  </div>
                  <div className="text-2xl">→</div>
                </div>
              </Link>
            ))}
            {courses.length === 0 && <div className="text-sm text-gray-500">No courses yet.</div>}
          </div>

          <Link to="/admin/courses/new" className="inline-block mt-4 text-sm text-blue-600 hover:underline">
            + Create new course
          </Link>
        </AdminSection>
      </div>
    </Layout>
  );
}
