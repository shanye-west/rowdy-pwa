import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Lock, Hourglass, Trophy, AlertTriangle, CheckCircle2, ClipboardList, Dices } from "lucide-react";
import Layout from "../components/Layout";
import { Modal, ModalActions } from "../components/Modal";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import { Skeleton } from "../components/Skeleton";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useRosterPlayers } from "../hooks/admin/useRosterPlayers";
import { usePairingDraft } from "../hooks/usePairingDraft";
import {
  captainTeamOf,
  formatPlayersPerSide,
  usePairingsMeta,
  useRoundPairingData,
} from "../hooks/usePairingsData";
import { draftApi } from "../api/draft";
import { getErrorMessage } from "../api/errors";
import { tierPlayerIds } from "../utils/roster";
import { lastPlacementTeam, otherTeam } from "../utils/pairingDraft";
import DraftSetup from "../components/pairings/DraftSetup";
import DraftBoard from "../components/pairings/DraftBoard";
import TeamFlipPicker from "../components/pairings/TeamFlipPicker";
import TurnHeader from "../components/pairings/TurnHeader";
import PickPanel from "../components/pairings/PickPanel";
import WaitingPanel from "../components/pairings/WaitingPanel";
import PairingsMessage from "../components/pairings/PairingsMessage";
import type { DraftTeamKey } from "../types";

/** A board-shaped skeleton shown while the round/draft loads. */
function BoardSkeleton() {
  return (
    <div className="p-4 space-y-2 max-w-2xl mx-auto">
      <Skeleton height={80} rounded="lg" className="rounded-2xl" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={64} rounded="lg" className="rounded-xl" />
      ))}
    </div>
  );
}

export default function Pairings() {
  const { roundId = "" } = useParams<{ roundId: string }>();
  const { player } = useAuth();

  // Supporting data (all public-read): the round, its tournament, and course.
  const { round, tournament, course, loading: loadingData, error: loadError } = useRoundPairingData(roundId);

  // The live, captain/admin-gated draft doc.
  const { draft, loading: draftLoading, denied, error } = usePairingDraft(roundId);
  const { players } = useRosterPlayers(tournament);
  const { showToast } = useToast();

  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmAction, setConfirmAction] = useState<"finalize" | "reset" | null>(null);

  // Setup form state (admin, pre-draft).
  const [availA, setAvailA] = useState<Set<string>>(new Set());
  const [availB, setAvailB] = useState<Set<string>>(new Set());
  const [firstPick, setFirstPick] = useState<DraftTeamKey>("teamA");

  // Seed the setup form: from the draft's own lists when there is one (so
  // "change who's playing" on a staged round reopens with that benching intact,
  // not everyone re-checked), otherwise every rostered player is available.
  // Keyed on the lists themselves so unrelated draft updates — every pick, say —
  // don't churn this state.
  const availSeeded = useRef(false);
  const draftAvailKey = draft
    ? `${(draft.available?.teamA ?? []).join(",")}|${(draft.available?.teamB ?? []).join(",")}`
    : null;
  useEffect(() => {
    if (!tournament) return;
    if (draftAvailKey != null) {
      const [a, b] = draftAvailKey.split("|");
      setAvailA(new Set(a ? a.split(",") : []));
      setAvailB(new Set(b ? b.split(",") : []));
      availSeeded.current = true;
      return;
    }
    if (availSeeded.current) return; // a reset just cleared the draft — keep the form
    setAvailA(new Set(tierPlayerIds(tournament.teamA?.rosterByTier)));
    setAvailB(new Set(tierPlayerIds(tournament.teamB?.rosterByTier)));
    availSeeded.current = true;
  }, [tournament, draftAvailKey]);

  // Clear the in-progress selection whenever the turn changes.
  const turnKey = draft?.turn ? `${draft.turn.matchIndex}-${draft.turn.awaiting}-${draft.turn.team}` : draft?.phase;
  useEffect(() => {
    setSelected([]);
  }, [turnKey]);

  // The onSnapshot error listener doesn't recover once the live subscription
  // dies. If we already had draft data, surface a persistent "reload" toast
  // (once) so a stale board can't masquerade as live. A first-load error with
  // no data is handled by a full-screen state below.
  const staleErrorToasted = useRef(false);
  useEffect(() => {
    if (error && draft && !staleErrorToasted.current) {
      staleErrorToasted.current = true;
      showToast({
        variant: "error",
        message: "Live updates interrupted — reload to reconnect.",
        duration: 0,
        action: { label: "Reload", onClick: () => window.location.reload() },
      });
    }
    if (!error) staleErrorToasted.current = false;
  }, [error, draft, showToast]);

  // ---- Derived lookups ----
  const isAdmin = !!player?.isAdmin;
  const myTeam = useMemo(() => captainTeamOf(player?.id, tournament), [player?.id, tournament]);
  const canAct = (team: DraftTeamKey) => isAdmin || myTeam === team;

  // Shared view-model passed to the draft sub-components.
  const meta = usePairingsMeta({
    tournament,
    course,
    players,
    format: round?.format,
    tierByPlayer: draft?.tierByPlayer ?? null,
  });

  // ---- Actions ----
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showToast({ variant: "error", message: getErrorMessage(e, fallback) });
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

  // The live subscription failed before any data arrived (a real network/read
  // error, not a permission denial). Offer a reload rather than falling through
  // to a misleading "draft hasn't started" state.
  if (error && !draft) {
    return (
      <Layout title="Pairings" showBack>
        <PairingsMessage
          icon={<AlertTriangle size={26} />}
          title="Connection problem"
          action={
            <button className="btn btn-secondary w-full" onClick={() => window.location.reload()}>
              Reload
            </button>
          }
        >
          Couldn't load the live draft. Check your connection and try again.
        </PairingsMessage>
      </Layout>
    );
  }

  // Only captains/co-captains and admins get the in-app draft page. (Draft
  // reads are now open to any signed-in user for the /pairings-tv broadcast, so
  // this page gates on role rather than on a permission-denied read.)
  if (denied || (!isAdmin && !myTeam)) {
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

  // Shortcut to this captain's own private plan. Shown wherever a captain is
  // waiting rather than picking — that's exactly when it's useful.
  const planLink = (
    <ViewTransitionLink
      to={`/round/${roundId}/plan`}
      className="btn btn-secondary inline-flex w-full items-center justify-center gap-2 text-center"
    >
      <ClipboardList size={16} /> Open your pairing plan
    </ViewTransitionLink>
  );

  // ===========================================================================
  // No draft yet
  // ===========================================================================
  if (!draft) {
    if (!isAdmin) {
      return (
        <Layout title={title} showBack>
          <PairingsMessage
            icon={<Hourglass size={24} />}
            title="Draft hasn't started"
            action={myTeam || isAdmin ? planLink : undefined}
          >
            An admin will open the captains' draft before the round. You can start planning your side in
            the meantime.
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
              onStage={() =>
                run(async () => {
                  await draftApi.createPairingDraft({
                    roundId,
                    availableTeamA: [...availA],
                    availableTeamB: [...availB],
                  });
                  showToast({ variant: "success", message: "Captains can start planning" });
                }, "Failed to open the round")
              }
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
  // Staging — availability locked in, coin flip still to come
  // ===========================================================================
  if (draft.phase === "staging") {
    return (
      <Layout title={title} showBack>
        <div className="mx-auto max-w-2xl space-y-4 p-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">
            <ClipboardList size={18} className="mt-0.5 shrink-0" />
            <span>
              Who's playing is locked in — {draft.totalMatches} matchup
              {draft.totalMatches === 1 ? "" : "s"}. Captains can plan now; picking starts once the coin
              flip is recorded.
            </span>
          </div>

          {(myTeam || isAdmin) && planLink}

          {isAdmin ? (
            <>
              <TeamFlipPicker meta={meta} value={firstPick} onChange={setFirstPick} />
              <button
                className="btn btn-primary inline-flex w-full items-center justify-center gap-2"
                disabled={busy}
                onClick={() =>
                  run(
                    () => draftApi.startPairingDraft({ roundId, firstPickTeam: firstPick }),
                    "Failed to start the draft"
                  )
                }
              >
                <Dices size={16} /> {busy ? "Starting…" : `${meta.teamName(firstPick)} picks first — start draft`}
              </button>
              <button
                className="btn btn-secondary w-full"
                disabled={busy}
                onClick={() => setConfirmAction("reset")}
              >
                Change who's playing
              </button>
            </>
          ) : (
            <PairingsMessage icon={<Hourglass size={24} />} title="Waiting on the coin flip">
              An admin records who nominates first, and the board goes live here.
            </PairingsMessage>
          )}
        </div>
        {renderConfirmModal()}
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
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            <CheckCircle2 size={18} className="shrink-0" /> Matches created for this round.
          </div>
          <DraftBoard draft={draft} meta={meta} />
          <ViewTransitionLink to={`/round/${roundId}`} className="btn btn-primary w-full text-center">
            View round
          </ViewTransitionLink>
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
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            <Trophy size={18} className="shrink-0" />
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

  // Undo is an admin-only correction tool — captains can't take back a pick
  // (matched server-side in undoDraftPick).
  const undoTeam = lastPlacementTeam(draft);
  const canUndo = undoTeam != null && isAdmin && !busy;

  const submitPick = () =>
    run(async () => {
      await draftApi.submitDraftPick({ roundId, team: actingTeam, playerIds: selected });
      navigator.vibrate?.(40);
    }, "Pick failed");
  const doUndo = () => run(() => draftApi.undoDraftPick({ roundId, team: undoTeam! }), "Undo failed");

  return (
    <Layout title={title} showBack>
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
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
          <>
            <WaitingPanel
              teamName={meta.teamName(actingTeam)}
              teamColor={meta.teamColor(actingTeam)}
              isResponse={isResponse}
              canUndo={canUndo}
              busy={busy}
              onUndo={doUndo}
            />
            {/* Waiting on the other captain is exactly when you want your plan. */}
            {(myTeam || isAdmin) && planLink}
          </>
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
    // Resetting a staged draft only reopens the availability step — nothing has
    // been picked yet, and captains' plans live in their own docs either way.
    const isStaged = draft?.phase === "staging";
    return (
      <Modal
        isOpen={open}
        onClose={() => setConfirmAction(null)}
        title={isFinalize ? "Create matches?" : isStaged ? "Change who's playing?" : "Reset draft?"}
      >
        <p className="mb-5 text-center text-sm text-muted-foreground">
          {isFinalize
            ? `This locks the pairings and creates ${draft?.totalMatches ?? ""} matches for the round.`
            : isStaged
              ? "This reopens the availability step. Captains' saved plans are kept."
              : "This discards the current pairings and returns to setup. Captains' saved plans are kept."}
        </p>
        <ModalActions
          primaryLabel={isFinalize ? "Create matches" : isStaged ? "Change availability" : "Reset draft"}
          primaryClass={isFinalize ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
          onPrimary={() => {
            const action = confirmAction;
            setConfirmAction(null);
            if (action === "finalize") {
              const count = draft?.totalMatches ?? 0;
              run(async () => {
                await draftApi.finalizePairingDraft({ roundId });
                navigator.vibrate?.([30, 40, 30]);
                showToast({
                  variant: "success",
                  message: `${count} match${count === 1 ? "" : "es"} created`,
                });
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
