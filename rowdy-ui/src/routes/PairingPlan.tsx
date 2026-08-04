import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, ClipboardList, Eraser, Hourglass, Lock, Radio, ShieldCheck } from "lucide-react";
import Layout from "../components/Layout";
import SectionLabel from "../components/SectionLabel";
import { Skeleton } from "../components/Skeleton";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useRosterPlayers } from "../hooks/admin/useRosterPlayers";
import { usePairingDraft } from "../hooks/usePairingDraft";
import { usePairingPlan } from "../hooks/usePairingPlan";
import {
  captainTeamOf,
  formatPlayersPerSide,
  usePairingsMeta,
  useRoundPairingData,
} from "../hooks/usePairingsData";
import { draftApi } from "../api/draft";
import { getErrorMessage } from "../api/errors";
import { tierPlayerIds } from "../utils/roster";
import { placedIds } from "../utils/pairingDraft";
import {
  cannotAddToSlot,
  normalizePairs,
  pairsEqual,
  planStrandWarning,
  slotViolation,
  unassignedIds,
} from "../utils/pairingPlan";
import { TIER_ORDER, tierStyle } from "../utils/tierColors";
import { cn } from "../lib/utils";
import PairingsMessage from "../components/pairings/PairingsMessage";
import PlanSlotCard from "../components/pairings/PlanSlotCard";
import PlayerPickRow from "../components/pairings/PlayerPickRow";
import type { DraftTeamKey } from "../types";

/**
 * The captains' private planning board for a round (`/round/:roundId/plan`).
 *
 * Unlike the live draft, this page needs nothing from an admin — no coin flip,
 * not even a staged draft — so a captain can sit down days early and lay out
 * how they want their own side paired. When the admin does stage the round the
 * page picks up the real availability; when the draft opens it stays available
 * as a cheat sheet next to the board.
 *
 * The plan is one team's alone: it lives in `pairingPlans/{roundId}__{team}`,
 * readable only by that team's captain and co-captain.
 */
export default function PairingPlan() {
  const { roundId = "" } = useParams<{ roundId: string }>();
  const { player } = useAuth();
  const { showToast } = useToast();

  const { round, tournament, course, loading: loadingData, error: loadError } = useRoundPairingData(roundId);
  const { draft, loading: draftLoading } = usePairingDraft(roundId);
  const { players } = useRosterPlayers(tournament);

  const isAdmin = !!player?.isAdmin;
  const myTeam = useMemo(() => captainTeamOf(player?.id, tournament), [player?.id, tournament]);

  // A captain only ever has their own team's plan. An admin runs the draft for
  // both sides, so they pick which team's plan they're working on — defaulting
  // to their own if they happen to captain one.
  const [adminTeam, setAdminTeam] = useState<DraftTeamKey | null>(null);
  const viewTeam: DraftTeamKey | null = myTeam ?? (isAdmin ? adminTeam ?? "teamA" : null);

  const { plan, loading: planLoading } = usePairingPlan(roundId, viewTeam);

  const meta = usePairingsMeta({
    tournament,
    course,
    players,
    format: round?.format,
    tierByPlayer: draft?.tierByPlayer ?? null,
  });

  const perSide = formatPlayersPerSide(round?.format);

  // Who this team has to work with: the staged availability once an admin has
  // set it, otherwise the whole roster (a plan is often written first).
  const available = useMemo(() => {
    if (!viewTeam) return [];
    if (draft) return draft.available?.[viewTeam] ?? [];
    return tierPlayerIds(tournament?.[viewTeam]?.rosterByTier);
  }, [viewTeam, draft, tournament]);
  const availableSet = useMemo(() => new Set(available), [available]);
  const slotCount = draft ? draft.totalMatches : Math.floor(available.length / perSide);

  // The tier rule needs a plain lookup, not meta's accessor.
  const tierMap = useMemo(() => {
    const m: Record<string, "A" | "B" | "C" | "D"> = {};
    for (const pid of available) {
      const t = meta.tierOf(pid);
      if (t) m[pid] = t;
    }
    return m;
  }, [available, meta]);

  const [pairs, setPairs] = useState<string[][]>([]);
  const [notes, setNotes] = useState("");
  const [activeSlot, setActiveSlot] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Switching teams (admin only) is a different document, not an edit to this
  // one — drop local state so the adopt effect treats it as a fresh load rather
  // than warning about a "co-captain" change.
  const lastRemoteKey = useRef<string | null>(null);
  useEffect(() => {
    lastRemoteKey.current = null;
    setDirty(false);
    setActiveSlot(0);
  }, [viewTeam]);

  // Adopt whatever the server has whenever it changes — that's how someone
  // else's save shows up. If this viewer has unsaved edits we keep theirs and
  // just warn, rather than yanking the board out from under them mid-thought.
  const remoteKey = plan ? JSON.stringify([plan.pairs, plan.notes]) : "none";
  const ready = !loadingData && !draftLoading && !planLoading && !!viewTeam && slotCount > 0;
  useEffect(() => {
    if (!ready) return;
    if (lastRemoteKey.current === remoteKey) return;
    const isFirstLoad = lastRemoteKey.current === null;
    lastRemoteKey.current = remoteKey;
    if (!isFirstLoad && dirtyRef.current) {
      showToast({
        variant: "info",
        message: "Someone else saved a change to this plan. Saving yours will replace it.",
      });
      return;
    }
    setPairs(normalizePairs(plan?.pairs, slotCount, perSide, availableSet));
    setNotes(plan?.notes ?? "");
    setDirty(false);
  }, [ready, remoteKey, slotCount, perSide, availableSet, plan, showToast]);

  const unassigned = useMemo(() => unassignedIds(available, pairs), [available, pairs]);
  const violations = useMemo(
    () => pairs.map((slot) => slotViolation(slot, perSide, tierMap)),
    [pairs, perSide, tierMap]
  );
  const strandWarning = useMemo(
    () => planStrandWarning(pairs, available, perSide, tierMap),
    [pairs, available, perSide, tierMap]
  );
  const filledSlots = pairs.filter((s) => s.length === perSide).length;
  const hasViolation = violations.some(Boolean);
  const savedPairs = useMemo(
    () => normalizePairs(plan?.pairs, slotCount, perSide, availableSet),
    [plan, slotCount, perSide, availableSet]
  );
  const changed = dirty && (!pairsEqual(pairs, savedPairs) || notes !== (plan?.notes ?? ""));

  // Players already taken in the live draft — the plan for them is moot.
  const alreadyDrafted = useMemo(() => {
    if (!draft || !viewTeam || draft.phase === "staging") return new Set<string>();
    return placedIds(draft.matches, viewTeam);
  }, [draft, viewTeam]);

  const firstOpenSlot = useCallback(
    (from = 0) => {
      for (let i = from; i < pairs.length; i++) if (pairs[i].length < perSide) return i;
      for (let i = 0; i < from; i++) if (pairs[i].length < perSide) return i;
      return null;
    },
    [pairs, perSide]
  );

  // The slot a pool tap actually lands in: the active one while it has room,
  // otherwise the next open one. Derived once so the pool's disabled states are
  // checked against the same slot `addPlayer` will fill.
  const targetIndex =
    pairs[activeSlot] && pairs[activeSlot].length < perSide ? activeSlot : firstOpenSlot();

  const addPlayer = (pid: string) => {
    const target = targetIndex;
    if (target == null) return;
    setPairs((prev) => prev.map((slot, i) => (i === target ? [...slot, pid] : slot)));
    setDirty(true);
    // Jump to the next slot with room once this one fills up.
    if (pairs[target].length + 1 >= perSide) {
      const next = firstOpenSlot(target + 1);
      if (next != null && next !== target) setActiveSlot(next);
    } else {
      setActiveSlot(target);
    }
  };

  const removePlayer = (slotIndex: number, pid: string) => {
    setPairs((prev) => prev.map((slot, i) => (i === slotIndex ? slot.filter((x) => x !== pid) : slot)));
    setActiveSlot(slotIndex);
    setDirty(true);
  };

  const clearAll = () => {
    setPairs((prev) => prev.map(() => []));
    setActiveSlot(0);
    setDirty(true);
  };

  const save = async () => {
    if (!viewTeam) return;
    setBusy(true);
    try {
      await draftApi.savePairingPlan({ roundId, team: viewTeam, pairs, notes });
      setDirty(false);
      showToast({ variant: "success", message: "Plan saved" });
    } catch (e) {
      showToast({ variant: "error", message: getErrorMessage(e, "Couldn't save your plan") });
    } finally {
      setBusy(false);
    }
  };

  // Pool grouped by tier, A→D, so the scarce players read first.
  const poolGroups = useMemo(() => {
    const byTier = new Map<string, string[]>();
    for (const pid of unassigned) {
      const t = meta.tierOf(pid) ?? "—";
      if (!byTier.has(t)) byTier.set(t, []);
      byTier.get(t)!.push(pid);
    }
    const ordered: { tier: string; ids: string[] }[] = [];
    for (const t of TIER_ORDER) if (byTier.has(t)) ordered.push({ tier: t, ids: byTier.get(t)! });
    if (byTier.has("—")) ordered.push({ tier: "—", ids: byTier.get("—")! });
    return ordered;
  }, [unassigned, meta]);

  const title = `Pairing plan${round?.day ? ` — Day ${round.day}` : ""}`;

  // ---- Loading / access states -------------------------------------------
  if (loadingData || draftLoading || planLoading) {
    return (
      <Layout title="Pairing plan" showBack>
        <div className="mx-auto max-w-2xl space-y-2 p-4">
          <Skeleton height={72} rounded="lg" className="rounded-2xl" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={64} rounded="lg" className="rounded-xl" />
          ))}
        </div>
      </Layout>
    );
  }

  if (loadError) {
    return (
      <Layout title="Pairing plan" showBack>
        <PairingsMessage icon={<AlertTriangle size={26} />} title="Couldn't load the round">
          {loadError}
        </PairingsMessage>
      </Layout>
    );
  }

  // Captains get their own team's plan; admins run the draft, so they get both.
  // Everyone else is out — a plan the field can read is worthless.
  if (!viewTeam) {
    return (
      <Layout title="Pairing plan" showBack>
        <PairingsMessage icon={<Lock size={24} />} title="Captains & admins only">
          A pairing plan is private to the team that wrote it — its captain, co-captain, and the
          tournament admins. Your matchups show up on the round page once the draft is done.
        </PairingsMessage>
      </Layout>
    );
  }

  if (!round?.format) {
    return (
      <Layout title={title} showBack>
        <PairingsMessage icon={<AlertTriangle size={24} />} title="Format not set yet">
          This round's match format hasn't been chosen, so there's nothing to plan against yet. Check back
          once an admin sets it.
        </PairingsMessage>
      </Layout>
    );
  }

  const teamColor = meta.teamColor(viewTeam);
  const phase = draft?.phase;

  // Admins work both sides, so they get a switcher. Rendered above the "no
  // roster" bail-out below, or an admin could get stuck on an empty team.
  const teamSwitcher = isAdmin ? (
    <div className="grid grid-cols-2 gap-2">
      {(["teamA", "teamB"] as DraftTeamKey[]).map((team) => {
        const on = viewTeam === team;
        const color = meta.teamColor(team);
        return (
          <button
            key={team}
            type="button"
            onClick={() => setAdminTeam(team)}
            aria-pressed={on}
            className={cn(
              "rounded-xl border px-3 py-2.5 text-sm font-bold transition-all duration-150",
              on ? "border-transparent text-white" : "border-border text-muted-foreground hover:bg-muted"
            )}
            style={on ? { background: color } : undefined}
          >
            {meta.teamName(team)}
          </button>
        );
      })}
    </div>
  ) : null;

  if (slotCount === 0) {
    return (
      <Layout title={title} showBack>
        <div className="mx-auto max-w-2xl space-y-4 p-4">
          {teamSwitcher}
          <PairingsMessage icon={<Hourglass size={24} />} title="No roster to plan with">
            {meta.teamName(viewTeam)} doesn't have enough rostered players for a {perSide}-player matchup
            yet.
          </PairingsMessage>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={title} showBack>
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {/* Status: whose plan this is, what stage the round is at, what that means. */}
        <div className="card space-y-3 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={17} className="shrink-0" style={{ color: teamColor }} />
            <span className="text-sm font-bold" style={{ color: teamColor }}>
              {meta.teamName(viewTeam)}
            </span>
            <span className="text-xs text-muted-foreground">
              {myTeam === viewTeam ? "· private to your captains" : "· captains & admins only"}
            </span>
          </div>

          {teamSwitcher}
          {isAdmin && !myTeam && (
            <p className="text-xs text-muted-foreground">
              You're editing this team's own plan as an admin — their captains see the same board.
            </p>
          )}

          {!draft && (
            <p className="text-sm text-muted-foreground">
              Availability isn't set for this round yet, so you're planning against your full roster. When
              an admin locks in who's playing, this board updates and anyone benched drops out.
            </p>
          )}
          {phase === "staging" && (
            <p className="text-sm text-muted-foreground">
              Availability is locked in — {slotCount} matchup{slotCount === 1 ? "" : "s"}. The coin flip
              hasn't happened yet, so plan for either side of it.
            </p>
          )}
          {(phase === "drafting" || phase === "review") && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                <Radio size={15} className="shrink-0" /> The draft is live — this is just your cheat sheet now.
              </p>
              <ViewTransitionLink
                to={`/round/${roundId}/pairings`}
                className="btn btn-secondary w-full text-center"
              >
                Go to the draft board
              </ViewTransitionLink>
            </div>
          )}
          {phase === "finalized" && (
            <p className="text-sm text-muted-foreground">
              Pairings are locked in for this round — the plan below is kept for the record.
            </p>
          )}
        </div>

        {/* The board */}
        <SectionLabel
          trailing={
            <button
              type="button"
              onClick={clearAll}
              disabled={filledSlots === 0 && unassigned.length === available.length}
              className="btn-ghost inline-flex items-center gap-1 text-xs text-muted-foreground disabled:opacity-40"
            >
              <Eraser size={13} /> Clear
            </button>
          }
        >
          Your pairings · {filledSlots}/{slotCount}
        </SectionLabel>

        <div className="space-y-2">
          {pairs.map((slot, i) => (
            <PlanSlotCard
              key={i}
              index={i}
              slot={slot}
              perSide={perSide}
              team={viewTeam}
              meta={meta}
              active={i === activeSlot}
              violation={violations[i]}
              onActivate={() => setActiveSlot(i)}
              onRemove={(pid) => removePlayer(i, pid)}
            />
          ))}
        </div>

        {strandWarning && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {strandWarning}
          </div>
        )}

        {/* The pool */}
        <SectionLabel>Still to place · {unassigned.length}</SectionLabel>
        {unassigned.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">
            Everyone's placed. {perSide === 2 && "No two A-tier and no two D-tier are paired together."}
          </p>
        ) : (
          <div className="space-y-3">
            {poolGroups.map(({ tier, ids }) => (
              <div key={tier} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-[0.65rem] font-bold", tierStyle(tier).chip)}>
                    {tier === "—" ? "No tier" : `Tier ${tier}`}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                {ids.map((pid) => {
                  let disabledReason: string | undefined;
                  if (alreadyDrafted.has(pid)) disabledReason = "Already picked in the live draft";
                  else if (targetIndex == null) disabledReason = "Every matchup is full";
                  else disabledReason = cannotAddToSlot(pairs[targetIndex], pid, perSide, tierMap) ?? undefined;
                  return (
                    <PlayerPickRow
                      key={pid}
                      pid={pid}
                      meta={meta}
                      teamColor={teamColor}
                      selected={false}
                      disabled={!!disabledReason}
                      disabledReason={disabledReason}
                      onToggle={() => addPlayer(pid)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Notes */}
        <SectionLabel>Notes</SectionLabel>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
          rows={4}
          maxLength={4000}
          placeholder="Who to hold back, who you want to see their A-tier, anything you want your co-captain to know…"
          className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {/* Save. Outside a `.card` (overflow-hidden clips a sticky child) and
            docked above the bottom nav, matching the draft's pick panel. */}
        <div
          className="sticky z-10 flex items-center gap-2 rounded-xl border border-border bg-card/95 p-2 shadow-lg backdrop-blur"
          style={{ bottom: "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
        >
          <div className="min-w-0 flex-1 px-1 text-xs text-muted-foreground">
            {changed ? (
              <span className="font-semibold text-amber-700">Unsaved changes</span>
            ) : plan ? (
              <span className="inline-flex items-center gap-1">
                <ClipboardList size={12} /> Saved
                {plan.updatedBy && plan.updatedBy !== player?.id
                  ? ` by ${meta.nameOf(plan.updatedBy)}`
                  : ""}
              </span>
            ) : (
              "Not saved yet"
            )}
          </div>
          <button className="btn btn-primary" disabled={busy || hasViolation || !changed} onClick={save}>
            {busy ? "Saving…" : "Save plan"}
          </button>
        </div>
      </div>
    </Layout>
  );
}
