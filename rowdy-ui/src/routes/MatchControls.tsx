import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import Layout from "../components/Layout";
import type { TournamentDoc, RoundDoc, MatchDoc, RoundFormat, HoleInputLoose } from "../types";
import { isSinglesFormat, isScrambleFormat, isDriveTrackingFormat } from "../types";

/** Editable text state for one hole's inputs (all values as strings, "" = null) */
interface HoleFormState {
  aGross: string;      // singles player gross OR scramble team gross
  bGross: string;
  aGross2: string;     // second player (best ball / shamble)
  bGross2: string;
  aDrive: string;      // "" | "0" | "1"
  bDrive: string;
}

function inputToForm(input: HoleInputLoose | undefined, format: RoundFormat): HoleFormState {
  const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  if (isSinglesFormat(format)) {
    return { aGross: str(input?.teamAPlayerGross), bGross: str(input?.teamBPlayerGross), aGross2: "", bGross2: "", aDrive: "", bDrive: "" };
  }
  if (isScrambleFormat(format)) {
    return { aGross: str(input?.teamAGross), bGross: str(input?.teamBGross), aGross2: "", bGross2: "", aDrive: str(input?.teamADrive), bDrive: str(input?.teamBDrive) };
  }
  // best ball / shamble
  return {
    aGross: str(input?.teamAPlayersGross?.[0]),
    aGross2: str(input?.teamAPlayersGross?.[1]),
    bGross: str(input?.teamBPlayersGross?.[0]),
    bGross2: str(input?.teamBPlayersGross?.[1]),
    aDrive: str(input?.teamADrive),
    bDrive: str(input?.teamBDrive),
  };
}

function formToInput(form: HoleFormState, format: RoundFormat): Record<string, unknown> {
  const num = (s: string) => (s === "" ? null : Number(s));
  if (isSinglesFormat(format)) {
    return { teamAPlayerGross: num(form.aGross), teamBPlayerGross: num(form.bGross) };
  }
  if (isScrambleFormat(format)) {
    return {
      teamAGross: num(form.aGross),
      teamBGross: num(form.bGross),
      teamADrive: num(form.aDrive),
      teamBDrive: num(form.bDrive),
    };
  }
  const input: Record<string, unknown> = {
    teamAPlayersGross: [num(form.aGross), num(form.aGross2)],
    teamBPlayersGross: [num(form.bGross), num(form.bGross2)],
  };
  if (isDriveTrackingFormat(format)) {
    input.teamADrive = num(form.aDrive);
    input.teamBDrive = num(form.bDrive);
  }
  return input;
}

export default function MatchControls() {
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState<TournamentDoc[]>([]);
  const [rounds, setRounds] = useState<RoundDoc[]>([]);
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [tournamentId, setTournamentId] = useState("");
  const [roundId, setRoundId] = useState("");
  const [matchId, setMatchId] = useState("");

  const [holeNum, setHoleNum] = useState("1");
  const [holeForm, setHoleForm] = useState<HoleFormState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const match = matches.find((m) => m.id === matchId);
  const round = rounds.find((r) => r.id === roundId);
  const format = (round?.format ?? "twoManBestBall") as RoundFormat;

  useEffect(() => {
    getDocs(query(collection(db, "tournaments"), orderBy("year", "desc")))
      .then((snap) => setTournaments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TournamentDoc))))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tournaments"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setRoundId("");
    setRounds([]);
    if (!tournamentId) return;
    getDocs(query(collection(db, "rounds"), where("tournamentId", "==", tournamentId)))
      .then((snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RoundDoc));
        setRounds(data.sort((a, b) => (a.day ?? 0) - (b.day ?? 0)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load rounds"));
  }, [tournamentId]);

  const fetchMatches = useCallback(async (rId: string) => {
    const snap = await getDocs(query(collection(db, "matches"), where("roundId", "==", rId)));
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as MatchDoc));
    setMatches(data.sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0)));
  }, []);

  useEffect(() => {
    setMatchId("");
    setMatches([]);
    setHoleForm(null);
    if (!roundId) return;
    fetchMatches(roundId).catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load matches")
    );
  }, [roundId, fetchMatches]);

  // Load hole inputs into the form whenever the selected match/hole changes
  useEffect(() => {
    if (!match) {
      setHoleForm(null);
      return;
    }
    setHoleForm(inputToForm(match.holes?.[holeNum]?.input, format));
  }, [matchId, holeNum, match, format]);

  const runAction = async (action: () => Promise<string>) => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const message = await action();
      setSuccess(message);
      await fetchMatches(roundId);
    } catch (err) {
      console.error("Match control action failed:", err);
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleLock = () =>
    runAction(async () => {
      const fn = httpsCallable(functions, "setMatchLock");
      const next = !match?.locked;
      await fn({ matchId, locked: next });
      return next ? "Match locked." : "Match unlocked.";
    });

  const handleOverride = (e: React.FormEvent) => {
    e.preventDefault();
    if (!holeForm) return;
    runAction(async () => {
      const fn = httpsCallable(functions, "adminOverrideHoleScore");
      await fn({ matchId, hole: Number(holeNum), input: formToInput(holeForm, format) });
      return `Hole ${holeNum} updated. Status and stats will recompute automatically.`;
    });
  };

  const handleDelete = () =>
    runAction(async () => {
      const fn = httpsCallable(functions, "deleteMatch");
      await fn({ matchId });
      setMatchId("");
      setDeleteConfirm("");
      return "Match deleted. Facts, stats, and skins recompute automatically.";
    });

  if (loading) {
    return (
      <Layout title="Match Controls" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  const matchLabel = (m: MatchDoc) => {
    const a = m.teamAPlayers?.map((p) => p.playerId).join("/") || "?";
    const b = m.teamBPlayers?.map((p) => p.playerId).join("/") || "?";
    return `Match ${m.matchNumber ?? m.id.slice(-4)} — ${a} vs ${b}${m.locked ? " 🔒" : ""}`;
  };

  const driveSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <div>
      <label className="block text-xs font-semibold mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg">
        <option value="">No drive</option>
        <option value="0">Player 1</option>
        <option value="1">Player 2</option>
      </select>
    </div>
  );

  const grossInput = (value: string, onChange: (v: string) => void, label: string) => (
    <div>
      <label className="block text-xs font-semibold mb-1">{label}</label>
      <input
        type="number"
        min="1"
        max="30"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="w-full p-2 border border-gray-300 rounded-lg"
      />
    </div>
  );

  return (
    <Layout title="Match Controls" showBack>
      <div className="p-4 max-w-2xl mx-auto space-y-4">
        <div className="card p-6">
          <p className="text-sm text-gray-600 mb-6">
            Lock/unlock a match, fix a wrong score, or delete a match entirely.
          </p>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}
          {success && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 text-sm">✓ {success}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Tournament</label>
              <select
                value={tournamentId}
                onChange={(e) => setTournamentId(e.target.value)}
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
              <div>
                <label className="block text-sm font-semibold mb-2">Round</label>
                <select
                  value={roundId}
                  onChange={(e) => setRoundId(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                >
                  <option value="">Select Round</option>
                  {rounds.map((r) => (
                    <option key={r.id} value={r.id}>
                      Day {r.day} — {r.format || "Format TBD"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {roundId && (
              <div>
                <label className="block text-sm font-semibold mb-2">Match</label>
                <select
                  value={matchId}
                  onChange={(e) => { setMatchId(e.target.value); setDeleteConfirm(""); setSuccess(null); }}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                >
                  <option value="">Select Match</option>
                  {matches.map((m) => (
                    <option key={m.id} value={m.id}>{matchLabel(m)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {match && (
          <>
            {/* Lock / unlock */}
            <div className="card p-6">
              <h2 className="font-bold mb-2">Match Lock</h2>
              <p className="text-sm text-gray-600 mb-4">
                {match.locked
                  ? "This match is locked — players cannot enter scores."
                  : "This match is unlocked — rostered players can enter scores (unless the round is locked)."}
              </p>
              <button type="button" onClick={handleToggleLock} disabled={busy} className="btn btn-primary">
                {busy ? "Working..." : match.locked ? "Unlock Match" : "Lock Match"}
              </button>
            </div>

            {/* Score override */}
            <div className="card p-6">
              <h2 className="font-bold mb-2">Score Override</h2>
              <p className="text-sm text-gray-600 mb-4">
                Replaces the saved input for one hole. Match status, facts, stats, and skins
                recompute automatically. Leave a field blank to clear that score.
              </p>
              <form onSubmit={handleOverride} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">Hole</label>
                  <select
                    value={holeNum}
                    onChange={(e) => setHoleNum(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-lg"
                  >
                    {Array.from({ length: 18 }, (_, i) => String(i + 1)).map((h) => (
                      <option key={h} value={h}>Hole {h}</option>
                    ))}
                  </select>
                </div>

                {holeForm && (
                  <div className="grid grid-cols-2 gap-3">
                    {isSinglesFormat(format) || isScrambleFormat(format) ? (
                      <>
                        {grossInput(holeForm.aGross, (v) => setHoleForm({ ...holeForm, aGross: v }), isScrambleFormat(format) ? "Team A gross" : "Team A player gross")}
                        {grossInput(holeForm.bGross, (v) => setHoleForm({ ...holeForm, bGross: v }), isScrambleFormat(format) ? "Team B gross" : "Team B player gross")}
                      </>
                    ) : (
                      <>
                        {grossInput(holeForm.aGross, (v) => setHoleForm({ ...holeForm, aGross: v }), "Team A player 1 gross")}
                        {grossInput(holeForm.aGross2, (v) => setHoleForm({ ...holeForm, aGross2: v }), "Team A player 2 gross")}
                        {grossInput(holeForm.bGross, (v) => setHoleForm({ ...holeForm, bGross: v }), "Team B player 1 gross")}
                        {grossInput(holeForm.bGross2, (v) => setHoleForm({ ...holeForm, bGross2: v }), "Team B player 2 gross")}
                      </>
                    )}
                    {isDriveTrackingFormat(format) && (
                      <>
                        {driveSelect(holeForm.aDrive, (v) => setHoleForm({ ...holeForm, aDrive: v }), "Team A drive")}
                        {driveSelect(holeForm.bDrive, (v) => setHoleForm({ ...holeForm, bDrive: v }), "Team B drive")}
                      </>
                    )}
                  </div>
                )}

                <button type="submit" disabled={busy} className="btn btn-primary">
                  {busy ? "Saving..." : `Save Hole ${holeNum}`}
                </button>
              </form>
            </div>

            {/* Delete */}
            <div className="card p-6 border-2 border-red-200">
              <h2 className="font-bold mb-2 text-red-700">Delete Match</h2>
              <p className="text-sm text-gray-600 mb-4">
                Permanently deletes this match. Its playerMatchFacts are removed and player
                stats and skins recompute automatically. Type the match ID
                (<span className="font-mono">{match.id}</span>) to confirm.
              </p>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="Type match ID to confirm"
                  className="flex-1 p-2 border border-gray-300 rounded-lg font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy || deleteConfirm !== match.id}
                  className="btn bg-red-600 text-white disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="flex gap-4">
              <button type="button" onClick={() => navigate(`/match/${match.id}`)} className="btn btn-secondary flex-1">
                View Match
              </button>
              <Link to="/admin" className="btn btn-secondary flex-1 text-center">Back to Admin</Link>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
