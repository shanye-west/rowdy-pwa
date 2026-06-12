import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "../../components/Layout";
import StatusBanner from "../../components/admin/StatusBanner";
import AdminSection from "../../components/admin/AdminSection";
import { useAdminTournaments } from "../../hooks/admin/useAdminTournaments";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";

/**
 * Admin home: pick a tournament to manage (everything tournament-scoped lives
 * under /admin/t/:id), create a new one, or jump to the global areas.
 */
export default function AdminDashboard() {
  const navigate = useNavigate();
  const [includeArchived, setIncludeArchived] = useState(false);
  const { tournaments, loading, error: loadError, refresh } = useAdminTournaments({ includeArchived });

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()));
  const [newSeries, setNewSeries] = useState("rowdyCup");
  const [newTest, setNewTest] = useState(false);

  const activeTournament = tournaments.find((t) => t.active);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await adminApi.createTournament({
        ...(newId.trim() ? { id: newId.trim() } : {}),
        name: newName.trim(),
        year: Number(newYear),
        series: newSeries.trim(),
        test: newTest,
      });
      await refresh();
      navigate(`/admin/t/${res.tournamentId}`);
    } catch (err) {
      console.error("Error creating tournament:", err);
      setError(getErrorMessage(err, "Failed to create tournament"));
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <Layout title="Admin" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout title="Admin Dashboard" showBack>
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <StatusBanner error={error ?? loadError} />

        <AdminSection
          title="Tournaments"
          description="Pick a tournament to manage its settings, rounds, and matches."
        >
          {activeTournament && (
            <Link
              to={`/admin/t/${activeTournament.id}`}
              className="block p-4 mb-3 border-2 border-green-300 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg">{activeTournament.name}</div>
                  <div className="text-sm text-gray-600">Active tournament — jump straight in</div>
                </div>
                <div className="text-2xl">→</div>
              </div>
            </Link>
          )}

          <div className="space-y-2">
            {tournaments.map((t) => (
              <Link
                key={t.id}
                to={`/admin/t/${t.id}`}
                className="block p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{t.year} {t.name}</div>
                    <div className="text-sm text-gray-600">{t.series}</div>
                  </div>
                  <div className="flex gap-1 text-xs items-center">
                    {t.active && <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">active</span>}
                    {t.test && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">test</span>}
                    {t.archived && <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">archived</span>}
                    <span className="text-xl ml-1">→</span>
                  </div>
                </div>
              </Link>
            ))}
            {tournaments.length === 0 && (
              <div className="text-sm text-gray-500">No tournaments found.</div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm mt-4 text-gray-600">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Show archived tournaments
          </label>

          <div className="mt-4 border-t border-gray-200 pt-4">
            {!showCreate ? (
              <button type="button" onClick={() => setShowCreate(true)} className="text-sm text-blue-600 hover:underline">
                + Create new tournament
              </button>
            ) : (
              <form onSubmit={handleCreate} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Name (e.g. Rowdy Cup 2026)"
                    className="p-2 border border-gray-300 rounded-lg"
                    required
                  />
                  <input
                    type="number"
                    value={newYear}
                    onChange={(e) => setNewYear(e.target.value)}
                    placeholder="Year"
                    className="p-2 border border-gray-300 rounded-lg"
                    required
                  />
                  <input
                    type="text"
                    value={newSeries}
                    onChange={(e) => setNewSeries(e.target.value)}
                    placeholder="Series (e.g. rowdyCup)"
                    className="p-2 border border-gray-300 rounded-lg"
                    required
                  />
                  <input
                    type="text"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    placeholder="ID (optional)"
                    className="p-2 border border-gray-300 rounded-lg font-mono text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={newTest} onChange={(e) => setNewTest(e.target.checked)} />
                  <span className="font-semibold">Test tournament</span>
                  <span className="text-gray-500">(only visible to admins)</span>
                </label>
                <div className="text-xs text-gray-500">
                  Created inactive — set rosters and rounds first, then flip Active in Settings.
                </div>
                <div className="flex gap-3">
                  <button type="submit" disabled={creating} className="btn btn-primary flex-1">
                    {creating ? "Creating..." : "Create Tournament"}
                  </button>
                  <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </AdminSection>

        <AdminSection title="Global" description="Areas that span all tournaments.">
          <div className="space-y-3">
            <Link to="/admin/players" className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg">Players</div>
                  <div className="text-sm text-gray-600">Add, rename, link logins, admin access, delete</div>
                </div>
                <div className="text-2xl">→</div>
              </div>
            </Link>
            <Link to="/admin/courses" className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg">Courses</div>
                  <div className="text-sm text-gray-600">Create and edit courses (pars, handicaps, yardages)</div>
                </div>
                <div className="text-2xl">→</div>
              </div>
            </Link>
            <Link
              to="/admin/recalculate"
              className="block p-4 border-2 border-red-300 rounded-lg hover:bg-red-50 transition-colors bg-red-50"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg flex items-center gap-2">
                    <span>🔥</span>
                    <span>Recalculate All Stats (Global)</span>
                  </div>
                  <div className="text-sm text-gray-600">Regenerate all playerMatchFacts and stats across ALL tournaments</div>
                </div>
                <div className="text-2xl">→</div>
              </div>
            </Link>
          </div>
        </AdminSection>
      </div>
    </Layout>
  );
}
