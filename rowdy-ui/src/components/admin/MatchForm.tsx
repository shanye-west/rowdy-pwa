import { useMemo, useState } from "react";
import type { MatchDoc, PlayerDoc, TournamentDoc } from "../../types";
import { tierPlayerIds } from "../../utils/roster";
import { storedToLocalInput } from "../../utils/teeTime";

export interface MatchFormPlayer {
  playerId: string;
  /** Only shown/sent in edit mode (handicap override). */
  handicapIndex?: number;
  /** Display only — current calculated value from the match doc. */
  courseHandicap?: number;
}

export interface MatchFormValues {
  matchId: string;
  /** datetime-local value, "" if unset. Convert with localInputToIso before calling the API. */
  teeTime: string;
  teamAPlayers: MatchFormPlayer[];
  teamBPlayers: MatchFormPlayer[];
}

interface MatchFormProps {
  tournament: TournamentDoc;
  /** Roster player docs (from AdminTournamentContext). */
  players: PlayerDoc[];
  /** Prefill for edit mode; omit for create. */
  initial?: { match: MatchDoc; teamA: MatchFormPlayer[]; teamB: MatchFormPlayer[] };
  /** Show per-player handicap index override inputs (edit mode). */
  showHandicapOverride?: boolean;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (values: MatchFormValues) => void;
}

/**
 * Shared match create/edit form: match id, tee time, and per-team player
 * pickers restricted to the tournament roster. Merges the former
 * AddMatch/EditMatch form bodies.
 */
export default function MatchForm({
  tournament,
  players,
  initial,
  showHandicapOverride = false,
  submitting,
  submitLabel,
  onSubmit,
}: MatchFormProps) {
  const isEdit = !!initial;
  const [matchId, setMatchId] = useState(initial?.match.id ?? "");
  const [teeTime, setTeeTime] = useState(initial ? storedToLocalInput(initial.match.teeTime) : "");
  const [teamAPlayers, setTeamAPlayers] = useState<MatchFormPlayer[]>(
    initial?.teamA.length ? initial.teamA : [{ playerId: "" }]
  );
  const [teamBPlayers, setTeamBPlayers] = useState<MatchFormPlayer[]>(
    initial?.teamB.length ? initial.teamB : [{ playerId: "" }]
  );

  const teamAAvailablePlayers = useMemo(() => {
    const ids = tierPlayerIds(tournament.teamA?.rosterByTier);
    return players.filter((p) => ids.includes(p.id));
  }, [tournament, players]);

  const teamBAvailablePlayers = useMemo(() => {
    const ids = tierPlayerIds(tournament.teamB?.rosterByTier);
    return players.filter((p) => ids.includes(p.id));
  }, [tournament, players]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      matchId,
      teeTime,
      teamAPlayers: teamAPlayers.filter((p) => p.playerId),
      teamBPlayers: teamBPlayers.filter((p) => p.playerId),
    });
  };

  const renderTeam = (
    teamKey: "teamA" | "teamB",
    list: MatchFormPlayer[],
    setList: (next: MatchFormPlayer[]) => void,
    available: PlayerDoc[]
  ) => {
    const team = tournament[teamKey];
    const fallbackColor = teamKey === "teamA" ? "var(--team-a-default)" : "var(--team-b-default)";
    return (
      <div className="card p-6 space-y-4">
        <h3 className="font-bold text-lg" style={{ color: team?.color || fallbackColor }}>
          {team?.name || (teamKey === "teamA" ? "Team A" : "Team B")} Players
        </h3>

        {list.map((playerInput, idx) => (
          <div key={idx} className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-sm font-semibold mb-2">Player {idx + 1}</label>
              <select
                value={playerInput.playerId}
                onChange={(e) => {
                  const updated = [...list];
                  updated[idx] = { ...updated[idx], playerId: e.target.value };
                  setList(updated);
                }}
                className="w-full p-3 border border-gray-300 rounded-lg"
                required
              >
                <option value="">Select Player</option>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName || p.id}
                  </option>
                ))}
              </select>
            </div>

            {showHandicapOverride && (
              <div className="w-32">
                <label className="block text-sm font-semibold mb-2">Handicap Index</label>
                <input
                  type="number"
                  step="0.1"
                  value={playerInput.handicapIndex ?? 0}
                  onChange={(e) => {
                    const updated = [...list];
                    updated[idx] = { ...updated[idx], handicapIndex: parseFloat(e.target.value) || 0 };
                    setList(updated);
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
            )}

            {idx > 0 && (
              <button
                type="button"
                onClick={() => setList(list.filter((_, i) => i !== idx))}
                className="p-3 text-red-600 hover:bg-red-50 rounded-lg"
              >
                ✕
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() => setList([...list, showHandicapOverride ? { playerId: "", handicapIndex: 0 } : { playerId: "" }])}
          className="text-sm text-blue-600 hover:underline"
        >
          + Add another {team?.name || (teamKey === "teamA" ? "Team A" : "Team B")} player
        </button>
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="card p-6 space-y-4">
        <h3 className="font-bold text-lg">Match Details</h3>

        <div>
          <label className="block text-sm font-semibold mb-2">Match ID</label>
          <input
            type="text"
            value={matchId}
            onChange={(e) => setMatchId(e.target.value)}
            placeholder="e.g., rowdyCup2025-R01M01-twoManBestBall"
            className={`w-full p-3 border border-gray-300 rounded-lg ${isEdit ? "bg-gray-50" : ""}`}
            readOnly={isEdit}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Tee Time</label>
          <input
            type="datetime-local"
            value={teeTime}
            onChange={(e) => setTeeTime(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg"
          />
          <div className="text-xs text-gray-500 mt-1">Optional — interpreted as Pacific Time</div>
        </div>
      </div>

      {renderTeam("teamA", teamAPlayers, setTeamAPlayers, teamAAvailablePlayers)}
      {renderTeam("teamB", teamBPlayers, setTeamBPlayers, teamBAvailablePlayers)}

      <button type="submit" disabled={submitting || !matchId} className="btn btn-primary w-full">
        {submitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
