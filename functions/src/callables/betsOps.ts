/**
 * Callables for the sportsbook (peer-to-peer betting) feature.
 *
 * Every action is taken by an ordinary logged-in player (resolved via
 * requirePlayer); only settleCupFutures is admin-only. All writes go through
 * these callables — the `bets` collection is locked to clients by the security
 * rules. Settlement math lives in scoring/betSettlement.ts (pure, tested);
 * match-bet settlement runs in the settleMatchBets trigger (index.ts).
 *
 * Lifecycle: open -> pending -> active -> settled, with cancelled/declined/void
 * off-ramps. A bet only becomes active once BOTH parties confirm.
 */

import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireAdmin, requirePlayer } from "../helpers/adminAuth.js";
import { settleCupFutureBet, settleOverUnderBet, settlePlayerMatchupBet } from "../scoring/betSettlement.js";
import { notify } from "../messaging/notify.js";
import { teeTimeToMillis } from "./teeTime.js";
import type { BetDoc, BetMarket, BetOverUnderMetric, BetSide } from "../types.js";

function db() {
  return getFirestore();
}

/** A player's denormalized display name (falls back to the id). */
async function displayName(playerId: string): Promise<string> {
  const snap = await db().collection("players").doc(playerId).get();
  return (snap.data()?.displayName as string | undefined) || playerId;
}

const MAX_BET_AMOUNT = 1_000_000;

/** Over/under metrics that read from a single match (gated like a match bet). */
const MATCH_SCOPED_METRICS: BetOverUnderMetric[] = ["matchHolesPlayed", "matchMargin"];

function isTeamSide(v: unknown): v is "teamA" | "teamB" {
  return v === "teamA" || v === "teamB";
}

function isOverUnderSide(v: unknown): v is "over" | "under" {
  return v === "over" || v === "under";
}

function isMarket(v: unknown): v is BetMarket {
  return v === "match" || v === "round" || v === "cupFuture" || v === "overUnder" || v === "playerMatchup";
}

function isMetric(v: unknown): v is BetOverUnderMetric {
  return (
    v === "matchHolesPlayed" ||
    v === "matchMargin" ||
    v === "playerTournamentPoints" ||
    v === "playerTournamentWins"
  );
}

/** Confirm a player doc exists; returns its id for persistence. */
async function requirePlayerExists(playerId: unknown, label: string): Promise<string> {
  if (!playerId || typeof playerId !== "string") {
    throw new HttpsError("invalid-argument", `${label} is required`);
  }
  const snap = await db().collection("players").doc(playerId).get();
  if (!snap.exists) throw new HttpsError("not-found", `${label}: player not found`);
  return playerId;
}

function oppositeSide(side: BetSide): BetSide {
  switch (side) {
    case "teamA":
      return "teamB";
    case "teamB":
      return "teamA";
    case "over":
      return "under";
    case "under":
      return "over";
  }
}

function requireBetId(data: unknown): string {
  const betId = (data as { betId?: unknown } | null)?.betId;
  if (!betId || typeof betId !== "string") {
    throw new HttpsError("invalid-argument", "Missing betId");
  }
  return betId;
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** A match has begun once any hole is scored, it has closed, or its tee time passed. */
function matchStartedPlay(m: FirebaseFirestore.DocumentData): boolean {
  const thru = m.status?.thru ?? 0;
  if (typeof thru === "number" && thru > 0) return true;
  if (m.status?.closed === true) return true;
  // teeTime is a venue-local wall-clock string; teeTimeToMillis interprets it in
  // the venue timezone so "tee time has passed" is judged correctly.
  const teeMs = teeTimeToMillis(m.teeTime);
  return teeMs !== null && teeMs <= Date.now();
}

// matchStartedPlay only reads status + teeTime; project to those so these scans
// transfer/deserialize a fraction of each match doc (trims payload, not the
// billed read count — that's bounded by match count, so it doesn't grow).
const STARTED_FIELDS = ["status", "teeTime"] as const;

/** True once a tournament's play has begun — used to lock Cup-futures betting. */
async function isTournamentStarted(tournamentId: string): Promise<boolean> {
  const snap = await db()
    .collection("matches")
    .where("tournamentId", "==", tournamentId)
    .select(...STARTED_FIELDS)
    .get();
  return snap.docs.some((d) => matchStartedPlay(d.data()));
}

/** True once any match in a round has begun — used to lock round/session betting. */
async function isRoundStarted(roundId: string): Promise<boolean> {
  const snap = await db()
    .collection("matches")
    .where("roundId", "==", roundId)
    .select(...STARTED_FIELDS)
    .get();
  return snap.docs.some((d) => matchStartedPlay(d.data()));
}

/** True if a single match is no longer bettable (started, locked, or gone). */
async function isMatchClosed(matchId: string | undefined): Promise<boolean> {
  if (!matchId) return true;
  const snap = await db().collection("matches").doc(matchId).get();
  if (!snap.exists) return true;
  const m = snap.data()!;
  return matchStartedPlay(m) || m.locked === true;
}

/**
 * Whether a bet's market is no longer open to wagering. Match markets (and
 * match-scoped over/unders) close when the match starts; round markets when the
 * round starts; cup futures when the tournament starts. Read outside transactions;
 * the settlement trigger + confirm guard are the backstops against the race window.
 */
async function marketClosed(
  bet: Pick<BetDoc, "market" | "matchId" | "roundId" | "tournamentId" | "metric">
): Promise<boolean> {
  if (bet.market === "match") return isMatchClosed(bet.matchId);
  if (bet.market === "round") return bet.roundId ? isRoundStarted(bet.roundId) : true;
  if (bet.market === "overUnder") {
    // Match-scoped over/unders close with their match; player-points props are
    // tournament-scoped and close when the tournament starts.
    if (bet.metric && MATCH_SCOPED_METRICS.includes(bet.metric)) return isMatchClosed(bet.matchId);
    return isTournamentStarted(bet.tournamentId);
  }
  // cupFuture + playerMatchup are tournament-scoped.
  return isTournamentStarted(bet.tournamentId);
}

/** Loads a tournament and asserts the sportsbook is enabled for it. */
async function requireSportsbookTournament(tournamentId: string): Promise<void> {
  const snap = await db().collection("tournaments").doc(tournamentId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Tournament not found");
  if (snap.data()?.sportsbookEnabled !== true) {
    throw new HttpsError("failed-precondition", "Betting is not enabled for this tournament");
  }
}

/** Shared create path for open offers and directed challenges. */
async function createBet(
  request: CallableRequest,
  proposerId: string,
  directed: boolean
): Promise<{ success: true; betId: string }> {
  const data = (request.data || {}) as Record<string, unknown>;
  const { tournamentId, market, matchId, roundId, metric, line, side, amount, targetId } = data;

  // Validated player references, persisted below for player-centric markets.
  let subjectId: string | undefined;   // player O/U
  let subjectAId: string | undefined;  // playerMatchup teamA side
  let subjectBId: string | undefined;  // playerMatchup teamB side

  if (!tournamentId || typeof tournamentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing tournamentId");
  }
  if (!isMarket(market)) {
    throw new HttpsError("invalid-argument", "Invalid betting market");
  }
  // Sides are teams for match/round/cupFuture, over/under for overUnder.
  if (market === "overUnder") {
    if (!isOverUnderSide(side)) throw new HttpsError("invalid-argument", "side must be 'over' or 'under'");
  } else if (!isTeamSide(side)) {
    throw new HttpsError("invalid-argument", "side must be 'teamA' or 'teamB'");
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > MAX_BET_AMOUNT) {
    throw new HttpsError("invalid-argument", "amount must be a positive number");
  }

  await requireSportsbookTournament(tournamentId);

  // Per-market bettability + required references.
  if (market === "match") {
    if (!matchId || typeof matchId !== "string") {
      throw new HttpsError("invalid-argument", "matchId is required for match bets");
    }
    const matchSnap = await db().collection("matches").doc(matchId).get();
    if (!matchSnap.exists) throw new HttpsError("not-found", "Match not found");
    const m = matchSnap.data()!;
    if (m.tournamentId && m.tournamentId !== tournamentId) {
      throw new HttpsError("invalid-argument", "Match is not in this tournament");
    }
    if (matchStartedPlay(m) || m.locked === true) {
      throw new HttpsError("failed-precondition", "Betting on this match is closed — it has already started");
    }
  } else if (market === "round") {
    if (!roundId || typeof roundId !== "string") {
      throw new HttpsError("invalid-argument", "roundId is required for round bets");
    }
    const roundSnap = await db().collection("rounds").doc(roundId).get();
    if (!roundSnap.exists) throw new HttpsError("not-found", "Round not found");
    if (roundSnap.data()?.tournamentId !== tournamentId) {
      throw new HttpsError("invalid-argument", "Round is not in this tournament");
    }
    if (await isRoundStarted(roundId)) {
      throw new HttpsError("failed-precondition", "Betting on this round is closed — it has already started");
    }
  } else if (market === "overUnder") {
    if (!isMetric(metric)) {
      throw new HttpsError("invalid-argument", "A valid over/under metric is required");
    }
    if (typeof line !== "number" || !Number.isFinite(line) || line <= 0) {
      throw new HttpsError("invalid-argument", "A positive line is required");
    }
    if (MATCH_SCOPED_METRICS.includes(metric)) {
      if (!matchId || typeof matchId !== "string") {
        throw new HttpsError("invalid-argument", "matchId is required for this over/under");
      }
      const matchSnap = await db().collection("matches").doc(matchId).get();
      if (!matchSnap.exists) throw new HttpsError("not-found", "Match not found");
      const m = matchSnap.data()!;
      if (m.tournamentId && m.tournamentId !== tournamentId) {
        throw new HttpsError("invalid-argument", "Match is not in this tournament");
      }
      if (matchStartedPlay(m) || m.locked === true) {
        throw new HttpsError("failed-precondition", "Betting on this match is closed — it has already started");
      }
    } else {
      // playerTournamentPoints / playerTournamentWins: tournament-scoped prop
      // on a single player.
      subjectId = await requirePlayerExists(data.subjectId, "subjectId");
      if (await isTournamentStarted(tournamentId)) {
        throw new HttpsError("failed-precondition", "Player props betting is closed — the tournament has started");
      }
    }
  } else if (market === "playerMatchup") {
    subjectAId = await requirePlayerExists(data.subjectAId, "subjectAId");
    subjectBId = await requirePlayerExists(data.subjectBId, "subjectBId");
    if (subjectAId === subjectBId) {
      throw new HttpsError("invalid-argument", "A matchup needs two different players");
    }
    if (await isTournamentStarted(tournamentId)) {
      throw new HttpsError("failed-precondition", "Player props betting is closed — the tournament has started");
    }
  } else if (await isTournamentStarted(tournamentId)) {
    throw new HttpsError("failed-precondition", "Cup futures betting is closed — the tournament has started");
  }

  let target: string | undefined;
  if (directed) {
    if (!targetId || typeof targetId !== "string") {
      throw new HttpsError("invalid-argument", "targetId is required for a challenge");
    }
    if (targetId === proposerId) {
      throw new HttpsError("invalid-argument", "You can't challenge yourself");
    }
    const targetSnap = await db().collection("players").doc(targetId).get();
    if (!targetSnap.exists) throw new HttpsError("not-found", "Target player not found");
    target = targetId;
  }

  const ref = db().collection("bets").doc();
  const doc: Record<string, unknown> = {
    id: ref.id,
    tournamentId,
    market,
    kind: directed ? "challenge" : "offer",
    status: "open",
    amount,
    proposerId,
    proposerSide: side,
    proposerConfirmed: false,
    acceptorConfirmed: false,
    participantIds: directed && target ? dedupe([proposerId, target]) : [proposerId],
    createdAt: FieldValue.serverTimestamp(),
  };
  // Persist only the references each market needs.
  if (typeof matchId === "string" && (market === "match" || market === "overUnder")) doc.matchId = matchId;
  if (market === "round" && typeof roundId === "string") doc.roundId = roundId;
  if (market === "overUnder") {
    doc.metric = metric;
    doc.line = line;
    if (subjectId) doc.subjectId = subjectId;
  }
  if (market === "playerMatchup") {
    doc.subjectAId = subjectAId;
    doc.subjectBId = subjectBId;
  }
  if (target) doc.targetId = target;

  await ref.set(doc);
  return { success: true, betId: ref.id };
}

/** Post an open marketplace offer (anyone may take the other side). */
export const createBetOffer = onCall(async (request) => {
  const { playerId } = await requirePlayer(request, "createBetOffer", { maxCalls: 30, windowSeconds: 60 });
  return createBet(request, playerId, false);
});

/** Post a directed challenge to one specific player. */
export const createBetChallenge = onCall(async (request) => {
  const { playerId } = await requirePlayer(request, "createBetChallenge", { maxCalls: 30, windowSeconds: 60 });
  const result = await createBet(request, playerId, true);

  // Best-effort push to the challenged player — never fail the bet on this.
  try {
    const data = (request.data || {}) as Record<string, unknown>;
    const targetId = typeof data.targetId === "string" ? data.targetId : null;
    const amount = typeof data.amount === "number" ? data.amount : null;
    if (targetId) {
      const name = await displayName(playerId);
      await notify([targetId], {
        category: "sportsbook",
        title: "New bet challenge",
        body: amount ? `${name} challenged you to a $${amount} bet` : `${name} challenged you to a bet`,
        link: "/sportsbook",
      });
    }
  } catch (err) {
    console.error("createBetChallenge notify failed:", err);
  }

  return result;
});

/**
 * Take the other side of an open offer (or accept a directed challenge). Posting
 * the offer/challenge was the proposer's commitment, so accepting locks the bet
 * in straight away (`active`) — no separate confirmation step. Either party can
 * still cancel it until the market starts. The transaction prevents two players
 * grabbing the same offer.
 */
export const acceptBet = onCall(async (request) => {
  const { playerId } = await requirePlayer(request, "acceptBet", { maxCalls: 60, windowSeconds: 60 });
  const betId = requireBetId(request.data);
  const ref = db().collection("bets").doc(betId);

  // Read current bet first so the market-open check can hit the right doc.
  const pre = await ref.get();
  if (!pre.exists) throw new HttpsError("not-found", "Bet not found");
  const preBet = pre.data() as BetDoc;
  if (await marketClosed(preBet)) {
    throw new HttpsError("failed-precondition", "Betting is closed for this market");
  }

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Bet not found");
    const bet = snap.data() as BetDoc;
    if (bet.status !== "open") throw new HttpsError("failed-precondition", "This bet is no longer available");
    if (bet.proposerId === playerId) throw new HttpsError("failed-precondition", "You can't take your own bet");
    if (bet.kind === "challenge" && bet.targetId !== playerId) {
      throw new HttpsError("permission-denied", "This challenge was sent to someone else");
    }
    tx.update(ref, {
      acceptorId: playerId,
      acceptorSide: oppositeSide(bet.proposerSide),
      status: "active",
      proposerConfirmed: true,
      acceptorConfirmed: true,
      acceptedAt: FieldValue.serverTimestamp(),
      lockedAt: FieldValue.serverTimestamp(),
      participantIds: dedupe([bet.proposerId, playerId]),
    });
  });

  // Best-effort push to the proposer that someone locked in their bet.
  try {
    const name = await displayName(playerId);
    await notify([preBet.proposerId], {
      category: "sportsbook",
      title: "Bet locked in",
      body: `${name} took your $${preBet.amount} bet — it's locked in`,
      link: "/sportsbook",
    });
  } catch (err) {
    console.error("acceptBet notify failed:", err);
  }

  return { success: true };
});

/**
 * Pull a bet out of play.
 *  - `open` / `pending`: only the proposer can cancel (it isn't locked yet).
 *  - `active` (locked in): either party may call it off, but only while the
 *    market is still open — i.e. before the match (or, for futures, the
 *    tournament) has started. Once play begins the bet stands.
 */
export const cancelBet = onCall(async (request) => {
  const { playerId } = await requirePlayer(request, "cancelBet", { maxCalls: 60, windowSeconds: 60 });
  const betId = requireBetId(request.data);
  const ref = db().collection("bets").doc(betId);

  // Read first so an active bet can be checked against its (started?) market
  // outside the transaction; the small race is acceptable for a cancel.
  const pre = await ref.get();
  if (!pre.exists) throw new HttpsError("not-found", "Bet not found");
  const preBet = pre.data() as BetDoc;
  const marketIsClosed = preBet.status === "active" ? await marketClosed(preBet) : false;

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Bet not found");
    const bet = snap.data() as BetDoc;

    if (bet.status === "open" || bet.status === "pending") {
      if (bet.proposerId !== playerId) {
        throw new HttpsError("permission-denied", "Only the proposer can cancel this bet");
      }
    } else if (bet.status === "active") {
      const isParticipant = bet.proposerId === playerId || bet.acceptorId === playerId;
      if (!isParticipant) throw new HttpsError("permission-denied", "You are not part of this bet");
      if (marketIsClosed) {
        throw new HttpsError(
          "failed-precondition",
          "Play has started — this bet is locked in and can no longer be cancelled"
        );
      }
    } else {
      throw new HttpsError("failed-precondition", "This bet can no longer be cancelled");
    }

    tx.update(ref, { status: "cancelled" });
  });

  return { success: true };
});

/** Target declines a directed challenge before taking it. */
export const declineBet = onCall(async (request) => {
  const { playerId } = await requirePlayer(request, "declineBet", { maxCalls: 60, windowSeconds: 60 });
  const betId = requireBetId(request.data);
  const ref = db().collection("bets").doc(betId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Bet not found");
    const bet = snap.data() as BetDoc;
    if (bet.kind !== "challenge") throw new HttpsError("failed-precondition", "Only challenges can be declined");
    if (bet.status !== "open") throw new HttpsError("failed-precondition", "This challenge can no longer be declined");
    if (bet.targetId !== playerId) throw new HttpsError("permission-denied", "This challenge was sent to someone else");
    tx.update(ref, { status: "declined" });
  });

  return { success: true };
});

/**
 * Admin: resolve the Cup-futures market for a tournament. v1 settles futures by
 * explicit admin action (the app has no single authoritative "tournament over"
 * signal). "push" refunds (no money) — used when the Cup is tied/retained.
 */
export const settleCupFutures = onCall(async (request) => {
  await requireAdmin(request, "settleCupFutures", { maxCalls: 10, windowSeconds: 60 });
  const data = (request.data || {}) as Record<string, unknown>;
  const { tournamentId, winningTeam } = data;
  if (!tournamentId || typeof tournamentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing tournamentId");
  }
  if (winningTeam !== "teamA" && winningTeam !== "teamB" && winningTeam !== "push") {
    throw new HttpsError("invalid-argument", "winningTeam must be 'teamA', 'teamB', or 'push'");
  }

  const snap = await db()
    .collection("bets")
    .where("tournamentId", "==", tournamentId)
    .where("market", "==", "cupFuture")
    .where("status", "==", "active")
    .get();

  const batch = db().batch();
  snap.docs.forEach((d) => {
    const result = settleCupFutureBet(d.data() as BetDoc, winningTeam);
    batch.update(d.ref, { status: "settled", result, settledAt: FieldValue.serverTimestamp() });
  });
  await batch.commit();

  return { success: true, settledCount: snap.size };
});

/**
 * Admin: resolve the tournament-long player-futures markets (playerMatchup +
 * player tournament-points/-wins over/unders). Like settleCupFutures, this is an
 * explicit admin action — there is no single authoritative "tournament over"
 * signal. Each player's total points are summed from their playerMatchFacts
 * (the same source aggregatePlayerStats rolls up), so matches must be closed for
 * the totals to be final before settling.
 */
export const settlePlayerFutures = onCall(async (request) => {
  await requireAdmin(request, "settlePlayerFutures", { maxCalls: 10, windowSeconds: 60 });
  const data = (request.data || {}) as Record<string, unknown>;
  const { tournamentId } = data;
  if (!tournamentId || typeof tournamentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing tournamentId");
  }

  // Total tournament points (and won matches) per player from playerMatchFacts.
  const factsSnap = await db().collection("playerMatchFacts").where("tournamentId", "==", tournamentId).get();
  const points = new Map<string, number>();
  const wins = new Map<string, number>();
  factsSnap.docs.forEach((d) => {
    const f = d.data();
    if (typeof f.playerId !== "string") return;
    points.set(f.playerId, (points.get(f.playerId) ?? 0) + (f.pointsEarned ?? 0));
    if (f.outcome === "win") wins.set(f.playerId, (wins.get(f.playerId) ?? 0) + 1);
  });

  const betsSnap = await db()
    .collection("bets")
    .where("tournamentId", "==", tournamentId)
    .where("status", "==", "active")
    .get();

  const batch = db().batch();
  let settledCount = 0;
  betsSnap.docs.forEach((d) => {
    const bet = d.data() as BetDoc;
    let result;
    if (bet.market === "playerMatchup") {
      result = settlePlayerMatchupBet(bet, points.get(bet.subjectAId ?? "") ?? 0, points.get(bet.subjectBId ?? "") ?? 0);
    } else if (bet.market === "overUnder" && bet.metric === "playerTournamentPoints" && typeof bet.line === "number") {
      result = settleOverUnderBet(bet, points.get(bet.subjectId ?? "") ?? 0, bet.line);
    } else if (bet.market === "overUnder" && bet.metric === "playerTournamentWins" && typeof bet.line === "number") {
      result = settleOverUnderBet(bet, wins.get(bet.subjectId ?? "") ?? 0, bet.line);
    } else {
      return; // other markets settle via their own triggers / settleCupFutures
    }
    batch.update(d.ref, { status: "settled", result, settledAt: FieldValue.serverTimestamp() });
    settledCount++;
  });
  if (settledCount > 0) await batch.commit();

  return { success: true, settledCount };
});
