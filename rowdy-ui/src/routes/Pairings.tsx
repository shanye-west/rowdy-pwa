import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import Layout from "../components/Layout";
import { useAuth } from "../contexts/AuthContext";
import { useRosterPlayers } from "../hooks/admin/useRosterPlayers";
import { usePairingDraft } from "../hooks/usePairingDraft";
import { draftApi } from "../api/draft";
import { getErrorMessage } from "../api/errors";
import { calculateCourseHandicap } from "../utils/ghin";
import { playerTierLookup, tierPlayerIds } from "../utils/roster";
import { isScrambleFormat, isShambleFormat } from "../types";
import {
  lastPlacementTeam,
  otherTeam,
  pairTierViolation,
  remainingPlayerIds,
} from "../utils/pairingDraft";
import type { CourseDoc, DraftTeamKey, RoundDoc, RoundFormat, TournamentDoc } from "../types";

function formatPlayersPerSide(format: RoundFormat | null | undefined): number {
  if (format === "singles") return 1;
  if (format === "fourManScramble") return 4;
  return 2;
}

const TEAM_FALLBACK: Record<DraftTeamKey, string> = { teamA: "Team A", teamB: "Team B" };

export default function Pairings() {
  const { roundId = "" } = useParams<{ roundId: string }>();
  const { player } = useAuth();

  // Supporting data (all public-read): the round, its tournament, and course.
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The live, captain/admin-gated draft doc.
  const { draft, loading: draftLoading, denied } = usePairingDraft(roundId);
  const { players } = useRosterPlayers(tournament);

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  // Setup form state (admin, pre-draft).
  const [availA, setAvailA] = useState<Set<string>>(new Set());
  const [availB, setAvailB] = useState<Set<string>>(new Set());
  const [firstPick, setFirstPick] = useState<DraftTeamKey>("teamA");

  useEffect(() => {
    if (!roundId) return;
    let cancelled = false;
    (async () => {
      setLoadingData(true);
      setLoadError(null);
      try {
        const rSnap = await getDoc(doc(db, "rounds", roundId));
        if (!rSnap.exists()) {
          if (!cancelled) setLoadError("Round not found");
          return;
        }
        const r = { id: rSnap.id, ...rSnap.data() } as RoundDoc;
        const [tSnap, cSnap] = await Promise.all([
          r.tournamentId ? getDoc(doc(db, "tournaments", r.tournamentId)) : Promise.resolve(null),
          r.courseId ? getDoc(doc(db, "courses", r.courseId)) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setRound(r);
        setTournament(tSnap?.exists() ? ({ id: tSnap.id, ...tSnap.data() } as TournamentDoc) : null);
        setCourse(cSnap?.exists() ? ({ id: cSnap.id, ...cSnap.data() } as CourseDoc) : null);
      } catch (e) {
        if (!cancelled) setLoadError(getErrorMessage(e, "Failed to load round"));
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roundId]);

  // Default every rostered player to "available" once the tournament loads.
  useEffect(() => {
    if (!tournament) return;
    setAvailA(new Set(tierPlayerIds(tournament.teamA?.rosterByTier)));
    setAvailB(new Set(tierPlayerIds(tournament.teamB?.rosterByTier)));
  }, [tournament]);

  // Clear the in-progress selection whenever the turn changes.
  const turnKey = draft?.turn ? `${draft.turn.matchIndex}-${draft.turn.awaiting}-${draft.turn.team}` : draft?.phase;
  useEffect(() => {
    setSelected([]);
    setActionError(null);
  }, [turnKey]);

  // ---- Derived lookups ----
  const isAdmin = !!player?.isAdmin;
  const myTeam: DraftTeamKey | null = useMemo(() => {
    if (!player || !tournament) return null;
    const inTeam = (team: DraftTeamKey) =>
      [tournament[team]?.captainId, tournament[team]?.coCaptainId].filter(Boolean).includes(player.id);
    if (inTeam("teamA")) return "teamA";
    if (inTeam("teamB")) return "teamB";
    return null;
  }, [player, tournament]);
  const canAct = (team: DraftTeamKey) => isAdmin || myTeam === team;

  const handicapByPlayer = useMemo(
    () => ({ ...(tournament?.teamA?.handicapByPlayer || {}), ...(tournament?.teamB?.handicapByPlayer || {}) }),
    [tournament]
  );
  const courseParams = useMemo(() => {
    if (!course) return null;
    return {
      slope: course.slope ?? 113,
      rating: typeof course.rating === "number" ? course.rating : course.par ?? 72,
      par: course.par ?? 72,
    };
  }, [course]);

  const tierLookup = useMemo(
    () => draft?.tierByPlayer ?? playerTierLookup(tournament),
    [draft, tournament]
  );
  const nameOf = (pid: string) => players.find((p) => p.id === pid)?.displayName || pid;
  const chOf = (pid: string): number | null => {
    if (!courseParams) return null;
    const hi = handicapByPlayer[pid];
    if (typeof hi !== "number") return null;
    return Math.round(calculateCourseHandicap(hi, courseParams.slope, courseParams.rating, courseParams.par));
  };
  const teamName = (team: DraftTeamKey) => tournament?.[team]?.name || TEAM_FALLBACK[team];
  const teamColor = (team: DraftTeamKey) =>
    tournament?.[team]?.color || (team === "teamA" ? "var(--team-a-default)" : "var(--team-b-default)");

  const grossOnly = isScrambleFormat(round?.format) || isShambleFormat(round?.format);

  // ---- Actions ----
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(getErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const togglePlayer = (pid: string, perSide: number) => {
    setSelected((prev) => {
      if (prev.includes(pid)) return prev.filter((x) => x !== pid);
      const next = [...prev, pid];
      return next.length > perSide ? next.slice(next.length - perSide) : next;
    });
  };

  // ---- Player chip ----
  const Chip = ({ pid }: { pid: string }) => {
    const tier = tierLookup[pid];
    const ch = chOf(pid);
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-medium">{nameOf(pid)}</span>
        {tier && <span className="text-[10px] px-1 rounded bg-gray-200 text-gray-700 font-semibold">{tier}</span>}
        {ch != null && <span className="text-[10px] text-gray-500">CH {ch}</span>}
      </span>
    );
  };

  // ===========================================================================
  // Loading / access states
  // ===========================================================================
  if (loadingData || draftLoading) {
    return (
      <Layout title="Pairings" showBack>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="spinner-lg" />
        </div>
      </Layout>
    );
  }

  if (loadError) {
    return (
      <Layout title="Pairings" showBack>
        <div className="p-4 text-red-600">{loadError}</div>
      </Layout>
    );
  }

  // A draft exists but this viewer isn't a captain/co-captain or admin.
  if (denied || (!draft && !isAdmin && !myTeam)) {
    return (
      <Layout title="Pairings" showBack>
        <div className="p-6 max-w-md mx-auto text-center space-y-2">
          <h2 className="text-lg font-bold">Captains & admins only</h2>
          <p className="text-sm text-gray-600">
            Pairings are set by the team captains and announced in person. This page is limited to captains,
            co-captains, and admins.
          </p>
        </div>
      </Layout>
    );
  }

  const title = `Pairings — Day ${round?.day ?? ""}`.trim();
  const errorBanner = actionError && (
    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{actionError}</div>
  );

  // ===========================================================================
  // No draft yet
  // ===========================================================================
  if (!draft) {
    if (!isAdmin) {
      return (
        <Layout title={title} showBack>
          <div className="p-6 max-w-md mx-auto text-center text-sm text-gray-600">
            The pairings draft hasn't been set up yet. An admin will start it before the round.
          </div>
        </Layout>
      );
    }
    return (
      <Layout title={title} showBack>
        {renderSetup()}
      </Layout>
    );
  }

  const perSide = draft.playersPerSide;

  // ===========================================================================
  // Board (shared by drafting / review / finalized)
  // ===========================================================================
  const Board = () => (
    <div className="space-y-2">
      {draft.matches.map((m, i) => {
        const isCurrent = draft.turn?.matchIndex === i;
        return (
          <div
            key={m.matchNumber}
            className={`rounded-lg border p-3 ${isCurrent ? "border-blue-400 bg-blue-50/40" : "border-gray-200"}`}
          >
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>Match {m.matchNumber}</span>
              <span>nominated by {teamName(m.nominatedBy)}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
              <SlotView team="teamA" ids={m.teamAPlayers} />
              <span className="text-gray-400 text-xs">vs</span>
              <SlotView team="teamB" ids={m.teamBPlayers} alignRight />
            </div>
          </div>
        );
      })}
    </div>
  );

  function SlotView({
    team,
    ids,
    alignRight,
  }: {
    team: DraftTeamKey;
    ids: string[] | null;
    alignRight?: boolean;
  }) {
    return (
      <div className={alignRight ? "text-right" : ""}>
        {ids && ids.length ? (
          <div className="flex flex-col gap-0.5">
            {ids.map((pid) => (
              <Chip key={pid} pid={pid} />
            ))}
          </div>
        ) : (
          <span className="text-gray-300" style={{ color: teamColor(team) }}>
            — pending —
          </span>
        )}
      </div>
    );
  }

  // ===========================================================================
  // Finalized
  // ===========================================================================
  if (draft.phase === "finalized") {
    return (
      <Layout title={title} showBack>
        <div className="p-4 space-y-4 max-w-2xl mx-auto">
          <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
            ✓ Matches created for this round.
          </div>
          <Board />
          <Link to={`/round/${roundId}`} className="btn btn-primary w-full text-center">
            View Round
          </Link>
        </div>
      </Layout>
    );
  }

  // ===========================================================================
  // Review (snake complete, awaiting admin confirm)
  // ===========================================================================
  if (draft.phase === "review") {
    return (
      <Layout title={title} showBack>
        <div className="p-4 space-y-4 max-w-2xl mx-auto">
          {errorBanner}
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            Draft complete. {isAdmin ? "Review the pairings, then create the matches." : "Waiting for an admin to confirm."}
          </div>
          <Board />
          {isAdmin && (
            <div className="space-y-2">
              <button
                className="btn btn-primary w-full"
                disabled={busy}
                onClick={() =>
                  run(
                    () => draftApi.finalizePairingDraft({ roundId }),
                    "Failed to create matches"
                  )
                }
              >
                {busy ? "Creating..." : `Confirm & create ${draft.totalMatches} matches`}
              </button>
              <button
                className="btn btn-secondary w-full"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Reset the draft? This discards the current pairings.")) {
                    run(() => draftApi.resetPairingDraft({ roundId }), "Failed to reset");
                  }
                }}
              >
                Reset draft
              </button>
            </div>
          )}
        </div>
      </Layout>
    );
  }

  // ===========================================================================
  // Drafting
  // ===========================================================================
  const turn = draft.turn!;
  const actingTeam = turn.team;
  const opponent = otherTeam(actingTeam);
  const myMove = canAct(actingTeam);
  const isResponse = turn.awaiting === "response";
  const nominatedIds = isResponse ? draft.matches[turn.matchIndex]?.[`${opponent}Players`] : null;
  const remaining = remainingPlayerIds(draft, actingTeam);
  const violation = pairTierViolation(selected, draft.tierByPlayer);
  const canSubmit = myMove && selected.length === perSide && !violation && !busy;

  const undoTeam = lastPlacementTeam(draft);
  const canUndo = undoTeam != null && (isAdmin || myTeam === undoTeam) && !busy;

  return (
    <Layout title={title} showBack>
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {errorBanner}

        {/* Turn banner */}
        <div className="rounded-lg p-3 text-white" style={{ background: teamColor(actingTeam) }}>
          <div className="text-sm opacity-90">Match {turn.matchIndex + 1} of {draft.totalMatches}</div>
          <div className="font-bold">
            {teamName(actingTeam)} to {isResponse ? "respond" : "nominate"}
            {myMove ? " — your move" : ""}
          </div>
          {!myMove && <div className="text-xs opacity-90">Waiting for {teamName(actingTeam)}…</div>}
        </div>

        <Board />

        {/* Pick panel */}
        {myMove ? (
          <div className="card p-4 space-y-3">
            <div className="font-semibold" style={{ color: teamColor(actingTeam) }}>
              {isResponse
                ? `Choose who faces match ${turn.matchIndex + 1}`
                : `Nominate ${teamName(actingTeam)} for match ${turn.matchIndex + 1}`}
            </div>
            {isResponse && nominatedIds && (
              <div className="text-xs text-gray-600">
                Facing: {nominatedIds.map((pid) => nameOf(pid)).join(" / ")}
              </div>
            )}
            <div className="text-xs text-gray-500">
              Pick {perSide} player{perSide > 1 ? "s" : ""}.
              {perSide === 2 && " No two A-tier and no two D-tier together."}
              {grossOnly && " Course handicaps shown for reference (gross play, no strokes applied)."}
            </div>
            <div className="flex flex-wrap gap-2">
              {remaining.map((pid) => {
                const on = selected.includes(pid);
                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => togglePlayer(pid, perSide)}
                    className={`px-3 py-2 rounded-lg border text-sm ${
                      on ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <Chip pid={pid} />
                  </button>
                );
              })}
              {remaining.length === 0 && <span className="text-sm text-gray-500">No players left.</span>}
            </div>
            {violation && <div className="text-xs text-red-600">{violation}</div>}
            <div className="flex gap-2">
              <button
                className="btn btn-primary flex-1"
                disabled={!canSubmit}
                onClick={() => run(() => draftApi.submitDraftPick({ roundId, team: actingTeam, playerIds: selected }), "Pick failed")}
              >
                {busy ? "Submitting..." : isResponse ? "Confirm matchup" : "Nominate"}
              </button>
              {canUndo && (
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => run(() => draftApi.undoDraftPick({ roundId, team: undoTeam! }), "Undo failed")}
                >
                  Undo
                </button>
              )}
            </div>
          </div>
        ) : (
          canUndo && (
            <button
              className="btn btn-secondary w-full"
              disabled={busy}
              onClick={() => run(() => draftApi.undoDraftPick({ roundId, team: undoTeam! }), "Undo failed")}
            >
              Undo last pick
            </button>
          )
        )}
      </div>
    </Layout>
  );

  // ===========================================================================
  // Setup form (admin, pre-draft)
  // ===========================================================================
  function renderSetup() {
    if (!tournament || !round) return null;
    if (!round.format) {
      return <div className="p-4 text-sm text-red-600">Set this round's format before drafting pairings.</div>;
    }
    if (!round.courseId) {
      return <div className="p-4 text-sm text-red-600">Set this round's course before drafting pairings.</div>;
    }
    const setupPerSide = formatPlayersPerSide(round.format);
    const countA = availA.size;
    const countB = availB.size;
    const balanced = countA === countB && countA > 0 && countA % setupPerSide === 0;
    const totalMatches = balanced ? countA / setupPerSide : 0;

    const TeamPicker = ({ team, sel, setSel }: { team: DraftTeamKey; sel: Set<string>; setSel: (s: Set<string>) => void }) => {
      const ids = tierPlayerIds(tournament[team]?.rosterByTier);
      return (
        <div className="card p-4">
          <h3 className="font-bold mb-2" style={{ color: teamColor(team) }}>
            {teamName(team)} <span className="text-xs text-gray-500">({sel.size} available)</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {ids.map((pid) => {
              const on = sel.has(pid);
              return (
                <button
                  key={pid}
                  type="button"
                  onClick={() => {
                    const next = new Set(sel);
                    if (next.has(pid)) next.delete(pid);
                    else next.add(pid);
                    setSel(next);
                  }}
                  className={`px-3 py-2 rounded-lg border text-sm ${
                    on ? "border-green-500 bg-green-50" : "border-gray-200 text-gray-400 line-through"
                  }`}
                >
                  <Chip pid={pid} />
                </button>
              );
            })}
            {ids.length === 0 && <span className="text-sm text-gray-500">No roster set for this team.</span>}
          </div>
        </div>
      );
    };

    return (
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {errorBanner}
        <div className="text-sm text-gray-600">
          Tap to sit a player out. Then record the coin-flip winner (the captain who nominates match 1) and start the
          draft. {setupPerSide === 2 && "Pairs can't be two A-tier or two D-tier players."}
        </div>

        <TeamPicker team="teamA" sel={availA} setSel={setAvailA} />
        <TeamPicker team="teamB" sel={availB} setSel={setAvailB} />

        <div className="card p-4 space-y-2">
          <div className="font-semibold">Who nominates first? (coin-flip winner)</div>
          <div className="flex gap-2">
            {(["teamA", "teamB"] as DraftTeamKey[]).map((team) => (
              <button
                key={team}
                type="button"
                onClick={() => setFirstPick(team)}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium ${
                  firstPick === team ? "border-blue-500 bg-blue-50" : "border-gray-200"
                }`}
              >
                {teamName(team)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="text-xs text-blue-600 hover:underline"
            onClick={() => setFirstPick(Math.random() < 0.5 ? "teamA" : "teamB")}
          >
            🪙 Flip a coin
          </button>
        </div>

        {!balanced && (
          <div className="text-xs text-amber-700">
            Both teams need the same number of available players, divisible by {setupPerSide}. Currently {countA} vs{" "}
            {countB}.
          </div>
        )}

        <button
          className="btn btn-primary w-full"
          disabled={!balanced || busy}
          onClick={() =>
            run(
              () =>
                draftApi.createPairingDraft({
                  roundId,
                  availableTeamA: [...availA],
                  availableTeamB: [...availB],
                  firstPickTeam: firstPick,
                }),
              "Failed to start draft"
            )
          }
        >
          {busy ? "Starting..." : balanced ? `Start draft (${totalMatches} matches)` : "Start draft"}
        </button>
      </div>
    );
  }
}
