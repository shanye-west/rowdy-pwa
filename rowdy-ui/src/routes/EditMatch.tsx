import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";
import type { TournamentDoc, RoundDoc, PlayerDoc, MatchDoc } from "../types";

type PlayerInput = {
  playerId: string;
  handicapIndex: number;
  courseHandicap?: number; // Display only - current calculated value
};

export default function EditMatch() {
  const { player } = useAuth();
  const navigate = useNavigate();

  // State - must declare all hooks before any conditional returns
  const [tournaments, setTournaments] = useState<TournamentDoc[]>([]);
  const [rounds, setRounds] = useState<RoundDoc[]>([]);
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Selection state
  const [tournamentId, setTournamentId] = useState("");
  const [roundId, setRoundId] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchLoading, setMatchLoading] = useState(false);

  // Form fields (populated after match selection)
  const [matchId, setMatchId] = useState("");
  const [teeTime, setTeeTime] = useState("");
  const [teamAPlayers, setTeamAPlayers] = useState<PlayerInput[]>([{ playerId: "", handicapIndex: 0 }]);
  const [teamBPlayers, setTeamBPlayers] = useState<PlayerInput[]>([{ playerId: "", handicapIndex: 0 }]);

  // Fetch tournaments and players on mount
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

        // Fetch all players
        const playersSnap = await getDocs(collection(db, "players"));
        const playersData = playersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PlayerDoc));
        setPlayers(playersData);

        setLoading(false);
      } catch (err) {
        console.error("Error fetching data:", err);
        setError("Failed to load data");
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Fetch rounds when tournament changes
  useEffect(() => {
    if (!tournamentId) {
      setRounds([]);
      setRoundId("");
      setMatches([]);
      setSelectedMatchId("");
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

  // Fetch matches when round changes
  useEffect(() => {
    if (!roundId) {
      setMatches([]);
      setSelectedMatchId("");
      return;
    }

    const fetchMatches = async () => {
      try {
        const matchesSnap = await getDocs(query(collection(db, "matches"), where("roundId", "==", roundId)));
        const matchesData = matchesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MatchDoc));
        setMatches(matchesData.sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0)));
      } catch (err) {
        console.error("Error fetching matches:", err);
        setError("Failed to load matches");
      }
    };

    fetchMatches();
  }, [roundId]);

  // Load match details when a match is selected
  useEffect(() => {
    if (!selectedMatchId) {
      // Reset form
      setMatchId("");
      setTeeTime("");
      setTeamAPlayers([{ playerId: "", handicapIndex: 0 }]);
      setTeamBPlayers([{ playerId: "", handicapIndex: 0 }]);
      return;
    }

    const loadMatch = async () => {
      setMatchLoading(true);
      try {
        const matchSnap = await getDoc(doc(db, "matches", selectedMatchId));
        if (!matchSnap.exists()) {
          throw new Error("Match not found");
        }

        const matchData = matchSnap.data() as MatchDoc;
        
        // Set form fields
        setMatchId(selectedMatchId);
        
        // Convert teeTime Timestamp to datetime-local format (Pacific Time)
        if (matchData.teeTime) {
          const timestamp = matchData.teeTime.toDate();
          // Format as Pacific Time for datetime-local input
          const pacificDate = new Date(timestamp.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
          const year = pacificDate.getFullYear();
          const month = String(pacificDate.getMonth() + 1).padStart(2, '0');
          const day = String(pacificDate.getDate()).padStart(2, '0');
          const hours = String(pacificDate.getHours()).padStart(2, '0');
          const minutes = String(pacificDate.getMinutes()).padStart(2, '0');
          setTeeTime(`${year}-${month}-${day}T${hours}:${minutes}`);
        } else {
          setTeeTime("");
        }

        // Fetch tournament to get handicap indexes
        const tournamentSnap = matchData.tournamentId 
          ? await getDoc(doc(db, "tournaments", matchData.tournamentId))
          : null;
        const tournament = tournamentSnap?.exists() ? tournamentSnap.data() as TournamentDoc : null;
        
        // Set team A players
        if (matchData.teamAPlayers && matchData.teamAPlayers.length > 0) {
          const teamA = matchData.teamAPlayers.map((p, idx) => ({
            playerId: p.playerId,
            handicapIndex: tournament?.teamA?.handicapByPlayer?.[p.playerId] ?? 0,
            courseHandicap: matchData.courseHandicaps?.[idx], // Display current calculated value
          }));
          setTeamAPlayers(teamA);
        } else {
          setTeamAPlayers([{ playerId: "", handicapIndex: 0 }]);
        }

        // Set team B players
        if (matchData.teamBPlayers && matchData.teamBPlayers.length > 0) {
          const teamALen = matchData.teamAPlayers?.length || 0;
          const teamB = matchData.teamBPlayers.map((p, idx) => ({
            playerId: p.playerId,
            handicapIndex: tournament?.teamB?.handicapByPlayer?.[p.playerId] ?? 0,
            courseHandicap: matchData.courseHandicaps?.[teamALen + idx], // Display current calculated value
          }));
          setTeamBPlayers(teamB);
        } else {
          setTeamBPlayers([{ playerId: "", handicapIndex: 0 }]);
        }

        setMatchLoading(false);
      } catch (err: any) {
        console.error("Error loading match:", err);
        setError(err.message || "Failed to load match");
        setMatchLoading(false);
      }
    };

    loadMatch();
  }, [selectedMatchId]);

  // Get selected tournament data
  const selectedTournament = useMemo(() => 
    tournaments.find(t => t.id === tournamentId), 
    [tournaments, tournamentId]
  );

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
      const editMatchFn = httpsCallable(functions, "editMatch");
      const payload: any = {
        matchId,
        tournamentId,
        roundId,
        teamAPlayers: validTeamA,
        teamBPlayers: validTeamB,
      };

      // Include teeTime if provided - treat datetime-local as Pacific Time (UTC-8)
      if (teeTime) {
        // Append timezone offset to force Pacific Time interpretation
        const pacificDate = new Date(teeTime + '-08:00');
        payload.teeTime = pacificDate.toISOString();
      }

      const result = await editMatchFn(payload);

      console.log("Match updated:", result.data);
      setSuccess(true);

      // Navigate to match after short delay
      setTimeout(() => {
        navigate(`/match/${matchId}`);
      }, 1500);

    } catch (err: any) {
      console.error("Error updating match:", err);
      setError(err.message || "Failed to update match");
      setSubmitting(false);
    }
  };

  // Access control - check after all hooks are declared
  if (!player?.isAdmin) {
    return (
      <Layout title="Edit Match" showBack>
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
      <Layout title="Edit Match" showBack>
        <div className="flex items-center justify-center py-20">
          <div className="spinner-lg"></div>
        </div>
      </Layout>
    );
  }

  if (success) {
    return (
      <Layout title="Edit Match" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">✅</div>
          <div className="empty-state-text">Match Updated!</div>
          <div className="text-sm text-gray-500 mt-2">Redirecting to match...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Edit Match" showBack>
      <div className="p-4 max-w-2xl mx-auto">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Match Selection */}
          <div className="card p-6 space-y-4">
            <h3 className="font-bold text-lg">Select Match</h3>

            {/* Tournament Dropdown */}
            <div>
              <label className="block text-sm font-semibold mb-2">Tournament</label>
              <select
                value={tournamentId}
                onChange={(e) => {
                  setTournamentId(e.target.value);
                  setRoundId("");
                  setSelectedMatchId("");
                }}
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
                  onChange={(e) => {
                    setRoundId(e.target.value);
                    setSelectedMatchId("");
                  }}
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

            {/* Match Dropdown */}
            {roundId && (
              <div>
                <label className="block text-sm font-semibold mb-2">Match</label>
                <select
                  value={selectedMatchId}
                  onChange={(e) => setSelectedMatchId(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                  required
                >
                  <option value="">Select Match</option>
                  {matches.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Show loading spinner while fetching match details */}
          {matchLoading && (
            <div className="flex items-center justify-center py-10">
              <div className="spinner-lg"></div>
            </div>
          )}

          {/* Edit Form - only show if match is selected and loaded */}
          {selectedMatchId && !matchLoading && (
            <>
              {/* Match Details */}
              <div className="card p-6 space-y-4">
                <h3 className="font-bold text-lg">Match Details</h3>

                {/* Match ID (read-only) */}
                <div>
                  <label className="block text-sm font-semibold mb-2">Match ID</label>
                  <input
                    type="text"
                    value={matchId}
                    readOnly
                    className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                  />
                </div>

                {/* Tee Time */}
                <div>
                  <label className="block text-sm font-semibold mb-2">Tee Time</label>
                  <input
                    type="datetime-local"
                    value={teeTime}
                    onChange={(e) => setTeeTime(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    Format: YYYY-MM-DD HH:MM (matches Firestore timestamp format)
                  </div>
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

                      <div className="w-32">
                        <label className="block text-sm font-semibold mb-2">Handicap Index</label>
                        <input
                          type="number"
                          step="0.1"
                          value={playerInput.handicapIndex}
                          onChange={(e) => {
                            const updated = [...teamAPlayers];
                            updated[idx].handicapIndex = parseFloat(e.target.value) || 0;
                            setTeamAPlayers(updated);
                          }}
                          className="w-full p-3 border border-gray-300 rounded-lg"
                          required
                        />
                        {playerInput.courseHandicap !== undefined && (
                          <div className="text-xs text-gray-500 mt-1">
                            Current course handicap: {playerInput.courseHandicap}
                          </div>
                        )}
                      </div>

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
                    onClick={() => setTeamAPlayers([...teamAPlayers, { playerId: "", handicapIndex: 0 }])}
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

                      <div className="w-32">
                        <label className="block text-sm font-semibold mb-2">Handicap Index</label>
                        <input
                          type="number"
                          step="0.1"
                          value={playerInput.handicapIndex}
                          onChange={(e) => {
                            const updated = [...teamBPlayers];
                            updated[idx].handicapIndex = parseFloat(e.target.value) || 0;
                            setTeamBPlayers(updated);
                          }}
                          className="w-full p-3 border border-gray-300 rounded-lg"
                          required
                        />
                        {playerInput.courseHandicap !== undefined && (
                          <div className="text-xs text-gray-500 mt-1">
                            Current course handicap: {playerInput.courseHandicap}
                          </div>
                        )}
                      </div>

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
                    onClick={() => setTeamBPlayers([...teamBPlayers, { playerId: "", handicapIndex: 0 }])}
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
                disabled={submitting || !matchId}
                className="btn btn-primary w-full"
              >
                {submitting ? "Updating Match..." : "Update Match"}
              </button>
            </>
          )}
        </form>
      </div>
    </Layout>
  );
}
