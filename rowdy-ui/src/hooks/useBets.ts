/**
 * Sportsbook data hooks.
 *
 * A tournament's bet volume is small (a couple dozen players), so client-side
 * selectors back the whole feature. To keep reads bounded, the realtime listener
 * only carries the actionable bets (open/pending/active) — the ever-growing
 * settled history is loaded once with a one-time read (refreshed only when a bet
 * settles), and terminal noise (void/cancelled/declined) is never read at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { toDateOrNull } from "../utils";
import { rosterPlayerIds } from "../utils/roster";
import { usePlayers } from "../contexts/TournamentContext";
import { useAuth } from "../contexts/AuthContext";
import type { BetDoc, BetSettlementDoc, PlayerDoc, TournamentDoc } from "../types";

/** Bet statuses a player can still act on — the only ones worth a realtime listener. */
const LIVE_BET_STATUSES = ["open", "active"] as const;

// ============================================================================
// SUBSCRIPTION
// ============================================================================

export interface UseBetsResult {
  bets: BetDoc[];
  loading: boolean;
  error: string | null;
}

/**
 * Back the sportsbook with a bounded realtime listener over the actionable bets
 * (open/pending/active) plus a one-time read of settled bets for the Standings /
 * head-to-head / completed views. Returns the merged set, newest first.
 */
export function useBets(tournamentId: string | undefined): UseBetsResult {
  const { user } = useAuth();
  const [liveBets, setLiveBets] = useState<BetDoc[]>([]);
  const [settledBets, setSettledBets] = useState<BetDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Realtime listener over the small, actively-changing set of bets. Drops the
  // settled history and terminal noise (void/cancelled/declined) from the listener.
  // Bets reads require auth (Firestore rules), so don't even open the listener
  // when signed out — the route is gated by RequireAuth, this is defense in depth.
  useEffect(() => {
    if (!tournamentId || !user) {
      setLiveBets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      query(
        collection(db, "bets"),
        where("tournamentId", "==", tournamentId),
        where("status", "in", [...LIVE_BET_STATUSES])
      ),
      (snap) => {
        setLiveBets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BetDoc)));
        setLoading(false);
      },
      (err) => {
        console.error("Bets subscription error:", err);
        setError("Unable to load bets.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [tournamentId, user]);

  // Settled bets are terminal, so a one-time read beats a permanent listener.
  const refreshSettled = useCallback(() => {
    if (!tournamentId || !user) {
      setSettledBets([]);
      return;
    }
    getDocs(
      query(collection(db, "bets"), where("tournamentId", "==", tournamentId), where("status", "==", "settled"))
    )
      .then((snap) => setSettledBets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BetDoc))))
      .catch((err) => console.error("Settled bets fetch error:", err));
  }, [tournamentId, user]);

  // Track the prior live-bet id set so we can refresh settled when a bet leaves it
  // (i.e. just settled) — keeping Standings live without a permanent settled listener.
  const liveIdsRef = useRef<string>("");
  useEffect(() => {
    liveIdsRef.current = "";
    refreshSettled();
  }, [refreshSettled]);
  useEffect(() => {
    const prev = liveIdsRef.current;
    const current = new Set(liveBets.map((b) => b.id));
    const ids = [...current].sort().join(",");
    if (prev && ids !== prev) {
      const settledOff = prev.split(",").some((id) => id && !current.has(id));
      if (settledOff) refreshSettled();
    }
    liveIdsRef.current = ids;
  }, [liveBets, refreshSettled]);

  const bets = useMemo(
    () => [...liveBets, ...settledBets].sort((a, b) => betMillis(b) - betMillis(a)),
    [liveBets, settledBets]
  );

  return { bets, loading, error };
}

function betMillis(b: BetDoc): number {
  return toDateOrNull(b.createdAt)?.getTime() ?? 0;
}

/** Settle-up statuses worth reading — cancelled ones are dropped server-side. */
const LIVE_SETTLEMENT_STATUSES = ["pending", "confirmed"] as const;

/**
 * Realtime listener over a tournament's in-play settle-up records (pending +
 * confirmed; cancelled are dropped). The status filter keeps the listener from
 * ever reading the cancelled noise — backed by the (tournamentId, status) index.
 */
export function useBetSettlements(tournamentId: string | undefined): BetSettlementDoc[] {
  const { user } = useAuth();
  const [settlements, setSettlements] = useState<BetSettlementDoc[]>([]);
  useEffect(() => {
    if (!tournamentId || !user) {
      setSettlements([]);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, "betSettlements"),
        where("tournamentId", "==", tournamentId),
        where("status", "in", [...LIVE_SETTLEMENT_STATUSES])
      ),
      (snap) => {
        setSettlements(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BetSettlementDoc));
      },
      (err) => console.error("Bet settlements subscription error:", err)
    );
    return () => unsub();
  }, [tournamentId, user]);
  return settlements;
}

// ============================================================================
// ROSTER PLAYER LOOKUP (for names + the challenge picker)
// ============================================================================

/**
 * Resolve player docs for a tournament's roster, plus any extra IDs (e.g. bet
 * proposerId/acceptorId that may not be on the roster). Backed by the shared
 * player cache in TournamentContext, so the roster is fetched ~once per session
 * instead of on every Sportsbook/Round mount; only genuinely-missing ids fetch.
 * `loading` stays true until the requested names have resolved, so callers can
 * hold a spinner rather than flashing raw player IDs.
 */
export function useRosterPlayers(
  tournament: TournamentDoc | null,
  extraIds: readonly string[] = []
): { players: Record<string, PlayerDoc>; loading: boolean } {
  const ids = [...new Set([...rosterPlayerIds(tournament), ...extraIds.filter(Boolean)])];
  const { players, loaded } = usePlayers(ids);
  return { players, loading: !loaded };
}

// ============================================================================
// PURE SELECTORS (derive views from the subscription)
// ============================================================================

/** Active markets a bet may belong to; a match is bettable until it tees off. */
export function isMatchBettable(m: { status?: { thru?: number; closed?: boolean }; locked?: boolean } | undefined): boolean {
  if (!m) return false;
  if (m.locked === true) return false;
  if (m.status?.closed === true) return false;
  return (m.status?.thru ?? 0) === 0;
}

export interface MyBets {
  incomingChallenges: BetDoc[]; // open challenges where I'm the target
  myOpenOffers: BetDoc[]; // open offers/challenges I posted, not yet taken
  active: BetDoc[]; // locked, not yet settled (I'm involved)
  settled: BetDoc[]; // resolved (I'm involved)
}

/** Split the bets that involve `playerId` into the My-Bets sections. */
export function selectMyBets(bets: BetDoc[], playerId: string | undefined): MyBets {
  const empty: MyBets = { incomingChallenges: [], myOpenOffers: [], active: [], settled: [] };
  if (!playerId) return empty;
  const mine = bets.filter((b) => b.participantIds?.includes(playerId));
  return {
    incomingChallenges: mine.filter(
      (b) => b.status === "open" && b.kind === "challenge" && b.targetId === playerId
    ),
    myOpenOffers: mine.filter((b) => b.status === "open" && b.proposerId === playerId),
    active: mine.filter((b) => b.status === "active"),
    settled: mine.filter((b) => b.status === "settled"),
  };
}

/** Signed result of a settled bet from `playerId`'s perspective (+win / -loss / 0 push). */
export function settledDelta(bet: BetDoc, playerId: string): number {
  if (bet.status !== "settled" || !bet.result) return 0;
  if (bet.result.winnerId === playerId) return bet.result.payout;
  if (bet.result.loserId === playerId) return -bet.result.payout;
  return 0;
}

export interface LedgerRow {
  playerId: string;
  net: number;
  wins: number;
  losses: number;
  pushes: number;
}

/** Net winnings per player across all settled bets, richest first. */
export function computeLedger(bets: BetDoc[]): LedgerRow[] {
  const map = new Map<string, LedgerRow>();
  const row = (id: string): LedgerRow => {
    let r = map.get(id);
    if (!r) {
      r = { playerId: id, net: 0, wins: 0, losses: 0, pushes: 0 };
      map.set(id, r);
    }
    return r;
  };
  for (const b of bets) {
    if (b.status !== "settled" || !b.result) continue;
    if (b.result.outcome === "push") {
      if (b.proposerId) row(b.proposerId).pushes++;
      if (b.acceptorId) row(b.acceptorId).pushes++;
      continue;
    }
    const { winnerId, loserId, payout } = b.result;
    if (winnerId) {
      const w = row(winnerId);
      w.net += payout;
      w.wins++;
    }
    if (loserId) {
      const l = row(loserId);
      l.net -= payout;
      l.losses++;
    }
  }
  return [...map.values()].sort((a, b) => b.net - a.net || a.playerId.localeCompare(b.playerId));
}

export interface HeadToHead {
  otherId: string;
  net: number; // positive => other player owes `playerId`
}

/**
 * Net balance between `playerId` and each opponent: their settled bets, less any
 * confirmed settle-ups between them. Positive => the other player owes `playerId`.
 * Fully-settled (zero) tabs are dropped. Settle-ups adjust this tab only — never
 * the Money Leaders standings (which stay as lifetime betting P&L).
 */
export function headToHead(
  bets: BetDoc[],
  settlements: BetSettlementDoc[],
  playerId: string | undefined
): HeadToHead[] {
  if (!playerId) return [];
  const map = new Map<string, number>();
  for (const b of bets) {
    if (b.status !== "settled" || !b.result || b.result.outcome === "push") continue;
    const { winnerId, loserId, payout } = b.result;
    if (winnerId === playerId && loserId) map.set(loserId, (map.get(loserId) ?? 0) + payout);
    else if (loserId === playerId && winnerId) map.set(winnerId, (map.get(winnerId) ?? 0) - payout);
  }
  for (const s of settlements) {
    if (s.status !== "confirmed") continue;
    // They paid me -> they owe me less; I paid them -> I owe them less.
    if (s.payeeId === playerId) map.set(s.payerId, (map.get(s.payerId) ?? 0) - s.amount);
    else if (s.payerId === playerId) map.set(s.payeeId, (map.get(s.payeeId) ?? 0) + s.amount);
  }
  return [...map.entries()]
    .map(([otherId, net]) => ({ otherId, net }))
    .filter((r) => r.net !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

export interface PendingSettlements {
  incoming: BetSettlementDoc[]; // someone says they paid me — I confirm receipt
  outgoing: BetSettlementDoc[]; // I recorded a payment — awaiting their confirm
}

/** Split a player's pending settle-ups into ones they confirm vs ones they await. */
export function selectPendingSettlements(
  settlements: BetSettlementDoc[],
  playerId: string | undefined
): PendingSettlements {
  const empty: PendingSettlements = { incoming: [], outgoing: [] };
  if (!playerId) return empty;
  const pending = settlements.filter((s) => s.status === "pending");
  return {
    incoming: pending.filter((s) => s.payeeId === playerId),
    outgoing: pending.filter((s) => s.payerId === playerId),
  };
}
