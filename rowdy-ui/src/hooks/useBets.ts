/**
 * Sportsbook data hooks.
 *
 * A tournament's bet volume is small (a couple dozen players), so a single
 * onSnapshot subscription to all of its bets backs the whole feature; the
 * markets / my-bets / ledger views are derived client-side with the pure
 * selectors below. No aggregation trigger is needed for v1.
 */

import { useEffect, useMemo, useState } from "react";
import { collection, query, where, onSnapshot, documentId, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { toDateOrNull } from "../utils";
import type { BetDoc, PlayerDoc, TournamentDoc } from "../types";

// ============================================================================
// SUBSCRIPTION
// ============================================================================

export interface UseBetsResult {
  bets: BetDoc[];
  loading: boolean;
  error: string | null;
}

/** Subscribe to every bet in a tournament, newest first. */
export function useBets(tournamentId: string | undefined): UseBetsResult {
  const [bets, setBets] = useState<BetDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tournamentId) {
      setBets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      query(collection(db, "bets"), where("tournamentId", "==", tournamentId)),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BetDoc));
        rows.sort((a, b) => betMillis(b) - betMillis(a));
        setBets(rows);
        setLoading(false);
      },
      (err) => {
        console.error("Bets subscription error:", err);
        setError("Unable to load bets.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [tournamentId]);

  return { bets, loading, error };
}

function betMillis(b: BetDoc): number {
  return toDateOrNull(b.createdAt)?.getTime() ?? 0;
}

// ============================================================================
// ROSTER PLAYER LOOKUP (for names + the challenge picker)
// ============================================================================

/** Flatten both teams' rosterByTier into a unique playerId list. */
export function rosterPlayerIds(tournament: TournamentDoc | null): string[] {
  if (!tournament) return [];
  const ids = new Set<string>();
  for (const team of [tournament.teamA, tournament.teamB]) {
    for (const tier of ["A", "B", "C", "D"] as const) {
      for (const pid of team?.rosterByTier?.[tier] ?? []) ids.add(pid);
    }
  }
  return [...ids];
}

/**
 * Batch-fetch player docs for a tournament's roster, plus any extra IDs
 * (e.g. bet proposerId/acceptorId) that may not appear in rosterByTier.
 */
export function useRosterPlayers(tournament: TournamentDoc | null, extraIds: readonly string[] = []): Record<string, PlayerDoc> {
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  // Stable string dep so the effect only re-runs when the ID set actually changes.
  const extraKey = [...extraIds].sort().join(",");
  const ids = useMemo(() => {
    const set = new Set(rosterPlayerIds(tournament));
    for (const id of extraKey ? extraKey.split(",") : []) if (id) set.add(id);
    return [...set].sort().join(",");
  }, [tournament, extraKey]);

  useEffect(() => {
    const idList = ids ? ids.split(",") : [];
    if (idList.length === 0) {
      setPlayers({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const batches: string[][] = [];
        for (let i = 0; i < idList.length; i += 30) batches.push(idList.slice(i, i + 30));
        const result: Record<string, PlayerDoc> = {};
        await Promise.all(
          batches.map(async (batch) => {
            const snap = await getDocs(query(collection(db, "players"), where(documentId(), "in", batch)));
            snap.docs.forEach((d) => {
              result[d.id] = { id: d.id, ...d.data() } as PlayerDoc;
            });
          })
        );
        if (!cancelled) setPlayers(result);
      } catch (err) {
        console.error("Roster players fetch error:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  return players;
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
  pending: BetDoc[]; // taken, awaiting confirmation (I'm involved)
  active: BetDoc[]; // locked, not yet settled (I'm involved)
  settled: BetDoc[]; // resolved (I'm involved)
}

/** Split the bets that involve `playerId` into the My-Bets sections. */
export function selectMyBets(bets: BetDoc[], playerId: string | undefined): MyBets {
  const empty: MyBets = { incomingChallenges: [], myOpenOffers: [], pending: [], active: [], settled: [] };
  if (!playerId) return empty;
  const mine = bets.filter((b) => b.participantIds?.includes(playerId));
  return {
    incomingChallenges: mine.filter(
      (b) => b.status === "open" && b.kind === "challenge" && b.targetId === playerId
    ),
    myOpenOffers: mine.filter((b) => b.status === "open" && b.proposerId === playerId),
    pending: mine.filter((b) => b.status === "pending"),
    active: mine.filter((b) => b.status === "active"),
    settled: mine.filter((b) => b.status === "settled"),
  };
}

/** Whether `playerId` still needs to confirm a pending bet. */
export function needsMyConfirm(bet: BetDoc, playerId: string): boolean {
  if (bet.status !== "pending") return false;
  if (bet.proposerId === playerId) return !bet.proposerConfirmed;
  if (bet.acceptorId === playerId) return !bet.acceptorConfirmed;
  return false;
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

/** Net balance between `playerId` and each opponent they've settled bets with. */
export function headToHead(bets: BetDoc[], playerId: string | undefined): HeadToHead[] {
  if (!playerId) return [];
  const map = new Map<string, number>();
  for (const b of bets) {
    if (b.status !== "settled" || !b.result || b.result.outcome === "push") continue;
    const { winnerId, loserId, payout } = b.result;
    if (winnerId === playerId && loserId) map.set(loserId, (map.get(loserId) ?? 0) + payout);
    else if (loserId === playerId && winnerId) map.set(winnerId, (map.get(winnerId) ?? 0) - payout);
  }
  return [...map.entries()]
    .map(([otherId, net]) => ({ otherId, net }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}
