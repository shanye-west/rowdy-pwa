/**
 * Callables for settling up head-to-head betting tabs ("mark as paid").
 *
 * Friendly, real-money debts between players. The debtor records a payment
 * (recordSettlement -> "pending"); the creditor confirms receipt
 * (confirmSettlement -> "confirmed"). Either party may cancelSettlement while
 * pending. Confirmed settlements reduce the amounts-owed tab the UI derives from
 * settled bets — they never touch the Money Leaders standings.
 *
 * All writes go through these callables — betSettlements is locked to clients by
 * the security rules. The outstanding-owed guard scopes its settled-bets read to
 * the payer (via participantIds) so it doesn't grow with the tournament's bet
 * history; the handful of settlements are read in full and filtered in code.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requirePlayer } from "../helpers/adminAuth.js";
import type { BetDoc, BetSettlementDoc } from "../types.js";

function db() {
  return getFirestore();
}

const MAX_SETTLEMENT_AMOUNT = 1_000_000;

function requireSettlementId(data: unknown): string {
  const id = (data as { settlementId?: unknown } | null)?.settlementId;
  if (!id || typeof id !== "string") {
    throw new HttpsError("invalid-argument", "Missing settlementId");
  }
  return id;
}

/**
 * How much `payerId` currently owes `payeeId` in this tournament: the net of
 * their settled head-to-head bets, less settlements already recorded between them
 * (pending payer→payee reservations included so a debt can't be double-settled).
 * Clamped at 0.
 */
async function outstandingOwed(tournamentId: string, payerId: string, payeeId: string): Promise<number> {
  const [betsSnap, settlementsSnap] = await Promise.all([
    // Only the payer's settled bets can contribute to what they owe — every
    // settled bet carries both players in participantIds (set on accept), so we
    // scope by it instead of scanning the whole tournament's settled history.
    db()
      .collection("bets")
      .where("tournamentId", "==", tournamentId)
      .where("status", "==", "settled")
      .where("participantIds", "array-contains", payerId)
      .get(),
    db().collection("betSettlements").where("tournamentId", "==", tournamentId).get(),
  ]);

  let owed = 0; // positive => payer owes payee
  for (const d of betsSnap.docs) {
    const b = d.data() as BetDoc;
    const r = b.result;
    if (!r || r.outcome === "push") continue;
    if (r.loserId === payerId && r.winnerId === payeeId) owed += r.payout;
    else if (r.winnerId === payerId && r.loserId === payeeId) owed -= r.payout;
  }
  for (const d of settlementsSnap.docs) {
    const s = d.data() as BetSettlementDoc;
    if (s.status !== "pending" && s.status !== "confirmed") continue;
    if (s.payerId === payerId && s.payeeId === payeeId) owed -= s.amount;
    else if (s.payerId === payeeId && s.payeeId === payerId) owed += s.amount;
  }
  return Math.max(0, owed);
}

/**
 * Debtor records that they've paid a creditor, clearing part of their tab. The
 * amount is capped at what they currently owe, so the tab can't go negative.
 */
export const recordSettlement = onCall(async (request) => {
  const { playerId } = await requirePlayer(request, "recordSettlement", { maxCalls: 30, windowSeconds: 60 });
  const data = (request.data || {}) as Record<string, unknown>;
  const { tournamentId, payeeId, amount } = data;

  if (!tournamentId || typeof tournamentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing tournamentId");
  }
  if (!payeeId || typeof payeeId !== "string") {
    throw new HttpsError("invalid-argument", "Missing payeeId");
  }
  if (payeeId === playerId) {
    throw new HttpsError("invalid-argument", "You can't settle up with yourself");
  }
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > MAX_SETTLEMENT_AMOUNT) {
    throw new HttpsError("invalid-argument", "amount must be a positive whole number");
  }

  const payeeSnap = await db().collection("players").doc(payeeId).get();
  if (!payeeSnap.exists) throw new HttpsError("not-found", "Player not found");

  const owed = await outstandingOwed(tournamentId, playerId, payeeId);
  if (owed <= 0) {
    throw new HttpsError("failed-precondition", "You don't have an outstanding balance with this player");
  }
  if (amount > owed) {
    throw new HttpsError("failed-precondition", `You only owe $${owed} — can't settle more than that`);
  }

  const ref = db().collection("betSettlements").doc();
  const doc: Omit<BetSettlementDoc, "createdAt" | "confirmedAt"> & { createdAt: FieldValue } = {
    id: ref.id,
    tournamentId,
    payerId: playerId,
    payeeId,
    amount,
    status: "pending",
    initiatedBy: playerId,
    createdAt: FieldValue.serverTimestamp(),
  };
  await ref.set(doc);
  return { success: true, settlementId: ref.id };
});

/** Creditor confirms they received the payment. */
export const confirmSettlement = onCall(async (request) => {
  const { playerId } = await requirePlayer(request, "confirmSettlement", { maxCalls: 30, windowSeconds: 60 });
  const settlementId = requireSettlementId(request.data);
  const ref = db().collection("betSettlements").doc(settlementId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Settlement not found");
    const s = snap.data() as BetSettlementDoc;
    if (s.status !== "pending") throw new HttpsError("failed-precondition", "This settlement is not pending");
    if (s.payeeId !== playerId) {
      throw new HttpsError("permission-denied", "Only the player who was paid can confirm receipt");
    }
    tx.update(ref, { status: "confirmed", confirmedAt: FieldValue.serverTimestamp() });
  });

  return { success: true };
});

/** Either party calls off a pending settlement (e.g. recorded by mistake / disputed). */
export const cancelSettlement = onCall(async (request) => {
  const { playerId } = await requirePlayer(request, "cancelSettlement", { maxCalls: 30, windowSeconds: 60 });
  const settlementId = requireSettlementId(request.data);
  const ref = db().collection("betSettlements").doc(settlementId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Settlement not found");
    const s = snap.data() as BetSettlementDoc;
    if (s.status !== "pending") throw new HttpsError("failed-precondition", "This settlement can no longer be changed");
    if (s.payerId !== playerId && s.payeeId !== playerId) {
      throw new HttpsError("permission-denied", "You are not part of this settlement");
    }
    tx.update(ref, { status: "cancelled" });
  });

  return { success: true };
});
