import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import Layout from "../components/Layout";
import StatusBanner from "../components/admin/StatusBanner";
import { useAdminTournaments } from "../hooks/admin/useAdminTournaments";
import { adminApi } from "../api/admin";
import { getErrorMessage } from "../api/errors";
import type { TournamentDoc, PlayerDoc, TierMap } from "../types";

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
    const ids = form.rosterByTier[tier]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    roster[tier] = ids;
  });
  return roster;
}

export default function ManageTournament() {
  const { tournaments, loading: tournamentsLoading, error: tournamentsError, refresh } = useAdminTournaments();
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [tournamentId, setTournamentId] = useState("");
  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  const [active, setActive] = useState(false);
  const [openPublicEdits, setOpenPublicEdits] = useState(false);
  const [test, setTest] = useState(false);
  const [teamA, setTeamA] = useState<TeamFormState>(teamToForm(undefined));
  const [teamB, setTeamB] = useState<TeamFormState>(teamToForm(undefined));

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const pSnap = await getDocs(collection(db, "players"));
        setPlayers(
          pSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as PlayerDoc))
            .sort((a, b) => (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id))
        );
      } catch (err) {
        console.error("Error loading players:", err);
        setError(getErrorMessage(err, "Failed to load players"));
      } finally {
        setLoading(false);
      }
    };
    fetchPlayers();
  }, []);

  const playerNameById = useMemo(() => {
    const map: Record<string, string> = {};
    players.forEach((p) => { map[p.id] = p.displayName ?? p.id; });
    return map;
  }, [players]);

  const selectTournament = (id: string) => {
    setTournamentId(id);
    setSuccess(null);
    setError(null);
    const t = tournaments.find((x) => x.id === id);
    if (!t) return;
    setName(t.name ?? "");
    setYear(String(t.year ?? ""));
    setActive(!!t.active);
    setOpenPublicEdits(!!t.openPublicEdits);
    setTest(!!t.test);
    setTeamA(teamToForm(t.teamA));
    setTeamB(teamToForm(t.teamB));
  };

  // Players currently rostered on a team (for captain selects + handicap rows)
  const rosteredIds = (form: TeamFormState): string[] => {
    const roster = parseRoster(form);
    return TIERS.flatMap((tier) => roster[tier] ?? []);
  };

  const updateTeam = (key: TeamKey, patch: Partial<TeamFormState>) => {
    const setter = key === "teamA" ? setTeamA : setTeamB;
    setter((prev) => ({ ...prev, ...patch }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
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

      const updates = {
        name,
        year: Number(year),
        active,
        openPublicEdits,
        test,
        teamA: buildTeam(teamA),
        teamB: buildTeam(teamB),
      };

      await adminApi.updateTournament({ tournamentId, updates });
      setSuccess("Tournament updated.");
      // Refresh the list so re-selecting shows saved values
      await refresh();
    } catch (err) {
      console.error("Error updating tournament:", err);
      setError(getErrorMessage(err, "Failed to update tournament"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || tournamentsLoading) {
    return (
      <Layout title="Manage Tournament" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

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
    <Layout title="Manage Tournament" showBack>
      <div className="p-4 max-w-2xl mx-auto">
        <div className="card p-6">
          <p className="text-sm text-gray-600 mb-6">
            Edit tournament settings, team rosters, captains, and handicaps. Replaces the
            seed-handicaps and toggle-open-public-edits scripts.
          </p>

          <StatusBanner error={error ?? tournamentsError} success={success} />

          <div className="mb-6">
            <label className="block text-sm font-semibold mb-2">Tournament</label>
            <select
              value={tournamentId}
              onChange={(e) => selectTournament(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg"
            >
              <option value="">Select Tournament</option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.year} {t.name} {t.active ? "(active)" : ""}{t.test ? " [test]" : ""}
                </option>
              ))}
            </select>
          </div>

          {tournamentId && (
            <form onSubmit={handleSubmit} className="space-y-6">
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
                  <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />
                  <span className="font-semibold">Test tournament</span>
                </label>
              </div>

              {renderTeamSection("teamA", teamA, "Team A")}
              {renderTeamSection("teamB", teamB, "Team B")}

              <div className="flex gap-4">
                <button type="submit" disabled={submitting} className="btn btn-primary flex-1">
                  {submitting ? "Saving..." : "Save Tournament"}
                </button>
                <Link to="/admin" className="btn btn-secondary">Cancel</Link>
              </div>
            </form>
          )}

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            <div className="font-semibold mb-1">Player IDs for roster editing:</div>
            <div className="break-words">{players.map((p) => p.id).join(", ") || "No players found"}</div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
