import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, getDocs, query, where, documentId } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";
import type { TournamentDoc, RoundDoc, PlayerDoc } from "../types";

type PlayerInput = {
  playerId: string;
};

export default function AddMatch() {
  const { player } = useAuth();
  const navigate = useNavigate();

  // State - must declare all hooks before any conditional returns
  const [tournaments, setTournaments] = useState<TournamentDoc[]>([]);
  const [rounds, setRounds] = useState<RoundDoc[]>([]);
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form fields
  const [tournamentId, setTournamentId] = useState("");
  const [roundId, setRoundId] = useState("");
  const [matchId, setMatchId] = useState("");
  const [teeTime, setTeeTime] = useState("");
  const [teamAPlayers, setTeamAPlayers] = useState<PlayerInput[]>([{ playerId: "" }]);
  const [teamBPlayers, setTeamBPlayers] = useState<PlayerInput[]>([{ playerId: "" }]);

  // Fetch tournaments on mount (players fetched when tournament selected)
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch active tournaments and test tournaments, then merge (dedupe)
        const activeSnap = await getDocs(query(collection(db, "tournaments"), where("active", "==", true)));
        const testSnap = await getDocs(query(collection(db, "tournaments"), where("test", "==", true)));
        const combinedDocs = [...activeSnap.docs, ...testSnap.docs];
        const map = new Map<string, TournamentDoc>();
        combinedDocs.forEach(d => map.set(d.id, ({ id: d.id, ...d.data() } as TournamentDoc)));
        const tournamentsData = Array.from(map.values());
        setTournaments(tournamentsData);

        setLoading(false);
      } catch (err) {
        console.error("Error fetching data:", err);
        setError("Failed to load data");
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Get selected tournament data
  const selectedTournament = useMemo(() => 
    tournaments.find(t => t.id === tournamentId), 
    [tournaments, tournamentId]
  );

  // Fetch players ONLY for the selected tournament's roster (reduces reads from 100+ to ~24)
  useEffect(() => {
    if (!selectedTournament) {
      setPlayers([]);
      return;
    }
    
    // Extract all player IDs from both teams' rosters
    const teamARoster = selectedTournament.teamA?.rosterByTier || {};
    const teamBRoster = selectedTournament.teamB?.rosterByTier || {};
    const allIds = [
      ...(teamARoster.A || []), ...(teamARoster.B || []), ...(teamARoster.C || []), ...(teamARoster.D || []),
      ...(teamBRoster.A || []), ...(teamBRoster.B || []), ...(teamBRoster.C || []), ...(teamBRoster.D || []),
    ];
    
    if (allIds.length === 0) {
      setPlayers([]);
      return;
    }
    
    // Batch fetch only roster players (limit 30 per 'in' query)
    const fetchRosterPlayers = async () => {
      try {
        const batches: string[][] = [];
        for (let i = 0; i < allIds.length; i += 30) {
          batches.push(allIds.slice(i, i + 30));
        }
        
        const allPlayers: PlayerDoc[] = [];
        await Promise.all(batches.map(async (batch) => {
          const snap = await getDocs(query(collection(db, "players"), where(documentId(), "in", batch)));
          snap.docs.forEach(d => {
            allPlayers.push({ id: d.id, ...d.data() } as PlayerDoc);
          });
        }));
        
        setPlayers(allPlayers);
      } catch (err) {
        console.error("Error fetching roster players:", err);
      }
    };
    
    fetchRosterPlayers();
  }, [selectedTournament]);

  // Fetch rounds when tournament changes
  useEffect(() => {
    if (!tournamentId) {
      setRounds([]);
      setRoundId("");
      return;
    }

    const fetchRounds = async () => {
      try {
        const roundsSnap = await getDocs(query(collection(db, "rounds"), where("tournamentId", "==", tournamentId)));
        const roundsData = roundsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RoundDoc));
        setRounds(roundsData.sort((a, b) => (a.day || 0) - (b.day || 0)));
      } catch (err) {
        console.error("Error fetching rounds:", err);
        setError("Failed to load rounds");
      }
    };

    fetchRounds();
  }, [tournamentId]);

  // Get available players for each team
  const teamAAvailablePlayers = useMemo(() => {
    if (!selectedTournament) return [];
    const rosterByTier = selectedTournament.teamA?.rosterByTier || {};
    const allIds = [...(rosterByTier.A || []), ...(rosterByTier.B || []), ...(rosterByTier.C || []), ...(rosterByTier.D || [])];
    return players.filter(p => allIds.includes(p.id));
  }, [selectedTournament, players]);

  const teamBAvailablePlayers = useMemo(() => {
    if (!selectedTournament) return [];
    const rosterByTier = selectedTournament.teamB?.rosterByTier || {};
    const allIds = [...(rosterByTier.A || []), ...(rosterByTier.B || []), ...(rosterByTier.C || []), ...(rosterByTier.D || [])];
    return players.filter(p => allIds.includes(p.id));
  }, [selectedTournament, players]);

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // Validate
      if (!tournamentId || !roundId || !matchId) {
        throw new Error("All fields are required");
      }

      // Validate players
      const validTeamA = teamAPlayers.filter(p => p.playerId);
      const validTeamB = teamBPlayers.filter(p => p.playerId);

      if (validTeamA.length === 0 || validTeamB.length === 0) {
        throw new Error("Each team must have at least one player");
      }

      // Call Cloud Function
      const seedMatchFn = httpsCallable(functions, "seedMatch");
      const payload: any = {
        id: matchId,
        tournamentId,
        roundId,
        teamAPlayers: validTeamA,
        teamBPlayers: validTeamB,
      };
      // Treat datetime-local input as Pacific Time (UTC-8)
      if (teeTime) {
        // Append timezone offset to force Pacific Time interpretation
        const pacificDate = new Date(teeTime + '-08:00');
        payload.teeTime = pacificDate.toISOString();
      }

      const result = await seedMatchFn(payload);

      console.log("Match created:", result.data);
      setSuccess(true);

      // Navigate to match after short delay
      setTimeout(() => {
        navigate(`/match/${matchId}`);
      }, 1500);

    } catch (err: any) {
      console.error("Error creating match:", err);
      setError(err.message || "Failed to create match");
      setSubmitting(false);
    }
  };

  // Access control - check after all hooks are declared
  if (!player?.isAdmin) {
    return (
      <Layout title="Add Match" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <div className="empty-state-text">Access Denied</div>
          <div className="text-sm text-gray-500 mt-2">Admin access required</div>
          <Link to="/" className="btn btn-primary mt-4">Go Home</Link>
        </div>
      </Layout>
    );
  }

  if (loading) {
    return (
      <Layout title="Add Match" showBack>
        <div className="flex items-center justify-center py-20">
          <div className="spinner-lg"></div>
        </div>
      </Layout>
    );
  }

  if (success) {
    return (
      <Layout title="Add Match" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">✅</div>
          <div className="empty-state-text">Match Created!</div>
          <div className="text-sm text-gray-500 mt-2">Redirecting to match...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Add Match" showBack>
      <div className="p-4 max-w-2xl mx-auto">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Tournament Selection */}
          <div className="card p-6 space-y-4">
            <h3 className="font-bold text-lg">Match Details</h3>

            {/* Tournament Dropdown */}
            <div>
              <label className="block text-sm font-semibold mb-2">Tournament</label>
              <select
                value={tournamentId}
                onChange={(e) => setTournamentId(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg"
                required
              >
                <option value="">Select Tournament</option>
                {tournaments.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.year})
                  </option>
                ))}
              </select>
            </div>

            {/* Round Dropdown */}
            {tournamentId && (
              <div>
                <label className="block text-sm font-semibold mb-2">Round</label>
                <select
                  value={roundId}
                  onChange={(e) => setRoundId(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                  required
                >
                  <option value="">Select Round</option>
                  {rounds.map(r => (
                    <option key={r.id} value={r.id}>
                      Day {r.day} - {r.format || "No format set"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Match ID */}
            <div>
              <label className="block text-sm font-semibold mb-2">Match ID</label>
              <input
                type="text"
                value={matchId}
                onChange={(e) => setMatchId(e.target.value)}
                placeholder="e.g., rowdyCup2025-R01M01-twoManBestBall"
                className="w-full p-3 border border-gray-300 rounded-lg"
                required
              />
              <div className="text-xs text-gray-500 mt-1">
                  Tee time can be set now or later. If provided, uses local timezone.
              </div>
            </div>
              {/* Tee time input */}
              <div>
                <label className="block text-sm font-semibold mb-2">Tee Time</label>
                <input
                  type="datetime-local"
                  value={teeTime}
                  onChange={(e) => setTeeTime(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                  placeholder="Optional"
                />
                <div className="text-xs text-gray-500 mt-1">Optional — stored as a timestamp</div>
              </div>
          </div>

          {/* Team A Players */}
          {selectedTournament && (
            <div className="card p-6 space-y-4">
              <h3 className="font-bold text-lg" style={{ color: selectedTournament.teamA?.color || "var(--team-a-default)" }}>
                {selectedTournament.teamA?.name || "Team A"} Players
              </h3>

              {teamAPlayers.map((playerInput, idx) => (
                <div key={idx} className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="block text-sm font-semibold mb-2">Player {idx + 1}</label>
                    <select
                      value={playerInput.playerId}
                      onChange={(e) => {
                        const updated = [...teamAPlayers];
                        updated[idx].playerId = e.target.value;
                        setTeamAPlayers(updated);
                      }}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                      required
                    >
                      <option value="">Select Player</option>
                      {teamAAvailablePlayers.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.displayName || p.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* handicapIndex is now derived from tournament.handicapByPlayer */}

                  {idx > 0 && (
                    <button
                      type="button"
                      onClick={() => setTeamAPlayers(teamAPlayers.filter((_, i) => i !== idx))}
                      className="p-3 text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={() => setTeamAPlayers([...teamAPlayers, { playerId: "" }])}
                className="text-sm text-blue-600 hover:underline"
              >
                + Add another {selectedTournament.teamA?.name || "Team A"} player
              </button>
            </div>
          )}

          {/* Team B Players */}
          {selectedTournament && (
            <div className="card p-6 space-y-4">
              <h3 className="font-bold text-lg" style={{ color: selectedTournament.teamB?.color || "var(--team-b-default)" }}>
                {selectedTournament.teamB?.name || "Team B"} Players
              </h3>

              {teamBPlayers.map((playerInput, idx) => (
                <div key={idx} className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="block text-sm font-semibold mb-2">Player {idx + 1}</label>
                    <select
                      value={playerInput.playerId}
                      onChange={(e) => {
                        const updated = [...teamBPlayers];
                        updated[idx].playerId = e.target.value;
                        setTeamBPlayers(updated);
                      }}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                      required
                    >
                      <option value="">Select Player</option>
                      {teamBAvailablePlayers.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.displayName || p.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* handicapIndex is now derived from tournament.handicapByPlayer */}

                  {idx > 0 && (
                    <button
                      type="button"
                      onClick={() => setTeamBPlayers(teamBPlayers.filter((_, i) => i !== idx))}
                      className="p-3 text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={() => setTeamBPlayers([...teamBPlayers, { playerId: "" }])}
                className="text-sm text-blue-600 hover:underline"
              >
                + Add another {selectedTournament.teamB?.name || "Team B"} player
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="card p-4 bg-red-50 border-red-200">
              <div className="text-red-800 font-semibold">Error</div>
              <div className="text-red-600 text-sm mt-1">{error}</div>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !tournamentId || !roundId || !matchId}
            className="btn btn-primary w-full"
          >
            {submitting ? "Creating Match..." : "Create Match"}
          </button>
        </form>
      </div>
    </Layout>
  );
}
