import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { Lock, Hourglass, Trophy, AlertTriangle, CheckCircle2 } from "lucide-react";
import { db } from "../firebase";
import Layout from "../components/Layout";
import { Modal, ModalActions } from "../components/Modal";
import { useAuth } from "../contexts/AuthContext";
import { useRosterPlayers } from "../hooks/admin/useRosterPlayers";
import { usePairingDraft } from "../hooks/usePairingDraft";
import { draftApi } from "../api/draft";
import { getErrorMessage } from "../api/errors";
import { calculateCourseHandicap } from "../utils/ghin";
import { playerTierLookup, tierPlayerIds, type Tier } from "../utils/roster";
import { isScrambleFormat, isShambleFormat } from "../types";
import { lastPlacementTeam, otherTeam } from "../utils/pairingDraft";
import DraftSetup from "../components/pairings/DraftSetup";
import DraftBoard from "../components/pairings/DraftBoard";
import TurnHeader from "../components/pairings/TurnHeader";
import PickPanel from "../components/pairings/PickPanel";
import PairingsMessage from "../components/pairings/PairingsMessage";
import type { PairingsMeta } from "../components/pairings/types";
import type { CourseDoc, DraftTeamKey, RoundDoc, RoundFormat, TournamentDoc } from "../types";

function formatPlayersPerSide(format: RoundFormat | null | undefined): number {
  if (format === "singles") return 1;
  if (format === "fourManScramble") return 4;
  return 2;
}

const TEAM_FALLBACK: Record<DraftTeamKey, string> = { teamA: "Team A", teamB: "Team B" };

/** A board-shaped skeleton shown while the round/draft loads. */
function BoardSkeleton() {
  return (
    <div className="p-4 space-y-2 max-w-2xl mx-auto">
      <div className="h-20 rounded-2xl bg-muted animate-pulse" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
      ))}
    </div>
  );
}

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
  const [confirmAction, setConfirmAction] = useState<"finalize" | "reset" | null>(null);

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
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.displayName || p.id);
    return m;
  }, [players]);

  const teamName = (team: DraftTeamKey) => tournament?.[team]?.name || TEAM_FALLBACK[team];
  const teamColor = (team: DraftTeamKey) =>
    tournament?.[team]?.color || (team === "teamA" ? "var(--team-a-default)" : "var(--team-b-default)");
  const grossOnly = isScrambleFormat(round?.format) || isShambleFormat(round?.format);

  // Shared view-model passed to the draft sub-components.
  const meta: PairingsMeta = {
    players,
    nameOf: (pid) => nameMap.get(pid) ?? pid,
    chOf: (pid) => {
      if (!courseParams) return null;
      const hi = handicapByPlayer[pid];
      if (typeof hi !== "number") return null;
      return Math.round(calculateCourseHandicap(hi, courseParams.slope, courseParams.rating, courseParams.par));
    },
    tierOf: (pid) => tierLookup[pid] as Tier | undefined,
    teamName,
    teamColor,
    grossOnly,
  };

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

  // ===========================================================================
  // Loading / access states
  // ===========================================================================
  if (loadingData || draftLoading) {
    return (
      <Layout title="Pairings" showBack>
        <BoardSkeleton />
      </Layout>
    );
  }

  if (loadError) {
    return (
      <Layout title="Pairings" showBack>
        <PairingsMessage icon={<AlertTriangle size={26} />} title="Couldn't load pairings">
          {loadError}
        </PairingsMessage>
      </Layout>
    );
  }

  // A draft exists but this viewer isn't a captain/co-captain or admin.
  if (denied || (!draft && !isAdmin && !myTeam)) {
    return (
      <Layout title="Pairings" showBack>
        <PairingsMessage icon={<Lock size={24} />} title="Captains & admins only">
          Pairings are set by the team captains and announced in person. Once they're locked in, you'll
          see your matchups on the round page.
        </PairingsMessage>
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
          <PairingsMessage icon={<Hourglass size={24} />} title="Draft hasn't started">
            An admin will open the captains' draft before the round. Check back shortly.
          </PairingsMessage>
        </Layout>
      );
    }
    if (!round?.format) {
      return (
        <Layout title={title} showBack>
          <PairingsMessage icon={<AlertTriangle size={24} />} title="Set the round format first">
            Choose this round's match format before drafting pairings.
          </PairingsMessage>
        </Layout>
      );
    }
    if (!round?.courseId) {
      return (
        <Layout title={title} showBack>
          <PairingsMessage icon={<AlertTriangle size={24} />} title="Set the course first">
            Assign this round's course before drafting pairings.
          </PairingsMessage>
        </Layout>
      );
    }
    return (
      <Layout title={title} showBack>
        <div className="p-4 max-w-2xl mx-auto space-y-4">
          {errorBanner}
          {tournament && (
            <DraftSetup
              tournament={tournament}
              meta={meta}
              perSide={formatPlayersPerSide(round.format)}
              availA={availA}
              availB={availB}
              setAvailA={setAvailA}
              setAvailB={setAvailB}
              firstPick={firstPick}
              setFirstPick={setFirstPick}
              busy={busy}
              onStart={() =>
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
            />
          )}
        </div>
      </Layout>
    );
  }

  // ===========================================================================
  // Finalized
  // ===========================================================================
  if (draft.phase === "finalized") {
    return (
      <Layout title={title} showBack>
        <div className="p-4 space-y-4 max-w-2xl mx-auto">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-sm font-medium text-green-800">
            <CheckCircle2 size={18} /> Matches created for this round.
          </div>
          <DraftBoard draft={draft} meta={meta} />
          <Link to={`/round/${roundId}`} className="btn btn-primary w-full text-center">
            View round
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
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm font-medium text-amber-800">
            <Trophy size={18} />
            {isAdmin ? "Draft complete — review, then create the matches." : "Draft complete — waiting for an admin to confirm."}
          </div>
          <DraftBoard draft={draft} meta={meta} />
          {isAdmin && (
            <div className="space-y-2">
              <button className="btn btn-primary w-full" disabled={busy} onClick={() => setConfirmAction("finalize")}>
                {busy ? "Working…" : `Confirm & create ${draft.totalMatches} matches`}
              </button>
              <button className="btn btn-secondary w-full" disabled={busy} onClick={() => setConfirmAction("reset")}>
                Reset draft
              </button>
            </div>
          )}
        </div>
        {renderConfirmModal()}
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

  const undoTeam = lastPlacementTeam(draft);
  const canUndo = undoTeam != null && (isAdmin || myTeam === undoTeam) && !busy;

  const submitPick = () =>
    run(async () => {
      await draftApi.submitDraftPick({ roundId, team: actingTeam, playerIds: selected });
      navigator.vibrate?.(40);
    }, "Pick failed");
  const doUndo = () => run(() => draftApi.undoDraftPick({ roundId, team: undoTeam! }), "Undo failed");

  return (
    <Layout title={title} showBack>
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {errorBanner}

        <TurnHeader draft={draft} actingTeam={actingTeam} meta={meta} isResponse={isResponse} myMove={myMove} />

        <DraftBoard draft={draft} meta={meta} />

        {myMove ? (
          <PickPanel
            draft={draft}
            actingTeam={actingTeam}
            meta={meta}
            isResponse={isResponse}
            nominatedIds={nominatedIds ?? null}
            selected={selected}
            busy={busy}
            canUndo={canUndo}
            onToggleSelect={(pid) => togglePlayer(pid, draft.playersPerSide)}
            onSubmit={submitPick}
            onUndo={doUndo}
          />
        ) : (
          canUndo && (
            <button className="btn btn-secondary w-full" disabled={busy} onClick={doUndo}>
              Undo last pick
            </button>
          )
        )}
      </div>
    </Layout>
  );

  // ===========================================================================
  // Confirm modal (finalize / reset)
  // ===========================================================================
  function renderConfirmModal() {
    const open = confirmAction !== null;
    const isFinalize = confirmAction === "finalize";
    return (
      <Modal
        isOpen={open}
        onClose={() => setConfirmAction(null)}
        title={isFinalize ? "Create matches?" : "Reset draft?"}
      >
        <p className="mb-5 text-center text-sm text-muted-foreground">
          {isFinalize
            ? `This locks the pairings and creates ${draft?.totalMatches ?? ""} matches for the round.`
            : "This discards the current pairings and returns to setup."}
        </p>
        <ModalActions
          primaryLabel={isFinalize ? "Create matches" : "Reset draft"}
          primaryClass={isFinalize ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
          onPrimary={() => {
            const action = confirmAction;
            setConfirmAction(null);
            if (action === "finalize") {
              run(async () => {
                await draftApi.finalizePairingDraft({ roundId });
                navigator.vibrate?.([30, 40, 30]);
              }, "Failed to create matches");
            } else if (action === "reset") {
              run(() => draftApi.resetPairingDraft({ roundId }), "Failed to reset");
            }
          }}
          secondaryLabel="Cancel"
          onSecondary={() => setConfirmAction(null)}
        />
      </Modal>
    );
  }
}
