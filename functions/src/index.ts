import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

type RoundFormat = "twoManBestBall" | "twoManShamble" | "twoManScramble" | "singles";

// --- HELPERS ---
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
  const make = () => ({ playerId: "", strokesReceived: zeros18() });
  if (!Array.isArray(side)) return Array.from({ length: count }, make);
  const trimmed = side.slice(0, count).map((p: any) => ({
    playerId: typeof p?.playerId === "string" ? p.playerId : "",
    strokesReceived: Array.isArray(p?.strokesReceived) && p.strokesReceived.length === 18 ? p.strokesReceived : zeros18(),
  }));
  while (trimmed.length < count) trimmed.push(make());
  return trimmed;
}

function normalizeHoles(existing: Record<string, any> | undefined, format: RoundFormat) {
  const desired = emptyHolesFor(format);
  const holes: Record<string, any> = { ...(existing || {}) };
  for (let i = 1; i <= 18; i++) {
    const k = String(i);
    const want = desired[k];
    const ex = holes[k];
    if (!ex || typeof ex !== "object") { holes[k] = want; continue; }
    const exInput = ex.input ?? {};
    
    if (format === "twoManScramble") {
      const a = exInput.teamAGross ?? null;
      const b = exInput.teamBGross ?? null;
      holes[k] = { input: { teamAGross: a, teamBGross: b } };
    } else if (format === "singles") {
      let a = exInput.teamAPlayerGross;
      let b = exInput.teamBPlayerGross;
      if (a == null && Array.isArray(exInput.teamAPlayersGross)) a = exInput.teamAPlayersGross[0] ?? null;
      if (b == null && Array.isArray(exInput.teamBPlayersGross)) b = exInput.teamBPlayersGross[0] ?? null;
      holes[k] = { input: { teamAPlayerGross: a ?? null, teamBPlayerGross: b ?? null } };
    } else {
      const aArr = Array.isArray(exInput.teamAPlayersGross) ? exInput.teamAPlayersGross : [null, null];
      const bArr = Array.isArray(exInput.teamBPlayersGross) ? exInput.teamBPlayersGross : [null, null];
      const norm2 = (arr: any[]) => [arr[0] ?? null, arr[1] ?? null];
      holes[k] = { input: { teamAPlayersGross: norm2(aArr), teamBPlayersGross: norm2(bArr) } };
    }
  }
  return holes;
}

// --- TRIGGERS ---

export const seedMatchBoilerplate = onDocumentCreated("matches/{matchId}", async (event) => {
  const matchRef = event.data?.ref;
  const match = event.data?.data() || {};
  if (!matchRef) return;
  const roundId: string | undefined = match.roundId;
  if (!roundId) return;

  const roundSnap = await db.collection("rounds").doc(roundId).get();
  if (!roundSnap.exists) return;
  const round = roundSnap.data()!;
  const format = (round.format as RoundFormat) || "twoManBestBall";
  const tournamentId = match.tournamentId ?? round.tournamentId ?? "";

  const count = playersPerSide(format);
  const teamA = ensureSideSize(match.teamAPlayers, count);
  const teamB = ensureSideSize(match.teamBPlayers, count);
  const holes = normalizeHoles(match.holes, format);

  await matchRef.set({
    tournamentId, roundId,
    pointsValue: match.pointsValue == null ? 1 : match.pointsValue,
    teamAPlayers: teamA, teamBPlayers: teamB,
    status: match.status ?? defaultStatus(),
    holes,
    _seededAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const roundRef = db.collection("rounds").doc(roundId);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(roundRef);
    if (!s.exists) return;
    const r = s.data()!;
    const list: string[] = Array.isArray(r.matchIds) ? r.matchIds : [];
    if (!list.includes(event.params.matchId)) {
      tx.update(roundRef, { matchIds: [...list, event.params.matchId] });
    }
  });
});

export const seedRoundDefaults = onDocumentCreated("rounds/{roundId}", async (event) => {
  const ref = event.data?.ref;
  const data = event.data?.data();
  if (!ref || !data) return;

  const toMerge: any = {};
  if (!Array.isArray(data.matchIds)) toMerge.matchIds = [];
  if (data.day === undefined) toMerge.day = 0;
  if (data.format === undefined) toMerge.format = null;
  if (data.courseId === undefined) toMerge.courseId = null;
  if (data.locked === undefined) toMerge.locked = false;
  if (Object.keys(toMerge).length > 0) {
    toMerge._seededAt = FieldValue.serverTimestamp();
    await ref.set(toMerge, { merge: true });
  }
});

export const linkRoundToTournament = onDocumentWritten("rounds/{roundId}", async (event) => {
  const after = event.data?.after.data();
  if (!after) return;
  const tId = after.tournamentId;
  if (!tId) return;
  const tRef = db.collection("tournaments").doc(tId);
  await db.runTransaction(async (tx) => {
    const tSnap = await tx.get(tRef);
    if (!tSnap.exists) return;
    const t = tSnap.data()!;
    const rIds: string[] = Array.isArray(t.roundIds) ? t.roundIds : [];
    if (!rIds.includes(event.params.roundId)) {
      tx.update(tRef, { roundIds: [...rIds, event.params.roundId] });
    }
  });
});

// --- SCORING ---

function clamp01(n: unknown) { return Number(n) === 1 ? 1 : 0; }
function isNum(n: any): n is number { return typeof n === "number" && Number.isFinite(n); }
function to2(arr: any[]) { return [isNum(arr?.[0]) ? arr[0] : null, isNum(arr?.[1]) ? arr[1] : null]; }
function holesRange(obj: Record<string, any>) {
  const keys = Object.keys(obj).filter(k => /^[1-9]$|^1[0-8]$/.test(k)).map(Number);
  keys.sort((a,b)=>a-b);
  return keys;
}

function decideHole(format: RoundFormat, i: number, match: any) {
  const h = match.holes?.[String(i)]?.input ?? {};
  if (format === "twoManScramble") {
    const { teamAGross: a, teamBGross: b } = h;
    if (!isNum(a) || !isNum(b)) return null;
    return a < b ? "teamA" : b < a ? "teamB" : "AS";
  }
  if (format === "singles") {
    const { teamAPlayerGross: aG, teamBPlayerGross: bG } = h;
    if (!isNum(aG) || !isNum(bG)) return null;
    const aNet = aG - clamp01(match.teamAPlayers?.[0]?.strokesReceived?.[i-1]);
    const bNet = bG - clamp01(match.teamBPlayers?.[0]?.strokesReceived?.[i-1]);
    return aNet < bNet ? "teamA" : bNet < aNet ? "teamB" : "AS";
  }
  // BestBall/Shamble
  const aArr = to2(h.teamAPlayersGross || []);
  const bArr = to2(h.teamBPlayersGross || []);
  if (aArr[0]==null || aArr[1]==null || bArr[0]==null || bArr[1]==null) return null;

  const useHcp = (format === "twoManBestBall");
  const getNet = (g:number|null, pIdx:number, teamArr:any[]) => {
    const s = useHcp ? clamp01(teamArr?.[pIdx]?.strokesReceived?.[i-1]) : 0;
    return g! - s;
  };
  const aBest = Math.min(getNet(aArr[0],0,match.teamAPlayers), getNet(aArr[1],1,match.teamAPlayers));
  const bBest = Math.min(getNet(bArr[0],0,match.teamBPlayers), getNet(bArr[1],1,match.teamBPlayers));
  
  return aBest < bBest ? "teamA" : bBest < aBest ? "teamB" : "AS";
}

function summarize(format: RoundFormat, match: any) {
  let a = 0, b = 0, thru = 0;
  for (const i of holesRange(match.holes ?? {})) {
    const res = decideHole(format, i, match);
    if (res === null) continue;
    thru = Math.max(thru, i);
    if (res === "teamA") a++;
    else if (res === "teamB") b++;
  }
  const leader = a > b ? "teamA" : b > a ? "teamB" : null;
  const margin = Math.abs(a - b);
  const holesLeft = 18 - thru;
  const closed = leader !== null && margin > holesLeft;
  const dormie = leader !== null && margin === holesLeft;
  const winner = (thru === 18 && a === b) ? "AS" : (leader ?? "AS");
  return { holesWonA: a, holesWonB: b, thru, leader, margin, dormie, closed, winner };
}

export const computeMatchOnWrite = onDocumentWritten("matches/{matchId}", async (event) => {
  const before = event.data?.before?.data() || {};
  const after  = event.data?.after?.data();
  if (!after) return;
  
  // Prevent loops
  const changed = [
    ...Object.keys(after).filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k])),
    ...Object.keys(before).filter(k => after[k] === undefined)
  ];
  if (changed.every(k => ["status", "result", "_computeSig"].includes(k))) return;

  const roundId = after.roundId;
  if (!roundId) return;
  const rSnap = await db.collection("rounds").doc(roundId).get();
  const format = rSnap.data()?.format || "twoManBestBall";

  const s = summarize(format, after);
  const status = { leader: s.leader, margin: s.margin, thru: s.thru, dormie: s.dormie, closed: s.closed };
  const result = { winner: s.winner, holesWonA: s.holesWonA, holesWonB: s.holesWonB };

  if (JSON.stringify(before.status) === JSON.stringify(status) && 
      JSON.stringify(before.result) === JSON.stringify(result)) return;

  await event.data!.after.ref.set({ status, result }, { merge: true });
});

// --- STATS ENGINE (Updated for Nested Tiers + Margin) ---

export const updateMatchFacts = onDocumentWritten("matches/{matchId}", async (event) => {
  const matchId = event.params.matchId;
  const after = event.data?.after?.data();
  
  if (!after || !after.status?.closed) {
    // Clean up facts if match re-opened or deleted
    const snap = await db.collection("playerMatchFacts").where("matchId", "==", matchId).get();
    if (snap.empty) return;
    const b = db.batch();
    snap.docs.forEach(d => b.delete(d.ref));
    await b.commit();
    return;
  }

  const result = after.result || {};
  const status = after.status || {};
  const points = after.pointsValue ?? 1;
  const tId = after.tournamentId || "";
  const rId = after.roundId || "";
  
  let format = "unknown";
  let playerTierLookup: Record<string, string> = {};
  let playerHandicapLookup: Record<string, number> = {};
  let teamAId = "teamA";
  let teamBId = "teamB";

  // Fetch Context (Round & Tournament)
  if (rId) {
    const rSnap = await db.collection("rounds").doc(rId).get();
    if (rSnap.exists) format = rSnap.data()?.format || "unknown";
  }
  if (tId) {
    const tSnap = await db.collection("tournaments").doc(tId).get();
    if (tSnap.exists) {
      const d = tSnap.data()!;
      teamAId = d.teamA?.id || "teamA";
      teamBId = d.teamB?.id || "teamB";
      
      const flattenTiers = (roster?: Record<string, string[]>) => {
        if (!roster) return;
        Object.entries(roster).forEach(([tier, pIds]) => {
          if (Array.isArray(pIds)) pIds.forEach(pid => playerTierLookup[pid] = tier);
        });
      };
      flattenTiers(d.teamA?.rosterByTier);
      flattenTiers(d.teamB?.rosterByTier);

      // Flatten handicaps from both teams
      const flattenHandicaps = (hcpMap?: Record<string, number>) => {
        if (!hcpMap) return;
        Object.entries(hcpMap).forEach(([pid, hcp]) => {
          if (typeof hcp === "number") playerHandicapLookup[pid] = hcp;
        });
      };
      flattenHandicaps(d.teamA?.handicapByPlayer);
      flattenHandicaps(d.teamB?.handicapByPlayer);
    }
  }

  const batch = db.batch();

  // UPDATED: Accepts 'opponentPlayers' AND 'myTeamPlayers'
  const writeFact = (p: any, team: "teamA" | "teamB", opponentPlayers: any[], myTeamPlayers: any[]) => {
    if (!p?.playerId) return;
    
    let outcome = "loss"; 
    let pts = 0;
    if (result.winner === "AS") { outcome = "halve"; pts = points / 2; }
    else if (result.winner === team) { outcome = "win"; pts = points; }

    const myTier = playerTierLookup[p.playerId] || "Unknown";
    const myTeamId = team === "teamA" ? teamAId : teamBId;
    const oppTeamId = team === "teamA" ? teamBId : teamAId;

    // Player's own handicap
    const playerHandicap = playerHandicapLookup[p.playerId] ?? null;

    // --- 1. OPPONENTS ---
    const opponentIds: string[] = [];
    const opponentTiers: string[] = [];
    const opponentHandicaps: (number | null)[] = [];

    if (Array.isArray(opponentPlayers)) {
      opponentPlayers.forEach((op) => {
        if (op && op.playerId) {
          opponentIds.push(op.playerId);
          opponentTiers.push(playerTierLookup[op.playerId] || "Unknown");
          opponentHandicaps.push(playerHandicapLookup[op.playerId] ?? null);
        }
      });
    }

    // --- 2. PARTNERS (New Logic) ---
    const partnerIds: string[] = [];
    const partnerTiers: string[] = [];
    const partnerHandicaps: (number | null)[] = [];

    if (Array.isArray(myTeamPlayers)) {
      myTeamPlayers.forEach((tm) => {
        // Add if valid ID AND not myself
        if (tm && tm.playerId && tm.playerId !== p.playerId) {
          partnerIds.push(tm.playerId);
          partnerTiers.push(playerTierLookup[tm.playerId] || "Unknown");
          partnerHandicaps.push(playerHandicapLookup[tm.playerId] ?? null);
        }
      });
    }

    batch.set(db.collection("playerMatchFacts").doc(`${matchId}_${p.playerId}`), {
      playerId: p.playerId, matchId, tournamentId: tId, roundId: rId, format,
      outcome, pointsEarned: pts,
      
      playerTier: myTier,
      playerTeamId: myTeamId,
      opponentTeamId: oppTeamId,
      
      // Handicaps
      playerHandicap,
      opponentHandicaps,
      partnerHandicaps,

      // Opponent Arrays (Source of Truth)
      opponentIds,
      opponentTiers,

      // Partner Arrays
      partnerIds,
      partnerTiers,

      finalMargin: status.margin || 0,
      finalThru: status.thru || 18,
      
      updatedAt: FieldValue.serverTimestamp(),
    });
  };

  const pA = after.teamAPlayers || [];
  const pB = after.teamBPlayers || [];
  
  // UPDATED: Pass 'pA' as the 4th arg for Team A (to find partners), and 'pB' for Team B
  if (Array.isArray(pA)) pA.forEach((p: any) => writeFact(p, "teamA", pB, pA));
  if (Array.isArray(pB)) pB.forEach((p: any) => writeFact(p, "teamB", pA, pB));

  await batch.commit();
});

export const aggregatePlayerStats = onDocumentWritten("playerMatchFacts/{factId}", async (event) => {
  const data = event.data?.after?.data() || event.data?.before?.data();
  if (!data?.playerId) return;

  const snap = await db.collection("playerMatchFacts").where("playerId", "==", data.playerId).get();
  let wins=0, losses=0, halves=0, totalPoints=0, matchesPlayed=0;

  snap.forEach(d => {
    const f = d.data();
    matchesPlayed++;
    totalPoints += (f.pointsEarned || 0);
    if (f.outcome === "win") wins++;
    else if (f.outcome === "loss") losses++;
    else halves++;
  });

  await db.collection("playerStats").doc(data.playerId).set({
    wins, losses, halves, totalPoints, matchesPlayed,
    lastUpdated: FieldValue.serverTimestamp()
  }, { merge: true });
});