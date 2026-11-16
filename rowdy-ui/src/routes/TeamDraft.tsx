import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Hourglass, Lock, Trophy, Users } from "lucide-react";
import Layout from "../components/Layout";
import { Modal, ModalActions } from "../components/Modal";
import { Skeleton } from "../components/Skeleton";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import PlayerAvatar from "../components/PlayerAvatar";
import PairingsMessage from "../components/pairings/PairingsMessage";
import TeamFlipPicker from "../components/pairings/TeamFlipPicker";
import WaitingPanel from "../components/pairings/WaitingPanel";
import TeamDraftTurnHeader from "../components/teamDraft/TeamDraftTurnHeader";
import TeamDraftBoard from "../components/teamDraft/TeamDraftBoard";
import TeamDraftPickPanel from "../components/teamDraft/TeamDraftPickPanel";
import { formatHcp, type TeamDraftMeta } from "../components/teamDraft/types";
import type { PairingsMeta } from "../components/pairings/types";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useTournamentContext, usePlayers } from "../contexts/TournamentContext";
import { useTeamDraft } from "../hooks/useTeamDraft";
import { captainTeamOf } from "../hooks/usePairingsData";
import { teamDraftApi } from "../api/draft";
import { getErrorMessage } from "../api/errors";
import { cn } from "../lib/utils";
import { tierStyle } from "../utils/tierColors";
import { TEAM_DRAFT_TIERS, previewTiers } from "../utils/teamDraft";
import type { DraftTeamKey } from "../types";

const TEAM_FALLBACK: Record<DraftTeamKey, string> = { teamA: "Team A", teamB: "Team B" };

function BoardSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-2 p-4">
      <Skeleton height={96} rounded="lg" className="rounded-2xl" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={72} rounded="lg" className="rounded-xl" />
      ))}
    </div>
  );
}

/**
 * Captains' team draft for the active tournament (`/team-draft`): the two
 * captains snake-draft the Draft Pool onto their teams, tier-locked so each team
 * ends with the same number from every tier. Private to captains/co-captains
 * and admins. Same look and flow as the pairings draft (/round/:id/pairings).
 */
export default function TeamDraft() {
  const { tournament, loading: tLoading } = useTournamentContext();
  const { player, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const tournamentId = tournament?.id ?? null;
  const { draft, loading: draftLoading, denied, error } = useTeamDraft(player ? tournamentId : null);

  const [busy, setBusy] = useState(false);
  // Selection is tagged with the pick it was made on, so it clears itself the
  // moment the clock moves on (no reset effect needed).
  const [selection, setSelection] = useState<{ turn: string; pid: string } | null>(null);
  const [firstPick, setFirstPick] = useState<DraftTeamKey>("teamA");
  const [confirm, setConfirm] = useState<"finalize" | "reset" | null>(null);

  const pool = tournament?.draftPool;
  const poolIds = useMemo(() => draft?.poolIds ?? (pool ? Object.keys(pool) : []), [draft?.poolIds, pool]);
  const { players } = usePlayers(poolIds);

  const turnKey = draft?.turn ? `${draft.turn.pickIndex}` : (draft?.phase ?? "none");
  const selected = selection?.turn === turnKey ? selection.pid : null;
  const setSelected = (pid: string | null) => setSelection(pid ? { turn: turnKey, pid } : null);

  // A live listener that dies doesn't recover — say so instead of showing a stale board.
  const errorToasted = useRef(false);
  useEffect(() => {
    if (error && draft && !errorToasted.current) {
      errorToasted.current = true;
      showToast({
        variant: "error",
        message: "Live updates interrupted — reload to reconnect.",
        duration: 0,
        action: { label: "Reload", onClick: () => window.location.reload() },
      });
    }
    if (!error) errorToasted.current = false;
  }, [error, draft, showToast]);

  const isAdmin = !!player?.isAdmin;
  const myTeam = useMemo(() => captainTeamOf(player?.id, tournament ?? null), [player?.id, tournament]);

  const tiers = useMemo(() => draft?.tierByPlayer ?? (pool ? previewTiers(pool) : {}), [draft?.tierByPlayer, pool]);
  const meta = useMemo<TeamDraftMeta>(
    () => ({
      nameOf: (pid) => players[pid]?.displayName || pid,
      hcpOf: (pid) => {
        const h = draft ? draft.handicapByPlayer[pid] : pool?.[pid];
        return typeof h === "number" ? h : null;
      },
      tierOf: (pid) => tiers[pid],
      teamName: (team) => tournament?.[team]?.name || TEAM_FALLBACK[team],
      teamColor: (team) =>
        tournament?.[team]?.color || (team === "teamA" ? "var(--team-a-default)" : "var(--team-b-default)"),
      teamLogo: (team) => tournament?.[team]?.logo,
    }),
    [players, draft, pool, tiers, tournament]
  );
  // TeamFlipPicker reads team name/color off the pairings view-model.
  const flipMeta = useMemo<PairingsMeta>(
    () => ({
      players: [],
      nameOf: meta.nameOf,
      chOf: () => null,
      tierOf: meta.tierOf,
      teamName: meta.teamName,
      teamColor: meta.teamColor,
      teamLogo: meta.teamLogo,
      grossOnly: false,
    }),
    [meta]
  );

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

  const layout = (children: React.ReactNode) => (
    <Layout title="Captains' Draft" series={tournament?.series} tournamentLogo={tournament?.tournamentLogo} showBack>
      {children}
    </Layout>
  );

  // ---------------------------------------------------------------------------
  // Loading / access
  // ---------------------------------------------------------------------------
  if (tLoading || authLoading || (player && tournamentId && draftLoading)) return layout(<BoardSkeleton />);

  if (!tournament) {
    return layout(
      <PairingsMessage icon={<AlertTriangle size={24} />} title="No active tournament" />
    );
  }

  if (!player || denied || (!isAdmin && !myTeam)) {
    return layout(
      <PairingsMessage
        icon={<Lock size={24} />}
        title="Captains & admins only"
        action={
          <ViewTransitionLink to="/draft" className="btn btn-secondary inline-flex w-full items-center justify-center gap-2">
            <ClipboardList size={16} /> View the Draft Pool
          </ViewTransitionLink>
        }
      >
        The captains draft their teams here in private. The rosters show up on the Teams page once the draft is
        locked in.
      </PairingsMessage>
    );
  }

  if (error && !draft) {
    return layout(
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
    );
  }

  // ---------------------------------------------------------------------------
  // Not started
  // ---------------------------------------------------------------------------
  if (!draft) {
    if (!isAdmin) {
      return layout(
        <PairingsMessage
          icon={<Hourglass size={24} />}
          title="Draft hasn't started"
          action={
            <ViewTransitionLink to="/draft" className="btn btn-secondary inline-flex w-full items-center justify-center gap-2">
              <ClipboardList size={16} /> Scout the Draft Pool
            </ViewTransitionLink>
          }
        >
          An admin opens the draft and sets who picks first. This page goes live the moment it starts — no need
          to refresh.
        </PairingsMessage>
      );
    }

    // Admin setup: check the pool, preview tiers, choose the first pick.
    const captainA = tournament.teamA?.captainId;
    const captainB = tournament.teamB?.captainId;
    const problems: string[] = [];
    if (poolIds.length === 0) problems.push("No draft pool has been posted.");
    else if (poolIds.length % 8 !== 0)
      problems.push(`The pool has ${poolIds.length} players — it needs a multiple of 8 (e.g. 16).`);
    if (!captainA || !captainB) problems.push("Both teams need a captain.");
    for (const c of [captainA, captainB]) if (c && pool && !(c in pool)) problems.push(`${meta.nameOf(c)} isn't in the pool.`);
    const missingHcp = poolIds.filter((id) => typeof pool?.[id] !== "number");
    const ranked = [...poolIds].sort((a, b) => {
      const ta = TEAM_DRAFT_TIERS.indexOf(tiers[a]);
      const tb = TEAM_DRAFT_TIERS.indexOf(tiers[b]);
      if (ta !== tb) return ta - tb;
      return (meta.hcpOf(a) ?? Infinity) - (meta.hcpOf(b) ?? Infinity);
    });
    const captainTeam = (pid: string): DraftTeamKey | null =>
      pid === captainA ? "teamA" : pid === captainB ? "teamB" : null;

    return layout(
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">
          <Users size={18} className="mt-0.5 shrink-0" />
          <span>
            {poolIds.length} players, 4 tiers. Captains start on their teams; each team drafts {poolIds.length / 2 - 1}{" "}
            more, snake order, {poolIds.length / 8} from every tier. Only captains & admins can see the board.
          </span>
        </div>

        {problems.length > 0 && (
          <div className="space-y-1 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {problems.map((p) => (
              <div key={p} className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {p}
              </div>
            ))}
          </div>
        )}
        {missingHcp.length > 0 && problems.length === 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900">
            No handicap for {missingHcp.map(meta.nameOf).join(", ")} — they'll rank at the bottom of tier D.
          </div>
        )}

        <div className="card overflow-hidden p-0">
          {ranked.map((pid, i) => {
            const tier = tiers[pid];
            const showHeader = i === 0 || tiers[ranked[i - 1]] !== tier;
            const cap = captainTeam(pid);
            return (
              <div key={pid}>
                {showHeader && (
                  <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-1.5">
                    <span className={cn("rounded px-1.5 py-0.5 text-[0.6rem] font-bold", tierStyle(tier).chip)}>
                      Tier {tier}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
                  <PlayerAvatar name={meta.nameOf(pid)} playerId={pid} color={cap ? meta.teamColor(cap) : undefined} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{meta.nameOf(pid)}</div>
                    {cap && (
                      <div className="text-[0.6rem] font-bold uppercase tracking-wide" style={{ color: meta.teamColor(cap) }}>
                        Captain · {meta.teamName(cap)}
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{formatHcp(meta.hcpOf(pid))}</span>
                </div>
              </div>
            );
          })}
        </div>

        <TeamFlipPicker meta={flipMeta} value={firstPick} onChange={setFirstPick} label="Who picks first?" />
        <button
          className="btn btn-primary w-full"
          disabled={busy || problems.length > 0}
          onClick={() =>
            run(async () => {
              await teamDraftApi.start({ tournamentId: tournament.id, firstPickTeam: firstPick });
              showToast({ variant: "success", message: "Draft is live — captains can pick" });
            }, "Failed to start the draft")
          }
        >
          {busy ? "Starting…" : `${meta.teamName(firstPick)} picks first — start draft`}
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Finalized
  // ---------------------------------------------------------------------------
  if (draft.phase === "finalized") {
    return layout(
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 size={18} className="shrink-0" /> Teams are set — rosters are live.
        </div>
        <TeamDraftBoard draft={draft} meta={meta} />
        <ViewTransitionLink to="/teams" className="btn btn-primary w-full text-center">
          View teams
        </ViewTransitionLink>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Review — every pick made, waiting on the admin
  // ---------------------------------------------------------------------------
  if (draft.phase === "review") {
    return layout(
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          <Trophy size={18} className="shrink-0" />
          {isAdmin ? "Draft complete — review, then lock in the teams." : "Draft complete — waiting for an admin to lock it in."}
        </div>
        <TeamDraftBoard draft={draft} meta={meta} />
        {isAdmin && (
          <div className="space-y-2">
            <button className="btn btn-primary w-full" disabled={busy} onClick={() => setConfirm("finalize")}>
              {busy ? "Working…" : "Lock in teams & write rosters"}
            </button>
            <button className="btn btn-secondary w-full" disabled={busy} onClick={() => run(() => teamDraftApi.undo({ tournamentId: tournament.id }), "Undo failed")}>
              Undo last pick
            </button>
            <button className="btn btn-secondary w-full" disabled={busy} onClick={() => setConfirm("reset")}>
              Reset draft
            </button>
          </div>
        )}
        {confirmModal()}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Drafting
  // ---------------------------------------------------------------------------
  const team = draft.turn!.team;
  const myMove = isAdmin || myTeam === team;
  const canUndo = isAdmin && draft.picks.length > 0 && !busy;
  const doUndo = () => run(() => teamDraftApi.undo({ tournamentId: tournament.id }), "Undo failed");

  return layout(
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <TeamDraftTurnHeader draft={draft} meta={meta} myMove={myMove} />

      {myMove ? (
        <TeamDraftPickPanel
          draft={draft}
          team={team}
          meta={meta}
          selected={selected}
          busy={busy}
          canUndo={canUndo}
          onSelect={setSelected}
          onSubmit={() =>
            selected &&
            run(async () => {
              await teamDraftApi.pick({ tournamentId: tournament.id, team, playerId: selected });
              navigator.vibrate?.(40);
            }, "Pick failed")
          }
          onUndo={doUndo}
        />
      ) : (
        <WaitingPanel
          teamName={meta.teamName(team)}
          teamColor={meta.teamColor(team)}
          isResponse={false}
          choosingText="their pick"
          canUndo={canUndo}
          busy={busy}
          onUndo={doUndo}
        />
      )}

      <TeamDraftBoard draft={draft} meta={meta} />

      {isAdmin && (
        <button className="btn btn-secondary w-full" disabled={busy} onClick={() => setConfirm("reset")}>
          Reset draft
        </button>
      )}
      {confirmModal()}
    </div>
  );

  function confirmModal() {
    const isFinalize = confirm === "finalize";
    return (
      <Modal isOpen={confirm !== null} onClose={() => setConfirm(null)} title={isFinalize ? "Lock in teams?" : "Reset draft?"}>
        <p className="mb-5 text-center text-sm text-muted-foreground">
          {isFinalize
            ? "This writes both rosters (with tiers and handicaps) to the tournament and hides the Draft Pool. The teams become public."
            : "This throws away every pick and returns to setup."}
        </p>
        <ModalActions
          primaryLabel={isFinalize ? "Lock in teams" : "Reset draft"}
          primaryClass={isFinalize ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
          onPrimary={() => {
            const action = confirm;
            setConfirm(null);
            if (!tournament) return;
            if (action === "finalize") {
              run(async () => {
                await teamDraftApi.finalize({ tournamentId: tournament.id });
                navigator.vibrate?.([30, 40, 30]);
                showToast({ variant: "success", message: "Teams locked in" });
              }, "Failed to lock in teams");
            } else if (action === "reset") {
              run(() => teamDraftApi.reset({ tournamentId: tournament.id }), "Failed to reset");
            }
          }}
          secondaryLabel="Cancel"
          onSecondary={() => setConfirm(null)}
        />
      </Modal>
    );
  }
}
