/**
 * Match notifications: fires a web push + in-app notification when a match's
 * standing changes in a way players care about — the lead flips, or the match
 * closes with a result.
 *
 * Wired in index.ts as an onDocumentWritten("matches/{matchId}") trigger. It is
 * separate from the perf-sensitive computeMatchOnWrite (which writes status/
 * result) and only READS match writes; the lone write it makes is a small
 * idempotency marker in matchNotifyState/{matchId} — deliberately NOT on the
 * match doc, so it never re-triggers the scoring/stats trigger chain.
 *
 * Double-fire semantics: a hole entry first writes `holes` (status still stale →
 * before.status == after.status → no-op here), then computeMatchOnWrite writes
 * fresh `status` → the before/after status diff fires this exactly once. We
 * therefore compare status only, never holes.
 *
 * Recipients are the whole tournament roster ("all matches" scope); each
 * player's per-category preference is applied downstream in notify().
 */

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Change, FirestoreEvent } from "firebase-functions/v2/firestore";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { notify } from "./notify.js";
import { loadTournamentMeta } from "../helpers/roster.js";
import type { MatchStatus } from "../types.js";

function db() {
  return getFirestore();
}

export type MatchWriteEvent = FirestoreEvent<Change<DocumentSnapshot> | undefined, { matchId: string }>;

function teamLabel(team: "teamA" | "teamB", teamAName: string, teamBName: string): string {
  return team === "teamA" ? teamAName : teamBName;
}

/** Final-result line, e.g. "Aviators won 3&2", "Aviators won 2 up", "Match halved". */
function resultBody(status: Partial<MatchStatus>, winner: unknown, teamAName: string, teamBName: string): string {
  if (winner === "teamA" || winner === "teamB") {
    const name = teamLabel(winner, teamAName, teamBName);
    const margin = Math.abs(status.margin ?? 0);
    const holesLeft = 18 - (status.thru ?? 18);
    return holesLeft > 0 ? `${name} won ${margin}&${holesLeft}` : `${name} won ${margin} up`;
  }
  return "Match halved";
}

export async function handleMatchNotify(event: MatchWriteEvent): Promise<void> {
  const after = event.data?.after?.data();
  if (!after) return;
  const before = event.data?.before?.data();

  const beforeStatus = (before?.status ?? {}) as Partial<MatchStatus>;
  const afterStatus = (after.status ?? {}) as Partial<MatchStatus>;

  // Edge-triggered on the status-write only.
  const justClosed = afterStatus.closed === true && beforeStatus.closed !== true;
  const leaderFlipped = !!afterStatus.leader && afterStatus.leader !== beforeStatus.leader;
  // On the closing write the result is the meaningful event — don't also send a
  // lead-change for the same write.
  if (!justClosed && !leaderFlipped) return;

  // Idempotency: dedupe redelivered events (triggers are at-least-once). Keyed off
  // the event kind + the standing it represents, stored off the match doc.
  const sig = justClosed
    ? `closed:${afterStatus.leader ?? "AS"}:${afterStatus.margin ?? 0}:${afterStatus.thru ?? 0}`
    : `lead:${afterStatus.leader}:${afterStatus.thru ?? 0}`;
  const stateRef = db().collection("matchNotifyState").doc(event.params.matchId);
  if ((await stateRef.get()).data()?.sig === sig) return;

  const tournamentId = after.tournamentId;
  if (!tournamentId || typeof tournamentId !== "string") return;
  const meta = await loadTournamentMeta(tournamentId);
  if (meta.playerIds.length === 0) return;

  const link = `/match/${event.params.matchId}`;
  if (justClosed) {
    await notify(meta.playerIds, {
      category: "matchResult",
      title: "Final",
      body: resultBody(afterStatus, after.result?.winner, meta.teamAName, meta.teamBName),
      link,
    });
  } else {
    const name = teamLabel(afterStatus.leader as "teamA" | "teamB", meta.teamAName, meta.teamBName);
    await notify(meta.playerIds, {
      category: "matchLeadChange",
      title: "Lead change",
      body: `${name} now lead ${Math.abs(afterStatus.margin ?? 0)} up thru ${afterStatus.thru ?? 0}`,
      link,
    });
  }

  await stateRef.set({ sig, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
