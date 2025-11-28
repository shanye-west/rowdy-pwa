import { onDocumentWritten } from "firebase-functions/v2/firestore";

import { db } from "./firebase";
import { RoundFormat, summarize } from "./utils";

export const computeMatchOnWrite = onDocumentWritten("matches/{matchId}", async (event) => {
  const before = event.data?.before?.data() || {};
  const after  = event.data?.after?.data();
  if (!after) return;

  const changed = [
    ...Object.keys(after).filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k])),
    ...Object.keys(before).filter(k => after[k] === undefined)
  ];
  if (changed.every(k => ["status", "result", "_computeSig"].includes(k))) return;

  const roundId = after.roundId;
  if (!roundId) return;
  const rSnap = await db.collection("rounds").doc(roundId).get();
  const format: RoundFormat = rSnap.data()?.format || "twoManBestBall";

  const s = summarize(format, after);
  const status = {
    leader: s.leader, margin: s.margin, thru: s.thru, dormie: s.dormie, closed: s.closed,
    wasTeamADown3PlusBack9: s.wasTeamADown3PlusBack9,
    wasTeamAUp3PlusBack9: s.wasTeamAUp3PlusBack9,
    marginHistory: s.marginHistory
  };
  const result = { winner: s.winner, holesWonA: s.holesWonA, holesWonB: s.holesWonB };

  if (JSON.stringify(before.status) === JSON.stringify(status) &&
      JSON.stringify(before.result) === JSON.stringify(result)) return;

  await event.data!.after.ref.set({ status, result }, { merge: true });
});
