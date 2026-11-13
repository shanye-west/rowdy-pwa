import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import SaveBar from "./SaveBar";
import { Field, FieldGroup, InfoNote, ToggleList, ToggleRow } from "./fields";
import { inputClass } from "./inputStyles";
import { cn } from "../../lib/utils";
import type { PlayerDoc, TierMap, TournamentDoc } from "../../types";
import type { TournamentUpdates } from "../../api/adminContracts";

const TIERS = ["A", "B", "C", "D"] as const;
type Tier = (typeof TIERS)[number];

type TeamKey = "teamA" | "teamB";

/** Which panel of the settings form is visible. Owned by the page's tab bar. */
export type SettingsTab = "setup" | "rosters";

interface TeamFormState {
  name: string;
  color: string;
  captainId: string;
  coCaptainId: string;
  /** tier -> player ids. Edited with the picker below, never as raw text. */
  rosterByTier: Record<Tier, string[]>;
  handicapByPlayer: Record<string, string>; // playerId -> handicap as text
}

function teamToForm(team: TournamentDoc["teamA"] | undefined): TeamFormState {
  const roster = {} as Record<Tier, string[]>;
  TIERS.forEach((tier) => {
    roster[tier] = [...(team?.rosterByTier?.[tier] ?? [])];
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
    roster[tier] = [...form.rosterByTier[tier]];
  });
  return roster;
}

const rosteredIds = (form: TeamFormState): string[] => TIERS.flatMap((tier) => form.rosterByTier[tier]);

interface TournamentSettingsFormProps {
  tournament: TournamentDoc;
  /** All players, for the roster picker, captain selects and handicap labels. */
  allPlayers: PlayerDoc[];
  submitting: boolean;
  tab: SettingsTab;
  onSubmit: (updates: TournamentUpdates) => void;
}

/**
 * Tournament settings form. One form, two panels (setup / rosters) driven by
 * the page's tab bar, so switching tabs never drops in-progress edits and one
 * Save writes the whole document — the shape updateTournament expects.
 */
export default function TournamentSettingsForm({
  tournament,
  allPlayers,
  submitting,
  tab,
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
  // Extra planners: players who get a personal pairing-planning board without
  // being a captain or admin (those two always have one).
  const [planAccessIds, setPlanAccessIds] = useState<string[]>(tournament.planAccessPlayerIds ?? []);
  const [error, setError] = useState<string | null>(null);

  const playerNameById = useMemo(() => {
    const map: Record<string, string> = {};
    allPlayers.forEach((p) => { map[p.id] = p.displayName ?? p.id; });
    return map;
  }, [allPlayers]);

  /** Everyone already on a roster, either team — they're off the "add" menus. */
  const takenIds = useMemo(
    () => new Set([...rosteredIds(teamA), ...rosteredIds(teamB)]),
    [teamA, teamB]
  );

  /**
   * Captain / co-captain choices: this team's roster first, then anyone not on
   * a roster yet. Captains are often named before the draft fills the rosters
   * (they run it), and a saved pick has to stay listed or the select shows
   * "None" while still holding the id.
   */
  const renderLeaderOptions = (rosterIds: string[], currentId: string) => {
    const unrostered = allPlayers.filter(
      (p) => !rosterIds.includes(p.id) && (!takenIds.has(p.id) || p.id === currentId)
    );
    return (
      <>
        <option value="">None</option>
        {rosterIds.map((pid) => (
          <option key={pid} value={pid}>{playerNameById[pid] ?? pid}</option>
        ))}
        {unrostered.length > 0 && (
          <optgroup label="Not on this roster">
            {unrostered.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName ?? p.id}</option>
            ))}
          </optgroup>
        )}
      </>
    );
  };

  const updateTeam = (key: TeamKey, patch: Partial<TeamFormState>) => {
    const setter = key === "teamA" ? setTeamA : setTeamB;
    setter((prev) => ({ ...prev, ...patch }));
  };

  const addToTier = (key: TeamKey, tier: Tier, playerId: string) => {
    if (!playerId) return;
    const form = key === "teamA" ? teamA : teamB;
    updateTeam(key, {
      rosterByTier: { ...form.rosterByTier, [tier]: [...form.rosterByTier[tier], playerId] },
    });
  };

  const removeFromTier = (key: TeamKey, tier: Tier, playerId: string) => {
    const form = key === "teamA" ? teamA : teamB;
    updateTeam(key, {
      rosterByTier: {
        ...form.rosterByTier,
        [tier]: form.rosterByTier[tier].filter((id) => id !== playerId),
      },
    });
  };

  const buildUpdates = (): TournamentUpdates => {
    const buildTeam = (form: TeamFormState) => {
      const handicapByPlayer: Record<string, number> = {};
      for (const pid of rosteredIds(form)) {
        const raw = form.handicapByPlayer[pid];
        if (raw !== undefined && raw !== "") {
          const num = Number(raw);
          if (!Number.isFinite(num)) throw new Error(`Invalid handicap for ${playerNameById[pid] ?? pid}: "${raw}"`);
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

    // Validated here rather than with `required` on the inputs: the inactive tab
    // is display:none, and the browser refuses to submit (silently) when a
    // required control it can't focus is empty.
    if (!name.trim()) throw new Error("Name is required.");
    if (!Number.isFinite(Number(year)) || year.trim() === "") {
      throw new Error("Year must be a number.");
    }

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

    return {
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
      planAccessPlayerIds: planAccessIds.length > 0 ? planAccessIds : null,
      teamA: buildTeam(teamA),
      teamB: buildTeam(teamB),
    };
  };

  /** Serialized payload, or null when the form currently can't build one. */
  const snapshot = (): string | null => {
    try {
      return JSON.stringify(buildUpdates());
    } catch {
      return null; // invalid input — reads as dirty
    }
  };

  // Snapshot of the last-saved state, so the save bar can say whether anything
  // actually changed (an admin flipping between tabs shouldn't have to wonder).
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(snapshot);
  const dirty = snapshot() !== savedSnapshot;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const updates = buildUpdates();
      setSavedSnapshot(JSON.stringify(updates));
      onSubmit(updates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid form");
    }
  };

  const renderTeamSection = (key: TeamKey, form: TeamFormState, fallbackLabel: string) => {
    const ids = rosteredIds(form);
    const swatch = /^#[0-9a-f]{6}$/i.test(form.color) ? form.color : "#132448";
    return (
      <FieldGroup
        key={key}
        title={
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border border-border" style={{ background: swatch }} />
            {form.name || fallbackLabel}
            <span className="text-xs font-normal text-muted-foreground">{ids.length} players</span>
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateTeam(key, { name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Color">
            <div className="flex gap-2">
              <input
                type="color"
                value={swatch}
                onChange={(e) => updateTeam(key, { color: e.target.value })}
                className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-card"
                aria-label={`${form.name || fallbackLabel} color`}
              />
              <input
                type="text"
                value={form.color}
                placeholder="#1e40af"
                onChange={(e) => updateTeam(key, { color: e.target.value })}
                className={cn(inputClass, "font-mono text-xs")}
              />
            </div>
          </Field>
          <Field label="Captain">
            <select
              value={form.captainId}
              onChange={(e) => updateTeam(key, { captainId: e.target.value })}
              className={inputClass}
            >
              {renderLeaderOptions(ids, form.captainId)}
            </select>
          </Field>
          <Field label="Co-captain">
            <select
              value={form.coCaptainId}
              onChange={(e) => updateTeam(key, { coCaptainId: e.target.value })}
              className={inputClass}
            >
              {renderLeaderOptions(ids, form.coCaptainId)}
            </select>
          </Field>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Roster by tier</div>
          {TIERS.map((tier) => {
            const tierIds = form.rosterByTier[tier];
            const available = allPlayers.filter((p) => !takenIds.has(p.id));
            return (
              <div key={tier} className="rounded-lg border border-border/70 p-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-[0.65rem] font-bold">
                    {tier}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {tierIds.length === 0 ? "empty" : `${tierIds.length} player${tierIds.length === 1 ? "" : "s"}`}
                  </span>
                </div>
                {tierIds.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {tierIds.map((pid) => (
                      <span
                        key={pid}
                        className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pl-2.5 pr-1 text-xs font-medium"
                      >
                        {playerNameById[pid] ?? pid}
                        <button
                          type="button"
                          onClick={() => removeFromTier(key, tier, pid)}
                          aria-label={`Remove ${playerNameById[pid] ?? pid} from tier ${tier}`}
                          className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <select
                  value=""
                  onChange={(e) => addToTier(key, tier, e.target.value)}
                  className={cn(inputClass, "text-xs")}
                  aria-label={`Add a player to tier ${tier}`}
                >
                  <option value="">+ Add player…</option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>{p.displayName ?? p.id}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {ids.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Handicap index
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ids.map((pid) => (
                <div key={pid} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm">{playerNameById[pid] ?? pid}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={form.handicapByPlayer[pid] ?? ""}
                    onChange={(e) =>
                      updateTeam(key, { handicapByPlayer: { ...form.handicapByPlayer, [pid]: e.target.value } })
                    }
                    className={cn(inputClass, "w-20 shrink-0 px-2 py-1.5 text-sm")}
                    aria-label={`Handicap index for ${playerNameById[pid] ?? pid}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </FieldGroup>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className={cn("space-y-4", tab !== "setup" && "hidden")}>
        <FieldGroup title="Basics">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Year">
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <Field
            label="Total points available"
            hint="Points contested across the whole tournament (e.g. 24). Drives the score-tracker bar and “points needed to win”. Blank auto-totals from created matches — set it manually when later rounds' matches don't exist yet."
          >
            <input
              type="number"
              step="0.5"
              min="0"
              value={totalPointsAvailable}
              placeholder="Auto (sum of created matches)"
              onChange={(e) => setTotalPointsAvailable(e.target.value)}
              className={inputClass}
            />
          </Field>
        </FieldGroup>

        <FieldGroup title="Visibility & features">
          <ToggleList>
            <ToggleRow
              label="Active tournament"
              description="The one the app shows by default. Activating this deactivates all others."
              checked={active}
              onChange={setActive}
            />
            <ToggleRow
              label="Test tournament"
              description="Only visible to admins."
              checked={test}
              onChange={setTest}
            />
            <ToggleRow
              label="Open public edits"
              description="Anyone can enter scores without logging in."
              checked={openPublicEdits}
              onChange={setOpenPublicEdits}
            />
            <ToggleRow
              label="Sportsbook"
              description="Peer-to-peer betting."
              checked={sportsbookEnabled}
              onChange={setSportsbookEnabled}
            />
            <ToggleRow
              label="Comments"
              description="Match threads and sportsbook trash talk."
              checked={commentsEnabled}
              onChange={setCommentsEnabled}
            />
            <ToggleRow
              label="Rules Official: use Grok"
              description="On = the in-app AI for live rounds. Off = the free NotebookLM link."
              checked={rulesOfficialUseGrok}
              onChange={setRulesOfficialUseGrok}
            />
            {hasDraftPool && (
              <ToggleRow
                label="Hide draft pool"
                description="Hides the Draft Pool card and menu link. The pool data is kept."
                checked={hideDraftPool}
                onChange={setHideDraftPool}
              />
            )}
          </ToggleList>
        </FieldGroup>

        <FieldGroup
          title="Tiebreaker winner"
          description="Set only when regulation ended tied and a tiebreaker decided the Cup. Shows a champions banner on the home and tournament pages."
        >
          <select
            value={tiebreakerWinner}
            onChange={(e) => setTiebreakerWinner(e.target.value as "" | "teamA" | "teamB")}
            className={inputClass}
          >
            <option value="">None (decided in regulation / unbroken tie)</option>
            <option value="teamA">{teamA.name || "Team A"} won the tiebreaker</option>
            <option value="teamB">{teamB.name || "Team B"} won the tiebreaker</option>
          </select>
        </FieldGroup>

        <FieldGroup
          title="Pairing-plan access"
          description="Captains, co-captains and admins always get a personal planning board. Tick anyone else who should get one — each person's board is private to them."
        >
          {allPlayers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No players loaded.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border/70 p-2">
              <div className="grid grid-cols-2 gap-1">
                {[...allPlayers]
                  .sort((a, b) => (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id))
                  .map((p) => (
                    <label key={p.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={planAccessIds.includes(p.id)}
                        onChange={(e) =>
                          setPlanAccessIds((prev) =>
                            e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                          )
                        }
                        className="h-4 w-4 accent-[var(--brand-primary)]"
                      />
                      <span className="truncate">{p.displayName ?? p.id}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}
          {planAccessIds.length > 0 && (
            <InfoNote>
              {planAccessIds.length} extra planner{planAccessIds.length === 1 ? "" : "s"}:{" "}
              {planAccessIds.map((id) => playerNameById[id] ?? id).join(", ")}
            </InfoNote>
          )}
        </FieldGroup>
      </div>

      <div className={cn("space-y-4", tab !== "rosters" && "hidden")}>
        <InfoNote>
          Players are picked from the global player list — add someone new under Players first.
          A player can only sit in one tier, on one team.
        </InfoNote>
        {renderTeamSection("teamA", teamA, "Team A")}
        {renderTeamSection("teamB", teamB, "Team B")}
      </div>

      <SaveBar status={dirty ? "Unsaved changes" : "All changes saved"}>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save tournament"}
        </Button>
      </SaveBar>
    </form>
  );
}
