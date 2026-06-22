/**
 * Tournament-milestone notifications: overall team lead changes, a round going
 * final, and the champion being decided. All three share the single "tournament"
 * notification category (one player-facing toggle).
 *
 * Wired in index.ts as an onDocumentWritten("rounds/{roundId}") trigger —
 * per-round point totals are written there by computeRoundTotals, so this reacts
 * to that write-back rather than to raw match keystrokes. Standings are summed
 * across every round of the tournament, mirroring the frontend
 * (useTournamentData + getTournamentWinner) so copy matches what players see.
 *
 * Idempotency/state lives in tournamentNotifyState/{tournamentId} (off the
 * tournament doc, so clients subscribed to the tournament aren't churned and no
 * other trigger is re-fired).
 */

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Change, FirestoreEvent } from "firebase-functions/v2/firestore";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { notify, type NotifyPayload } from "./notify.js";
import { loadTournamentMeta } from "../helpers/roster.js";

function db() {
  return getFirestore();
}

export type RoundWriteEvent = FirestoreEvent<Change<DocumentSnapshot> | undefined, { roundId: string }>;

type TeamKey = "teamA" | "teamB";

/** Format a point total: whole numbers plain, halves with one decimal ("3", "3.5"). */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function teamLabel(team: TeamKey, teamAName: string, teamBName: string): string {
  return team === "teamA" ? teamAName : teamBName;
}

/**
 * Server-side mirror of rowdy-ui/src/utils.ts `getTournamentWinner`: a champion
 * exists when a team has clinched on confirmed points (a majority the other can
 * no longer catch) or the admin set a tiebreaker winner. Keep in sync with the
 * frontend so the banner and this notification agree on "who won".
 */
function getTournamentWinner(
  tiebreakerWinner: TeamKey | undefined,
  teamAConfirmed: number,
  teamBConfirmed: number,
  totalPointsAvailable: number
): TeamKey | null {
  if (tiebreakerWinner === "teamA" || tiebreakerWinner === "teamB") return tiebreakerWinner;
  if (totalPointsAvailable > 0) {
    const pointsToWin = totalPointsAvailable / 2 + 0.5;
    if (teamAConfirmed >= pointsToWin) return "teamA";
    if (teamBConfirmed >= pointsToWin) return "teamB";
  }
  return null;
}

/** A round is final once every one of its matches is closed. */
async function isRoundComplete(roundId: string): Promise<boolean> {
  const snap = await db().collection("matches").where("roundId", "==", roundId).get();
  if (snap.empty) return false;
  return snap.docs.every((d) => d.data().status?.closed === true);
}

export async function handleTournamentNotify(event: RoundWriteEvent): Promise<void> {
  const after = event.data?.after?.data();
  if (!after) return;
  const before = event.data?.before?.data();

  // Only react when this round's point totals actually changed (skip roundIds
  // links, lock toggles, seed merges — every other rounds/{id} write).
  if (before?.pointTotals?._sig === after.pointTotals?._sig) return;

  const tournamentId = after.tournamentId;
  if (!tournamentId || typeof tournamentId !== "string") return;

  // Sum every round's totals for the tournament (mirror useTournamentData).
  const roundsSnap = await db().collection("rounds").where("tournamentId", "==", tournamentId).get();
  let confirmedA = 0, confirmedB = 0, pendingA = 0, pendingB = 0, computedTotal = 0;
  for (const d of roundsSnap.docs) {
    const pt = d.data().pointTotals;
    if (!pt) continue;
    confirmedA += pt.teamAConfirmed ?? 0;
    confirmedB += pt.teamBConfirmed ?? 0;
    pendingA += pt.teamAPending ?? 0;
    pendingB += pt.teamBPending ?? 0;
    computedTotal += (d.data().pointsValue ?? 1) * (pt.matchCount ?? 0);
  }

  const meta = await loadTournamentMeta(tournamentId);
  if (meta.playerIds.length === 0) return;
  const { teamAName, teamBName } = meta;
  const totalPointsAvailable = meta.totalPointsAvailable ?? computedTotal;

  // Live standing (confirmed + pending) drives the lead; clinch uses confirmed only.
  const liveA = confirmedA + pendingA;
  const liveB = confirmedB + pendingB;
  const liveLeader: TeamKey | null = liveA > liveB ? "teamA" : liveB > liveA ? "teamB" : null;
  const champion = getTournamentWinner(meta.tiebreakerWinner, confirmedA, confirmedB, totalPointsAvailable);

  const stateRef = db().collection("tournamentNotifyState").doc(tournamentId);
  const state = (await stateRef.get()).data() || {};
  const prevLeader: TeamKey | null = state.overallLeader ?? null;
  const roundsFinal: Record<string, boolean> = state.roundsFinal ?? {};

  const payloads: NotifyPayload[] = [];
  const nextState: Record<string, unknown> = {};

  // 1. Champion decided (once).
  if (champion && !state.championNotified) {
    payloads.push({
      category: "tournament",
      title: "🏆 Champions",
      body: `${teamLabel(champion, teamAName, teamBName)} win the Rowdy Cup!`,
      link: "/",
    });
    nextState.championNotified = true;
  }

  // 2. Overall lead change — suppressed once a champion is crowned (the Cup's over).
  if (!champion && liveLeader && liveLeader !== prevLeader) {
    const lead = liveLeader === "teamA" ? `${fmt(liveA)}–${fmt(liveB)}` : `${fmt(liveB)}–${fmt(liveA)}`;
    payloads.push({
      category: "tournament",
      title: "Lead change",
      body: `${teamLabel(liveLeader, teamAName, teamBName)} take the lead, ${lead}`,
      link: "/",
    });
    nextState.overallLeader = liveLeader;
  }

  // 3. This round just went final (all its matches closed).
  const roundId = event.params.roundId;
  if (!roundsFinal[roundId] && (await isRoundComplete(roundId))) {
    const pt = after.pointTotals ?? {};
    const a = pt.teamAConfirmed ?? 0;
    const b = pt.teamBConfirmed ?? 0;
    const body =
      a > b
        ? `${teamAName} won the round ${fmt(a)}–${fmt(b)}`
        : b > a
          ? `${teamBName} won the round ${fmt(b)}–${fmt(a)}`
          : `Round tied ${fmt(a)}–${fmt(b)}`;
    payloads.push({ category: "tournament", title: "Round complete", body, link: `/round/${roundId}` });
    nextState.roundsFinal = { ...roundsFinal, [roundId]: true };
  }

  if (payloads.length === 0) return;

  for (const payload of payloads) {
    await notify(meta.playerIds, payload);
  }
  await stateRef.set({ ...nextState, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
