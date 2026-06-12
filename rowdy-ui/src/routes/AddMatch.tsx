import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import StatusBanner from "../components/admin/StatusBanner";
import { useAuth } from "../contexts/AuthContext";
import { useAdminTournaments } from "../hooks/admin/useAdminTournaments";
import { useRosterPlayers } from "../hooks/admin/useRosterPlayers";
import { useRounds } from "../hooks/admin/useRounds";
import { adminApi } from "../api/admin";
import { getErrorMessage } from "../api/errors";
import { tierPlayerIds } from "../utils/roster";
import type { SeedMatchRequest } from "../api/adminContracts";

type PlayerInput = {
  playerId: string;
};

export default function AddMatch() {
  const { player } = useAuth();
  const navigate = useNavigate();

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

  const { tournaments, loading, error: loadError } = useAdminTournaments();
  const selectedTournament = useMemo(
    () => tournaments.find((t) => t.id === tournamentId) ?? null,
    [tournaments, tournamentId]
  );
  const { players } = useRosterPlayers(selectedTournament);
  const { rounds } = useRounds(tournamentId);

  // Get available players for each team
  const teamAAvailablePlayers = useMemo(() => {
    if (!selectedTournament) return [];
    const allIds = tierPlayerIds(selectedTournament.teamA?.rosterByTier);
    return players.filter((p) => allIds.includes(p.id));
  }, [selectedTournament, players]);

  const teamBAvailablePlayers = useMemo(() => {
    if (!selectedTournament) return [];
    const allIds = tierPlayerIds(selectedTournament.teamB?.rosterByTier);
    return players.filter((p) => allIds.includes(p.id));
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
      const validTeamA = teamAPlayers.filter((p) => p.playerId);
      const validTeamB = teamBPlayers.filter((p) => p.playerId);

      if (validTeamA.length === 0 || validTeamB.length === 0) {
        throw new Error("Each team must have at least one player");
      }

      const payload: SeedMatchRequest = {
        id: matchId,
        tournamentId,
        roundId,
        teamAPlayers: validTeamA,
        teamBPlayers: validTeamB,
      };
      // Treat datetime-local input as Pacific Time (UTC-8)
      if (teeTime) {
        const pacificDate = new Date(teeTime + "-08:00");
        payload.teeTime = pacificDate.toISOString();
      }

      await adminApi.seedMatch(payload);
      setSuccess(true);

      // Navigate to match after short delay
      setTimeout(() => {
        navigate(`/match/${matchId}`);
      }, 1500);
    } catch (err) {
      console.error("Error creating match:", err);
      setError(getErrorMessage(err, "Failed to create match"));
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

          <StatusBanner error={error ?? loadError} />

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
