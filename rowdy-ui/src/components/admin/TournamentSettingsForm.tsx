import { useMemo, useState } from "react";
import type { PlayerDoc, TierMap, TournamentDoc } from "../../types";
import type { TournamentUpdates } from "../../api/adminContracts";
import { betsApi } from "../../api/bets";

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
  const [hideDraftPool, setHideDraftPool] = useState(!!tournament.hideDraftPool);
  const [rulesOfficialUseGrok, setRulesOfficialUseGrok] = useState(!!tournament.rulesOfficialUseGrok);
  const [test, setTest] = useState(!!tournament.test);
  const [totalPointsAvailable, setTotalPointsAvailable] = useState(
    tournament.totalPointsAvailable != null ? String(tournament.totalPointsAvailable) : ""
  );
  const hasDraftPool = !!tournament.draftPool && Object.keys(tournament.draftPool).length > 0;
  const [tiebreakerWinner, setTiebreakerWinner] = useState<"" | "teamA" | "teamB">(
    tournament.tiebreakerWinner ?? ""
  );
  const [teamA, setTeamA] = useState<TeamFormState>(teamToForm(tournament.teamA));
  const [teamB, setTeamB] = useState<TeamFormState>(teamToForm(tournament.teamB));
  const [error, setError] = useState<string | null>(null);

  // Operational: settle the tournament-long player-futures markets.
  const [settling, setSettling] = useState(false);
  const [settleMsg, setSettleMsg] = useState<string | null>(null);
  const handleSettlePlayerFutures = async () => {
    if (
      !window.confirm(
        "Settle all active player-prop bets (matchups + player point O/Us) from final tournament points? Make sure every match is closed first."
      )
    )
      return;
    setSettling(true);
    setSettleMsg(null);
    try {
      const res = await betsApi.settlePlayerFutures({ tournamentId: tournament.id });
      setSettleMsg(`Settled ${res.settledCount} player-prop bet${res.settledCount === 1 ? "" : "s"}.`);
    } catch (e) {
      setSettleMsg(e instanceof Error ? e.message : "Couldn't settle player futures");
    } finally {
      setSettling(false);
    }
  };

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

      const totalPointsTrimmed = totalPointsAvailable.trim();
      let totalPoints: number | null;
      if (totalPointsTrimmed === "") {
        totalPoints = null;
      } else {
        const num = Number(totalPointsTrimmed);
        if (!Number.isFinite(num) || num <= 0) {
          throw new Error("Total points available must be a positive number (or blank to auto-total).");
        }
        totalPoints = num;
      }

      onSubmit({
        name,
        year: Number(year),
        active,
        openPublicEdits,
        sportsbookEnabled,
        commentsEnabled,
        hideDraftPool,
        rulesOfficialUseGrok,
        test,
        tiebreakerWinner: tiebreakerWinner === "" ? null : tiebreakerWinner,
        totalPointsAvailable: totalPoints,
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

      <div>
        <label className="block text-sm font-semibold mb-1">Total points available</label>
        <input
          type="number"
          step="0.5"
          min="0"
          value={totalPointsAvailable}
          placeholder="Auto (sum of created matches)"
          onChange={(e) => setTotalPointsAvailable(e.target.value)}
          className="w-full p-2 border border-gray-300 rounded-lg"
        />
        <p className="mt-1 text-xs text-gray-500">
          Total points contested across the whole tournament (e.g. 24). Drives the score-tracker bar
          and "points needed to win". Leave blank to auto-total from created matches — set it manually
          when later rounds' matches don't exist yet.
        </p>
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
          <input type="checkbox" checked={rulesOfficialUseGrok} onChange={(e) => setRulesOfficialUseGrok(e.target.checked)} />
          <span className="font-semibold">Rules Official: use Grok</span>
          <span className="text-gray-500">(on = in-app AI for live rounds; off = free NotebookLM link)</span>
        </label>
        {hasDraftPool && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hideDraftPool} onChange={(e) => setHideDraftPool(e.target.checked)} />
            <span className="font-semibold">Hide Draft Pool</span>
            <span className="text-gray-500">(hides the Draft Pool card + menu link; pool data is kept)</span>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />
          <span className="font-semibold">Test tournament</span>
        </label>
      </div>

      {tournament.sportsbookEnabled && (
        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="text-sm font-semibold">Settle player futures</div>
          <p className="text-xs text-gray-500">
            Resolves active player matchups and tournament-points over/unders from each player's total
            points. Run once the tournament is complete (all matches closed). Other markets settle
            automatically as matches finish.
          </p>
          <button
            type="button"
            onClick={handleSettlePlayerFutures}
            disabled={settling}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {settling ? "Settling…" : "Settle player futures"}
          </button>
          {settleMsg && <p className="text-xs text-gray-700">{settleMsg}</p>}
        </div>
      )}

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
