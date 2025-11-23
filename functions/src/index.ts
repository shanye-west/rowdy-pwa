// functions/src/index.ts
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

type RoundFormat = "twoManBestBall" | "twoManShamble" | "twoManScramble" | "singles";

// --- helpers ---------------------------------------------------------------

function playersPerSide(format: RoundFormat): number {
  return format === "singles" ? 1 : 2;
}

function emptyHolesFor(format: RoundFormat) {
  const holes: Record<string, any> = {};
  for (let i = 1; i <= 18; i++) {
    const k = String(i);
    if (format === "twoManScramble") {
      holes[k] = { input: { teamAGross: null, teamBGross: null } };
    } else if (format === "singles") {
      holes[k] = { input: { teamAPlayerGross: null, teamBPlayerGross: null } };
    } else {
      // twoManBestBall / twoManShamble
      holes[k] = { input: { teamAPlayersGross: [null, null], teamBPlayersGross: [null, null] } };
    }
  }
  return holes;
}

function defaultStatus() {
  return { leader: null, margin: 0, thru: 0, dormie: false, closed: false };
}

function zeros18(): number[] {
  return Array.from({ length: 18 }, () => 0);
}

function ensureSideSize(side: any, count: number) {
  // Build exactly `count` entries; each has playerId "" and 18 zeros for strokes
  const make = () => ({ playerId: "", strokesReceived: zeros18() });

  if (!Array.isArray(side)) {
    return Array.from({ length: count }, make);
  }

  const trimmed = side.slice(0, count).map((p: any) => ({
    playerId: typeof p?.playerId === "string" ? p.playerId : "",
    strokesReceived:
      Array.isArray(p?.strokesReceived) && p.strokesReceived.length === 18
        ? p.strokesReceived
        : zeros18(),
  }));

  while (trimmed.length < count) trimmed.push(make());
  return trimmed;
}

// Normalize a holes map to the desired shape for this format.
// - Preserves existing entered values
// - Inserts missing keys with nulls
// - Migrates singles from array form → single-value form when needed
function normalizeHoles(existing: Record<string, any> | undefined, format: RoundFormat) {
  const desired = emptyHolesFor(format);
  const holes: Record<string, any> = { ...(existing || {}) };

  for (let i = 1; i <= 18; i++) {
    const k = String(i);
    const want = desired[k];
    const ex = holes[k];

    if (!ex || typeof ex !== "object") {
      holes[k] = want;
      continue;
    }

    const exInput = ex.input ?? {};
    if (format === "twoManScramble") {
      const a = exInput.teamAGross ?? null;
      const b = exInput.teamBGross ?? null;
      holes[k] = { input: { teamAGross: a, teamBGross: b } };
    } else if (format === "singles") {
      // Accept either old array form or single-value form; normalize to single values.
      let a = exInput.teamAPlayerGross;
      let b = exInput.teamBPlayerGross;

      if (a == null && Array.isArray(exInput.teamAPlayersGross)) {
        a = exInput.teamAPlayersGross[0] ?? null;
      }
      if (b == null && Array.isArray(exInput.teamBPlayersGross)) {
        b = exInput.teamBPlayersGross[0] ?? null;
      }

      holes[k] = { input: { teamAPlayerGross: a ?? null, teamBPlayerGross: b ?? null } };
    } else {
      // BestBall/Shamble → 2-length arrays
      const aArr = Array.isArray(exInput.teamAPlayersGross) ? exInput.teamAPlayersGross : [null, null];
      const bArr = Array.isArray(exInput.teamBPlayersGross) ? exInput.teamBPlayersGross : [null, null];
      const norm2 = (arr: any[]) => [arr[0] ?? null, arr[1] ?? null];
      holes[k] = { input: { teamAPlayersGross: norm2(aArr), teamBPlayersGross: norm2(bArr) } };
    }
  }

  return holes;
}

// --- seeding & triggers ----------------------------------------------------

export const seedMatchBoilerplate = onDocumentCreated("matches/{matchId}", async (event) => {
  const matchRef = event.data?.ref;
  const match = event.data?.data() || {};
  if (!matchRef) return;

  const matchId = event.params.matchId as string;
  const roundId: string | undefined = match.roundId;
  if (!roundId) return;

  // Read round to get format and tournamentId
  const roundSnap = await db.collection("rounds").doc(roundId).get();
  if (!roundSnap.exists) return;
  const round = roundSnap.data()!;
  const format = (round.format as RoundFormat) || "twoManBestBall";

  // Derive tournamentId if missing
  const tournamentId = match.tournamentId ?? round.tournamentId ?? "";

  // Defaults
  const count = playersPerSide(format);
  const teamA = ensureSideSize(match.teamAPlayers, count);
  const teamB = ensureSideSize(match.teamBPlayers, count);

  const holes = normalizeHoles(match.holes, format);

  await matchRef.set(
    {
      tournamentId,
      roundId,
      pointsValue: match.pointsValue == null ? 1 : match.pointsValue,
      teamAPlayers: teamA,
      teamBPlayers: teamB,
      status: match.status ?? defaultStatus(),
      holes,
      _seededAt: FieldValue.serverTimestamp(), // harmless marker
    },
    { merge: true }
  );

  // Append to round.matchIds
  const roundRef = db.collection("rounds").doc(roundId);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(roundRef);
    if (!s.exists) return;
    const r = s.data()!;
    const list: string[] = Array.isArray(r.matchIds) ? r.matchIds : [];
    if (!list.includes(matchId)) {
      tx.update(roundRef, { matchIds: [...list, matchId] });
    }
  });
});

// Ensure new rounds start with matchIds: []
export const seedRoundDefaults = onDocumentCreated("rounds/{roundId}", async (event) => {
  const ref = event.data?.ref;
  const data = event.data?.data();
  if (!ref || !data) return;
  if (!Array.isArray(data.matchIds)) {
    await ref.set({ matchIds: [] }, { merge: true });
  }
});

// Keep tournaments/{id}.roundIds in sync
export const linkRoundToTournament = onDocumentWritten("rounds/{roundId}", async (event) => {
  const after = event.data?.after.data();
  if (!after) return;

  const roundId = event.params.roundId as string;
  const tIdAfter = after.tournamentId;
  if (!tIdAfter) return;

  const tRef = db.collection("tournaments").doc(tIdAfter);
  await db.runTransaction(async (tx) => {
    const tSnap = await tx.get(tRef);
    if (!tSnap.exists) return;
    const t = tSnap.data()!;
    const roundIds: string[] = Array.isArray(t.roundIds) ? t.roundIds : [];
    if (!roundIds.includes(roundId)) {
      tx.update(tRef, { roundIds: [...roundIds, roundId] });
    }
  });
});

// --- scoring helpers ---
type Leader = "teamA" | "teamB" | null;

function clamp01(n: unknown) { return Number(n) === 1 ? 1 : 0; }
function isNum(n: any): n is number { return typeof n === "number" && Number.isFinite(n); }
function to2(arr: any[] | undefined) {
  const a0 = Array.isArray(arr) ? arr[0] : undefined;
  const a1 = Array.isArray(arr) ? arr[1] : undefined;
  return [isNum(a0) ? a0 : null, isNum(a1) ? a1 : null] as (number|null)[];
}
function holesRange(obj: Record<string, any>) {
  // Only holes with a determinable winner/AS count toward 'thru'
  const keys = Object.keys(obj).filter(k => /^[1-9]$|^1[0-8]$/.test(k)).map(k => Number(k));
  keys.sort((a,b)=>a-b);
  return keys;
}

function decideHole(format: RoundFormat, i: number, match: any): Leader | "AS" {
  const h = match.holes?.[String(i)]?.input ?? {};
  if (format === "twoManScramble") {
    const a = h.teamAGross, b = h.teamBGross;
    if (!isNum(a) || !isNum(b)) return null;
    if (a < b) return "teamA";
    if (b < a) return "teamB";
    return "AS";
  }
  if (format === "singles") {
    const aG = h.teamAPlayerGross, bG = h.teamBPlayerGross;
    if (!isNum(aG) || !isNum(bG)) return null;
    const aSt = clamp01(match.teamAPlayers?.[0]?.strokesReceived?.[i-1]);
    const bSt = clamp01(match.teamBPlayers?.[0]?.strokesReceived?.[i-1]);
    const aNet = aG - aSt;
    const bNet = bG - bSt;
    if (aNet < bNet) return "teamA";
    if (bNet < aNet) return "teamB";
    return "AS";
  }
  // twoManBestBall / twoManShamble
  const aArr = to2(h.teamAPlayersGross);
  const bArr = to2(h.teamBPlayersGross);
  if (aArr[0] == null && aArr[1] == null) return null;
  if (bArr[0] == null && bArr[1] == null) return null;

  const useHandicap = (format === "twoManBestBall");
  const aSt0 = useHandicap ? clamp01(match.teamAPlayers?.[0]?.strokesReceived?.[i-1]) : 0;
  const aSt1 = useHandicap ? clamp01(match.teamAPlayers?.[1]?.strokesReceived?.[i-1]) : 0;
  const bSt0 = useHandicap ? clamp01(match.teamBPlayers?.[0]?.strokesReceived?.[i-1]) : 0;
  const bSt1 = useHandicap ? clamp01(match.teamBPlayers?.[1]?.strokesReceived?.[i-1]) : 0;

  const aNet = [
    aArr[0] == null ? Infinity : (aArr[0] - aSt0),
    aArr[1] == null ? Infinity : (aArr[1] - aSt1),
  ];
  const bNet = [
    bArr[0] == null ? Infinity : (bArr[0] - bSt0),
    bArr[1] == null ? Infinity : (bArr[1] - bSt1),
  ];

  const aBest = Math.min(aNet[0], aNet[1]);
  const bBest = Math.min(bNet[0], bNet[1]);
  if (!Number.isFinite(aBest) || !Number.isFinite(bBest)) return null;

  if (aBest < bBest) return "teamA";
  if (bBest < aBest) return "teamB";
  return "AS";
}

function summarize(format: RoundFormat, match: any) {
  let a = 0, b = 0, thru = 0;
  const keys = holesRange(match.holes ?? {});
  for (const i of keys) {
    const res = decideHole(format, i, match);
    if (res === null) continue;         // not decided
    thru = Math.max(thru, i);
    if (res === "teamA") a++;
    else if (res === "teamB") b++;
    // AS gives no increment
  }
  let leader: Leader = null;
  if (a > b) leader = "teamA"; else if (b > a) leader = "teamB";
  const margin = Math.abs(a - b);
  const holesRemaining = 18 - thru;
  const dormie = leader !== null && margin === holesRemaining;
  const closed = leader !== null && margin > holesRemaining;
  const winner = (thru === 18 && a === b) ? "AS" : (leader ?? "AS");

  return {
    holesWonA: a, holesWonB: b, thru, leader, margin, dormie, closed, winner
  };
}

// --- compute trigger ---
export const computeMatchOnWrite = onDocumentWritten("matches/{matchId}", async (event) => {
  const before = event.data?.before?.data() || {};
  const after  = event.data?.after?.data();
  if (!after) return;

  // Ignore writes that only changed compute caches to prevent loops
  const changedTop = new Set<string>([
    ...Object.keys(after).filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k])),
    ...Object.keys(before).filter(k => after[k] === undefined),
  ]);
  const onlyCompute = [...changedTop].every(k => k === "status" || k === "result" || k === "_computeSig");
  if (onlyCompute) return;

  const matchRef = event.data!.after.ref;
  const roundId: string | undefined = after.roundId;
  if (!roundId) return;

  // read round for format
  const roundSnap = await db.collection("rounds").doc(roundId).get();
  if (!roundSnap.exists) return;
  const round = roundSnap.data()!;
  const format = (round.format as RoundFormat) || "twoManBestBall";

  // summarize
  const s = summarize(format, after);

  // build new status/result (no finalizedAt)
  const status = {
    leader: s.leader,
    margin: s.margin,
    thru:   s.thru,
    dormie: s.dormie,
    closed: s.closed,
  };
  const result = {
    winner:    s.winner,
    holesWonA: s.holesWonA,
    holesWonB: s.holesWonB,
  };

  // write only if something actually changed (prevents loops)
  const prevStatus = before.status ?? {};
  const prevResult = before.result ?? {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (same(prevStatus, status) && same(prevResult, result)) return;

  await matchRef.set({ status, result }, { merge: true });
});