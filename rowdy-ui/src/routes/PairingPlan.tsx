import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, ClipboardList, Eraser, EyeOff, Hourglass, Lock, Radio } from "lucide-react";
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
  PLAN_TEAMS,
  cannotAddToSide,
  completeMatchupCount,
  emptyMatchups,
  matchupsEqual,
  normalizeMatchups,
  planStrandWarning,
  sideViolation,
  unassignedIds,
} from "../utils/pairingPlan";
import { TIER_ORDER, tierStyle } from "../utils/tierColors";
import { cn } from "../lib/utils";
import PairingsMessage from "../components/pairings/PairingsMessage";
import PlanMatchupCard from "../components/pairings/PlanMatchupCard";
import PlayerPickRow from "../components/pairings/PlayerPickRow";
import type { DraftTeamKey, PlannedMatchup } from "../types";

/**
 * A personal pre-draft planning board (`/round/:roundId/plan`).
 *
 * Unlike the live draft this needs nothing from an admin — no coin flip, not
 * even a staged draft — so a captain can sit down days early and work out not
 * just how to pair their own side, but how they think the opponent will pair
 * theirs and which of those matchups they want.
 *
 * Every captain, co-captain and admin gets their OWN board
 * (`pairingPlans/{roundId}__{playerId}`, readable by that one person). Two
 * co-captains can each test their own assumptions without stepping on each
 * other, and nobody — admins included — reads anyone else's.
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
  // Captains plan for their own side; admins captain neither, so they just get
  // the board with no "you" side marked.
  const canPlan = !!player && (isAdmin || !!myTeam);

  const { plan, loading: planLoading } = usePairingPlan(roundId, canPlan ? player?.id : null);

  const meta = usePairingsMeta({
    tournament,
    course,
    players,
    format: round?.format,
    tierByPlayer: draft?.tierByPlayer ?? null,
  });

  const perSide = formatPlayersPerSide(round?.format);

  // Who each side has to work with: the staged availability once an admin has
  // set it, otherwise the full roster (plans are often written first).
  const available = useMemo(() => {
    const forTeam = (team: DraftTeamKey) =>
      draft ? draft.available?.[team] ?? [] : tierPlayerIds(tournament?.[team]?.rosterByTier);
    return { teamA: forTeam("teamA"), teamB: forTeam("teamB") };
  }, [draft, tournament]);
  const availableSets = useMemo(
    () => ({ teamA: new Set(available.teamA), teamB: new Set(available.teamB) }),
    [available]
  );
  const slotCount = draft
    ? draft.totalMatches
    : Math.floor(Math.min(available.teamA.length, available.teamB.length) / perSide);

  // The tier rule needs a plain lookup, not meta's accessor.
  const tierMap = useMemo(() => {
    const m: Record<string, "A" | "B" | "C" | "D"> = {};
    for (const pid of [...available.teamA, ...available.teamB]) {
      const t = meta.tierOf(pid);
      if (t) m[pid] = t;
    }
    return m;
  }, [available, meta]);

  const [matchups, setMatchups] = useState<PlannedMatchup[]>([]);
  const [notes, setNotes] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeSide, setActiveSide] = useState<DraftTeamKey>("teamA");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Start on the viewer's own side once we know which it is.
  const sideSeeded = useRef(false);
  useEffect(() => {
    if (sideSeeded.current || !myTeam) return;
    setActiveSide(myTeam);
    sideSeeded.current = true;
  }, [myTeam]);

  // Adopt whatever the server has whenever it changes — that's how an edit made
  // on another device shows up. If there are unsaved edits here we keep them and
  // just warn, rather than yanking the board away mid-thought.
  const remoteKey = plan ? JSON.stringify([plan.matchups, plan.notes]) : "none";
  const lastRemoteKey = useRef<string | null>(null);
  const ready = !loadingData && !draftLoading && !planLoading && canPlan && slotCount > 0;
  useEffect(() => {
    if (!ready) return;
    if (lastRemoteKey.current === remoteKey) return;
    const isFirstLoad = lastRemoteKey.current === null;
    lastRemoteKey.current = remoteKey;
    if (!isFirstLoad && dirtyRef.current) {
      showToast({
        variant: "info",
        message: "This plan changed on another device. Saving here will replace it.",
      });
      return;
    }
    setMatchups(normalizeMatchups(plan?.matchups, slotCount, perSide, availableSets));
    setNotes(plan?.notes ?? "");
    setDirty(false);
  }, [ready, remoteKey, slotCount, perSide, availableSets, plan, showToast]);

  const unassigned = useMemo(
    () => ({
      teamA: unassignedIds(available.teamA, matchups, "teamA"),
      teamB: unassignedIds(available.teamB, matchups, "teamB"),
    }),
    [available, matchups]
  );
  const violations = useMemo(
    () =>
      matchups.map((m) => ({
        teamA: sideViolation(m.teamA, perSide, tierMap),
        teamB: sideViolation(m.teamB, perSide, tierMap),
      })),
    [matchups, perSide, tierMap]
  );
  const strandWarnings = useMemo(
    () =>
      PLAN_TEAMS.map((team) => ({
        team,
        warning: planStrandWarning(matchups, available[team], team, perSide, tierMap),
      })).filter((w) => w.warning),
    [matchups, available, perSide, tierMap]
  );
  const setCount = completeMatchupCount(matchups, perSide);
  const hasViolation = violations.some((v) => v.teamA || v.teamB);
  const savedMatchups = useMemo(
    () => normalizeMatchups(plan?.matchups, slotCount, perSide, availableSets),
    [plan, slotCount, perSide, availableSets]
  );
  const changed =
    dirty && (!matchupsEqual(matchups, savedMatchups) || notes !== (plan?.notes ?? ""));

  // Players already taken in the live draft — planning them is moot.
  const alreadyDrafted = useMemo(() => {
    if (!draft || draft.phase === "staging") return { teamA: new Set<string>(), teamB: new Set<string>() };
    return { teamA: placedIds(draft.matches, "teamA"), teamB: placedIds(draft.matches, "teamB") };
  }, [draft]);

  /** Next matchup whose `team` side has room, searching forward then wrapping. */
  const firstOpen = useCallback(
    (team: DraftTeamKey, from = 0) => {
      for (let i = from; i < matchups.length; i++) if (matchups[i][team].length < perSide) return i;
      for (let i = 0; i < from; i++) if (matchups[i][team].length < perSide) return i;
      return null;
    },
    [matchups, perSide]
  );

  // Where a pool tap lands: the active matchup while its side has room, else the
  // next one that does. Derived once so the pool's disabled states are checked
  // against the same side `addPlayer` will fill.
  const targetIndex =
    matchups[activeIndex] && matchups[activeIndex][activeSide].length < perSide
      ? activeIndex
      : firstOpen(activeSide);

  const addPlayer = (pid: string) => {
    if (targetIndex == null) return;
    const target = targetIndex;
    setMatchups((prev) =>
      prev.map((m, i) => (i === target ? { ...m, [activeSide]: [...m[activeSide], pid] } : m))
    );
    setDirty(true);
    if (matchups[target][activeSide].length + 1 >= perSide) {
      const next = firstOpen(activeSide, target + 1);
      if (next != null && next !== target) setActiveIndex(next);
    } else {
      setActiveIndex(target);
    }
  };

  const removePlayer = (index: number, team: DraftTeamKey, pid: string) => {
    setMatchups((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [team]: m[team].filter((x) => x !== pid) } : m))
    );
    setActiveIndex(index);
    setActiveSide(team);
    setDirty(true);
  };

  const activateSide = (index: number, team: DraftTeamKey) => {
    setActiveIndex(index);
    setActiveSide(team);
  };

  const clearAll = () => {
    setMatchups(emptyMatchups(slotCount));
    setActiveIndex(0);
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await draftApi.savePairingPlan({ roundId, matchups, notes });
      setDirty(false);
      showToast({ variant: "success", message: "Plan saved" });
    } catch (e) {
      showToast({ variant: "error", message: getErrorMessage(e, "Couldn't save your plan") });
    } finally {
      setBusy(false);
    }
  };

  // The active side's remaining players, grouped by tier (A→D, scarce first).
  const poolGroups = useMemo(() => {
    const byTier = new Map<string, string[]>();
    for (const pid of unassigned[activeSide]) {
      const t = meta.tierOf(pid) ?? "—";
      if (!byTier.has(t)) byTier.set(t, []);
      byTier.get(t)!.push(pid);
    }
    const ordered: { tier: string; ids: string[] }[] = [];
    for (const t of TIER_ORDER) if (byTier.has(t)) ordered.push({ tier: t, ids: byTier.get(t)! });
    if (byTier.has("—")) ordered.push({ tier: "—", ids: byTier.get("—")! });
    return ordered;
  }, [unassigned, activeSide, meta]);

  const title = `Pairing plan${round?.day ? ` — Day ${round.day}` : ""}`;

  // ---- Loading / access states -------------------------------------------
  if (loadingData || draftLoading || planLoading) {
    return (
      <Layout title="Pairing plan" showBack>
        <div className="mx-auto max-w-2xl space-y-2 p-4">
          <Skeleton height={72} rounded="lg" className="rounded-2xl" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={72} rounded="lg" className="rounded-xl" />
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

  if (!canPlan) {
    return (
      <Layout title="Pairing plan" showBack>
        <PairingsMessage icon={<Lock size={24} />} title="Captains & admins only">
          Planning boards belong to the people setting the pairings. Your matchups show up on the round
          page once the draft is done.
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

  if (slotCount === 0) {
    return (
      <Layout title={title} showBack>
        <PairingsMessage icon={<Hourglass size={24} />} title="No rosters to plan with">
          Both teams need enough rostered players for a {perSide}-player matchup before there's a board to
          build.
        </PairingsMessage>
      </Layout>
    );
  }

  const phase = draft?.phase;
  const activeColor = meta.teamColor(activeSide);

  return (
    <Layout title={title} showBack>
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {/* Status: whose board this is, and what stage the round is at. */}
        <div className="card space-y-3 p-4">
          <div className="flex items-center gap-2">
            <EyeOff size={16} className="shrink-0 text-muted-foreground" />
            <span className="text-sm font-bold text-foreground">Your board</span>
            <span className="text-xs text-muted-foreground">· only you can see this</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Pair both teams — yours, and how you think they'll pair theirs — then line up the matchups you
            want. Every captain and admin keeps their own board; nobody sees yours.
          </p>

          {!draft && (
            <p className="text-sm text-muted-foreground">
              Availability isn't set for this round yet, so you're working from the full rosters. When an
              admin locks in who's playing, this board updates and anyone benched drops out.
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
                <Radio size={15} className="shrink-0" /> The draft is live — this is your cheat sheet now.
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
              Pairings are locked in for this round — your board is kept for the record.
            </p>
          )}
        </div>

        {/* The board */}
        <SectionLabel
          trailing={
            <button
              type="button"
              onClick={clearAll}
              disabled={setCount === 0 && matchups.every((m) => !m.teamA.length && !m.teamB.length)}
              className="btn-ghost inline-flex items-center gap-1 text-xs text-muted-foreground disabled:opacity-40"
            >
              <Eraser size={13} /> Clear
            </button>
          }
        >
          Matchups · {setCount}/{slotCount} set
        </SectionLabel>

        <div className="space-y-2">
          {matchups.map((m, i) => (
            <PlanMatchupCard
              key={i}
              index={i}
              matchup={m}
              perSide={perSide}
              meta={meta}
              myTeam={myTeam}
              activeSide={i === activeIndex ? activeSide : null}
              violations={violations[i]}
              onActivate={(team) => activateSide(i, team)}
              onRemove={(team, pid) => removePlayer(i, team, pid)}
            />
          ))}
        </div>

        {strandWarnings.map(({ team, warning }) => (
          <div
            key={team}
            className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              {meta.teamName(team)}: {warning}
            </span>
          </div>
        ))}

        {/* The pool, for whichever side is being filled */}
        <SectionLabel>Add to matchup {(targetIndex ?? activeIndex) + 1}</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {PLAN_TEAMS.map((team) => {
            const on = activeSide === team;
            const color = meta.teamColor(team);
            return (
              <button
                key={team}
                type="button"
                onClick={() => setActiveSide(team)}
                aria-pressed={on}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-sm font-bold transition-all duration-150",
                  on ? "border-transparent text-white" : "border-border text-muted-foreground hover:bg-muted"
                )}
                style={on ? { background: color } : undefined}
              >
                {meta.teamName(team)}
                <span className={cn("ml-1.5 text-xs font-semibold", on ? "opacity-80" : "opacity-70")}>
                  {unassigned[team].length} left
                </span>
              </button>
            );
          })}
        </div>
        {myTeam && (
          <p className="px-1 text-xs text-muted-foreground">
            {activeSide === myTeam
              ? "Your side — who you'd put together."
              : "Their side — your guess at how they'll pair up."}
          </p>
        )}

        {unassigned[activeSide].length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">
            Every {meta.teamName(activeSide)} player is placed.
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
                  if (alreadyDrafted[activeSide].has(pid)) disabledReason = "Already picked in the live draft";
                  else if (targetIndex == null) disabledReason = "Every matchup is full on this side";
                  else
                    disabledReason =
                      cannotAddToSide(matchups[targetIndex][activeSide], pid, perSide, tierMap) ?? undefined;
                  return (
                    <PlayerPickRow
                      key={pid}
                      pid={pid}
                      meta={meta}
                      teamColor={activeColor}
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
          placeholder="Who to hold back, which of their pairs you want to draw, anything you want to remember at the tee…"
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
