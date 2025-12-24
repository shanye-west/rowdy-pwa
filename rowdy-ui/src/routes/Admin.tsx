import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc } from "../types";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";

export default function Admin() {
  const { player } = useAuth();
  const [testTournaments, setTestTournaments] = useState<TournamentDoc[]>([]);

  useEffect(() => {
    let mounted = true;
    const fetchTestTournaments = async () => {
      try {
        const q = query(collection(db, "tournaments"), where("test", "==", true));
        const snap = await getDocs(q);
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as TournamentDoc));
        if (mounted) setTestTournaments(docs);
      } catch (err) {
        console.error("Failed to fetch test tournaments:", err);
      }
    };
    fetchTestTournaments();
    return () => { mounted = false; };
  }, []);

  // Access control: only admins can view this page
  if (!player?.isAdmin) {
    return (
      <Layout title="Admin" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <div className="empty-state-text">Access Denied</div>
          <div className="text-sm text-gray-500 mt-2">Admin access required</div>
          <Link to="/" className="btn btn-primary mt-4">Go Home</Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Admin Dashboard" showBack>
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <div className="card p-6">
          <h2 className="text-xl font-bold mb-4">Data Management</h2>
          <p className="text-sm text-gray-600 mb-6">
            Create new documents in the database
          </p>
          
          <div className="space-y-3">
            {/* Add Match */}
            <Link 
              to="/admin/match" 
              className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg">Add Match</div>
                  <div className="text-sm text-gray-600">Create a new match with players and tee time</div>
                </div>
                <div className="text-2xl">→</div>
              </div>
            </Link>

            {/* Edit Match */}
            <Link 
              to="/admin/match/edit" 
              className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg">Edit Match</div>
                  <div className="text-sm text-gray-600">Modify existing match details and players</div>
                </div>
                <div className="text-2xl">→</div>
              </div>
            </Link>

            {/* Recalculate Match Strokes */}
            <Link 
              to="/admin/match/recalculate" 
              className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg">Recalculate Match Strokes</div>
                  <div className="text-sm text-gray-600">Recalculate strokesReceived using current tournament handicap indexes</div>
                </div>
                <div className="text-2xl">→</div>
              </div>
            </Link>

            {/* Recalculate Tournament Stats */}
            <Link 
              to="/admin/tournament/recalculate" 
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

            {/* Future: Add Tournament */}
            <div 
              className="block p-4 border border-gray-200 rounded-lg bg-gray-50 opacity-50 cursor-not-allowed"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg text-gray-500">Add Tournament</div>
                  <div className="text-sm text-gray-400">Coming soon</div>
                </div>
              </div>
            </div>

            {/* Future: Add Round */}
            <div 
              className="block p-4 border border-gray-200 rounded-lg bg-gray-50 opacity-50 cursor-not-allowed"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg text-gray-500">Add Round</div>
                  <div className="text-sm text-gray-400">Coming soon</div>
                </div>
              </div>
            </div>

            {/* Future: Add Player */}
            <div 
              className="block p-4 border border-gray-200 rounded-lg bg-gray-50 opacity-50 cursor-not-allowed"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg text-gray-500">Add Player</div>
                  <div className="text-sm text-gray-400">Coming soon</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Test tournaments (admin-only links) */}
        <div className="card p-6">
          <h2 className="text-xl font-bold mb-4">Test Tournaments</h2>
          <p className="text-sm text-gray-600 mb-6">Quick links to tournaments flagged for testing.</p>
          <div className="space-y-2">
            {testTournaments.length === 0 ? (
              <div className="text-sm text-gray-500">No test tournaments found.</div>
            ) : (
              testTournaments.map(t => (
                <Link
                  key={t.id}
                  to={`/tournament/${t.id}`}
                  className="block p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{t.name || t.id}</div>
                      <div className="text-sm text-gray-600">{t.year || ""} — {t.series}</div>
                    </div>
                    <div className="text-2xl">→</div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
