import { useMemo, useState } from "react";
import type { PlayerDoc, TierMap, TournamentDoc } from "../../types";
import type { TournamentUpdates } from "../../api/adminContracts";

const TIERS = ["A", "B", "C", "D"] as const;

type TeamKey = "teamA" | "teamB";

interface TeamFormState {
  name: string;
  color: string;
  captainId: string;
  coCaptainId: string;
  rosterByTier: Record<string, string>; // tier -> comma-separated player ids
  handicapByPlayer: Record<string, string>; // playerId -> handicap as text
}

function teamToForm(team: TournamentDoc["teamA"] | undefined): TeamFormState {
  const roster: Record<string, string> = {};
  TIERS.forEach((tier) => {
    roster[tier] = (team?.rosterByTier?.[tier] ?? []).join(", ");
  });
  const handicaps: Record<string, string> = {};
  Object.entries(team?.handicapByPlayer ?? {}).forEach(([pid, hcp]) => {
    handicaps[pid] = String(hcp);
  });
  return {
    name: team?.name ?? "",
    color: team?.color ?? "",
    captainId: team?.captainId ?? "",
    coCaptainId: team?.coCaptainId ?? "",
    rosterByTier: roster,
    handicapByPlayer: handicaps,
  };
}

function parseRoster(form: TeamFormState): TierMap {
  const roster: TierMap = {};
  TIERS.forEach((tier) => {
    roster[tier] = form.rosterByTier[tier]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  });
  return roster;
}

interface TournamentSettingsFormProps {
  tournament: TournamentDoc;
  /** All players, for captain selects and handicap labels. */
  allPlayers: PlayerDoc[];
  submitting: boolean;
  onSubmit: (updates: TournamentUpdates) => void;
}

/** Tournament settings form body (formerly inside ManageTournament). */
export default function TournamentSettingsForm({
  tournament,
  allPlayers,
  submitting,
  onSubmit,
}: TournamentSettingsFormProps) {
  const [name, setName] = useState(tournament.name ?? "");
  const [year, setYear] = useState(String(tournament.year ?? ""));
  const [active, setActive] = useState(!!tournament.active);
  const [openPublicEdits, setOpenPublicEdits] = useState(!!tournament.openPublicEdits);
  const [sportsbookEnabled, setSportsbookEnabled] = useState(!!tournament.sportsbookEnabled);
  const [commentsEnabled, setCommentsEnabled] = useState(!!tournament.commentsEnabled);
  const [test, setTest] = useState(!!tournament.test);
  const [tiebreakerWinner, setTiebreakerWinner] = useState<"" | "teamA" | "teamB">(
    tournament.tiebreakerWinner ?? ""
  );
  const [teamA, setTeamA] = useState<TeamFormState>(teamToForm(tournament.teamA));
  const [teamB, setTeamB] = useState<TeamFormState>(teamToForm(tournament.teamB));
  const [error, setError] = useState<string | null>(null);

  const playerNameById = useMemo(() => {
    const map: Record<string, string> = {};
    allPlayers.forEach((p) => { map[p.id] = p.displayName ?? p.id; });
    return map;
  }, [allPlayers]);

  const rosteredIds = (form: TeamFormState): string[] => {
    const roster = parseRoster(form);
    return TIERS.flatMap((tier) => roster[tier] ?? []);
  };

  const updateTeam = (key: TeamKey, patch: Partial<TeamFormState>) => {
    const setter = key === "teamA" ? setTeamA : setTeamB;
    setter((prev) => ({ ...prev, ...patch }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const buildTeam = (form: TeamFormState) => {
        const handicapByPlayer: Record<string, number> = {};
        for (const pid of rosteredIds(form)) {
          const raw = form.handicapByPlayer[pid];
          if (raw !== undefined && raw !== "") {
            const num = Number(raw);
            if (!Number.isFinite(num)) throw new Error(`Invalid handicap for ${pid}: "${raw}"`);
            handicapByPlayer[pid] = num;
          }
        }
        return {
          name: form.name,
          color: form.color,
          captainId: form.captainId,
          coCaptainId: form.coCaptainId,
          rosterByTier: parseRoster(form),
          handicapByPlayer,
        };
      };

      onSubmit({
        name,
        year: Number(year),
        active,
        openPublicEdits,
        sportsbookEnabled,
        commentsEnabled,
        test,
        tiebreakerWinner: tiebreakerWinner === "" ? null : tiebreakerWinner,
        teamA: buildTeam(teamA),
        teamB: buildTeam(teamB),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid form");
    }
  };

  const renderTeamSection = (key: TeamKey, form: TeamFormState, label: string) => {
    const ids = rosteredIds(form);
    return (
      <div className="border border-gray-200 rounded-lg p-4 space-y-4">
        <h3 className="font-bold">{label}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateTeam(key, { name: e.target.value })}
              className="w-full p-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Color</label>
            <input
              type="text"
              value={form.color}
              placeholder="#1e40af"
              onChange={(e) => updateTeam(key, { color: e.target.value })}
              className="w-full p-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Captain</label>
            <select
              value={form.captainId}
              onChange={(e) => updateTeam(key, { captainId: e.target.value })}
              className="w-full p-2 border border-gray-300 rounded-lg"
            >
              <option value="">None</option>
              {ids.map((pid) => (
                <option key={pid} value={pid}>{playerNameById[pid] ?? pid}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Co-Captain</label>
            <select
              value={form.coCaptainId}
              onChange={(e) => updateTeam(key, { coCaptainId: e.target.value })}
              className="w-full p-2 border border-gray-300 rounded-lg"
            >
              <option value="">None</option>
              {ids.map((pid) => (
                <option key={pid} value={pid}>{playerNameById[pid] ?? pid}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold mb-1">Roster by tier (comma-separated player IDs)</div>
          {TIERS.map((tier) => (
            <div key={tier} className="flex items-center gap-2 mb-2">
              <span className="w-6 text-sm font-semibold">{tier}</span>
              <input
                type="text"
                value={form.rosterByTier[tier]}
                onChange={(e) =>
                  updateTeam(key, { rosterByTier: { ...form.rosterByTier, [tier]: e.target.value } })
                }
                className="flex-1 p-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          ))}
        </div>

        {ids.length > 0 && (
          <div>
            <div className="text-sm font-semibold mb-1">Handicap index by player</div>
            <div className="grid grid-cols-2 gap-2">
              {ids.map((pid) => (
                <div key={pid} className="flex items-center gap-2">
                  <span className="text-sm flex-1 truncate">{playerNameById[pid] ?? pid}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={form.handicapByPlayer[pid] ?? ""}
                    onChange={(e) =>
                      updateTeam(key, { handicapByPlayer: { ...form.handicapByPlayer, [pid]: e.target.value } })
                    }
                    className="w-20 p-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
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
          <label className="block text-sm font-semibold mb-1">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-lg"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="font-semibold">Active tournament</span>
          <span className="text-gray-500">(activating this deactivates all others)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={openPublicEdits} onChange={(e) => setOpenPublicEdits(e.target.checked)} />
          <span className="font-semibold">Open public edits</span>
          <span className="text-gray-500">(anyone can enter scores, no login)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sportsbookEnabled} onChange={(e) => setSportsbookEnabled(e.target.checked)} />
          <span className="font-semibold">Sportsbook</span>
          <span className="text-gray-500">(enable peer-to-peer betting)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={commentsEnabled} onChange={(e) => setCommentsEnabled(e.target.checked)} />
          <span className="font-semibold">Comments</span>
          <span className="text-gray-500">(match threads + sportsbook trash talk)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />
          <span className="font-semibold">Test tournament</span>
        </label>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Tiebreaker winner</label>
        <select
          value={tiebreakerWinner}
          onChange={(e) => setTiebreakerWinner(e.target.value as "" | "teamA" | "teamB")}
          className="w-full p-2 border border-gray-300 rounded-lg"
        >
          <option value="">None (decided in regulation / unbroken tie)</option>
          <option value="teamA">{teamA.name || "Team A"} won the tiebreaker</option>
          <option value="teamB">{teamB.name || "Team B"} won the tiebreaker</option>
        </select>
        <p className="mt-1 text-xs text-gray-500">
          Set only when regulation ended tied and a tiebreaker decided the Cup. Shows a champions
          banner on the home and tournament pages.
        </p>
      </div>

      {renderTeamSection("teamA", teamA, "Team A")}
      {renderTeamSection("teamB", teamB, "Team B")}

      <button type="submit" disabled={submitting} className="btn btn-primary w-full">
        {submitting ? "Saving..." : "Save Tournament"}
      </button>
    </form>
  );
}
