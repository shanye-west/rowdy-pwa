import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import Layout from "../../components/Layout";
import StatusBanner from "../../components/admin/StatusBanner";
import AdminSection from "../../components/admin/AdminSection";
import MatchForm, { type MatchFormPlayer, type MatchFormValues } from "../../components/admin/MatchForm";
import { useAdminTournament } from "../../contexts/AdminTournamentContext";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
import { localInputToStored } from "../../utils/teeTime";
import { formToInput, inputToForm, type HoleFormState } from "../../utils/holeInputForm";
import type { MatchDoc, RoundFormat } from "../../types";
import { isDriveTrackingFormat, isScrambleFormat, isSinglesFormat } from "../../types";

/**
 * Everything for one match in context: edit players/tee time, lock, score
 * override, stroke recalculation, and deletion.
 */
export default function MatchAdmin() {
  const navigate = useNavigate();
  const { matchId = "" } = useParams<{ matchId: string }>();
  const { tournamentId, tournament, players, rounds, loading: ctxLoading } = useAdminTournament();

  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [matchLoading, setMatchLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [holeNum, setHoleNum] = useState("1");
  const [holeForm, setHoleForm] = useState<HoleFormState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const round = rounds.find((r) => r.id === match?.roundId);
  const format = (round?.format ?? "twoManBestBall") as RoundFormat;

  const loadMatch = useCallback(async () => {
    const snap = await getDoc(doc(db, "matches", matchId));
    setMatch(snap.exists() ? ({ id: snap.id, ...snap.data() } as MatchDoc) : null);
  }, [matchId]);

  useEffect(() => {
    setMatchLoading(true);
    loadMatch()
      .catch((err) => setError(getErrorMessage(err, "Failed to load match")))
      .finally(() => setMatchLoading(false));
  }, [loadMatch]);

  // Load hole inputs into the override form whenever the match/hole changes
  useEffect(() => {
    if (!match) {
      setHoleForm(null);
      return;
    }
    setHoleForm(inputToForm(match.holes?.[holeNum]?.input, format));
  }, [match, holeNum, format]);

  const runAction = async (action: () => Promise<string>) => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const message = await action();
      setSuccess(message);
      await loadMatch();
    } catch (err) {
      console.error("Match admin action failed:", err);
      setError(getErrorMessage(err, "Action failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleEditSubmit = (values: MatchFormValues) =>
    runAction(async () => {
      if (values.teamAPlayers.length === 0 || values.teamBPlayers.length === 0) {
        throw new Error("Each team must have at least one player");
      }
      await adminApi.editMatch({
        matchId,
        tournamentId,
        roundId: match!.roundId,
        ...(values.teeTime ? { teeTime: localInputToStored(values.teeTime) } : {}),
        teamAPlayers: values.teamAPlayers.map((p) => ({ playerId: p.playerId, handicapIndex: p.handicapIndex })),
        teamBPlayers: values.teamBPlayers.map((p) => ({ playerId: p.playerId, handicapIndex: p.handicapIndex })),
      });
      return "Match updated. Strokes were recalculated.";
    });

  const handleToggleLock = () =>
    runAction(async () => {
      const next = !match?.locked;
      await adminApi.setMatchLock({ matchId, locked: next });
      return next ? "Match locked." : "Match unlocked.";
    });

  const handleOverride = (e: React.FormEvent) => {
    e.preventDefault();
    if (!holeForm) return;
    runAction(async () => {
      await adminApi.adminOverrideHoleScore({
        matchId,
        hole: Number(holeNum),
        input: formToInput(holeForm, format),
      });
      return `Hole ${holeNum} updated. Status and stats will recompute automatically.`;
    });
  };

  const handleRecalcStrokes = () =>
    runAction(async () => {
      const res = await adminApi.recalculateMatchStrokes({ matchId });
      return `Strokes recalculated. Course handicaps: ${res.courseHandicaps?.join(", ")}`;
    });

  const handleDelete = async () => {
    setError(null);
    setBusy(true);
    try {
      await adminApi.deleteMatch({ matchId });
      navigate(round ? `/admin/t/${tournamentId}/round/${round.id}` : `/admin/t/${tournamentId}`, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to delete match"));
      setBusy(false);
    }
  };

  if (ctxLoading || matchLoading) {
    return (
      <Layout title="Match Admin" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  if (!match || !tournament) {
    return (
      <Layout title="Match Admin" showBack>
        <div className="p-4 space-y-4">
          <StatusBanner error={error ?? "Match not found"} />
          <Link to={`/admin/t/${tournamentId}`} className="btn btn-secondary">Back to Tournament</Link>
        </div>
      </Layout>
    );
  }

  // Prefill the edit form with current players + tournament handicap indexes
  const toFormPlayers = (
    list: MatchDoc["teamAPlayers"],
    handicaps: Record<string, number> | undefined,
    offset: number
  ): MatchFormPlayer[] =>
    (list ?? []).map((p, idx) => ({
      playerId: p.playerId,
      handicapIndex: handicaps?.[p.playerId] ?? 0,
      courseHandicap: match.courseHandicaps?.[offset + idx],
    }));

  const initialTeamA = toFormPlayers(match.teamAPlayers, tournament.teamA?.handicapByPlayer, 0);
  const initialTeamB = toFormPlayers(match.teamBPlayers, tournament.teamB?.handicapByPlayer, match.teamAPlayers?.length ?? 0);

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
    <Layout title={`Match ${match.matchNumber ?? ""}`.trim() || "Match Admin"} showBack>
      <div className="p-4 max-w-2xl mx-auto space-y-4">
        <StatusBanner error={error} success={success} />

        <div className="flex items-center justify-between text-sm text-gray-600">
          <div>
            <span className="font-mono">{match.id}</span>
            {round && <> · Day {round.day} · {round.format || "Format TBD"}</>}
          </div>
          <div className="flex gap-1 text-xs">
            {match.locked && <span className="px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded">🔒 locked</span>}
            {match.status?.closed && <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">closed</span>}
          </div>
        </div>

        {/* Lock / unlock */}
        <AdminSection
          title="Match Lock"
          description={
            match.locked
              ? "This match is locked — players cannot enter scores."
              : "This match is unlocked — rostered players can enter scores (unless the round is locked)."
          }
        >
          <button type="button" onClick={handleToggleLock} disabled={busy} className="btn btn-primary">
            {busy ? "Working..." : match.locked ? "Unlock Match" : "Lock Match"}
          </button>
        </AdminSection>

        {/* Score override */}
        <AdminSection
          title="Score Override"
          description="Replaces the saved input for one hole. Match status, facts, stats, and skins recompute automatically. Leave a field blank to clear that score."
        >
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
        </AdminSection>

        {/* Edit players / tee time */}
        <AdminSection
          title="Edit Match"
          description="Change players or tee time. Strokes are recalculated on save; the handicap index fields override the tournament values for this match."
        >
          <MatchForm
            key={`${match.id}-${match.courseHandicaps?.join(",") ?? ""}`}
            tournament={tournament}
            players={players}
            initial={{ match, teamA: initialTeamA, teamB: initialTeamB }}
            showHandicapOverride
            submitting={busy}
            submitLabel="Update Match"
            onSubmit={handleEditSubmit}
          />
        </AdminSection>

        {/* Recalculate strokes */}
        <AdminSection
          title="Recalculate Strokes"
          description="Re-sync this match's strokesReceived with the tournament's current handicap indexes (GHIN formula, spin-down from lowest)."
        >
          <button type="button" onClick={handleRecalcStrokes} disabled={busy} className="btn btn-primary">
            {busy ? "Working..." : "Recalculate Strokes"}
          </button>
        </AdminSection>

        {/* Delete */}
        <AdminSection
          title="Delete Match"
          description={
            <>
              Permanently deletes this match. Its playerMatchFacts are removed and player stats and
              skins recompute automatically. Type the match ID (<span className="font-mono">{match.id}</span>) to confirm.
            </>
          }
          danger
        >
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
        </AdminSection>

        <div className="flex gap-4">
          <Link to={`/match/${match.id}`} className="btn btn-secondary flex-1 text-center">View Match</Link>
          {round && (
            <Link to={`/admin/t/${tournamentId}/round/${round.id}`} className="btn btn-secondary flex-1 text-center">
              Back to Round
            </Link>
          )}
        </div>
      </div>
    </Layout>
  );
}
