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
      // Scramble: one score per team + drive tracking
      holes[k] = { input: { teamAGross: null, teamBGross: null, teamADrive: null, teamBDrive: null } };
    } else if (format === "singles") {
      holes[k] = { input: { teamAPlayerGross: null, teamBPlayerGross: null } };
    } else if (format === "twoManShamble") {
      // Shamble: individual player scores + drive tracking
      holes[k] = { input: { teamAPlayersGross: [null, null], teamBPlayersGross: [null, null], teamADrive: null, teamBDrive: null } };
    } else {
      // Best Ball: individual player scores
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
      // Scramble: one score per team + drive tracking
      const a = exInput.teamAGross ?? null;
      const b = exInput.teamBGross ?? null;
      const aDrive = exInput.teamADrive ?? null;
      const bDrive = exInput.teamBDrive ?? null;
      holes[k] = { input: { teamAGross: a, teamBGross: b, teamADrive: aDrive, teamBDrive: bDrive } };
    } else if (format === "singles") {
      let a = exInput.teamAPlayerGross;
      let b = exInput.teamBPlayerGross;
      if (a == null && Array.isArray(exInput.teamAPlayersGross)) a = exInput.teamAPlayersGross[0] ?? null;
      if (b == null && Array.isArray(exInput.teamBPlayersGross)) b = exInput.teamBPlayersGross[0] ?? null;
      holes[k] = { input: { teamAPlayerGross: a ?? null, teamBPlayerGross: b ?? null } };
    } else if (format === "twoManShamble") {
      // Shamble: individual player scores + drive tracking
      const aArr = Array.isArray(exInput.teamAPlayersGross) ? exInput.teamAPlayersGross : [null, null];
      const bArr = Array.isArray(exInput.teamBPlayersGross) ? exInput.teamBPlayersGross : [null, null];
      const norm2 = (arr: any[]) => [arr[0] ?? null, arr[1] ?? null];
      const aDrive = exInput.teamADrive ?? null;
      const bDrive = exInput.teamBDrive ?? null;
      holes[k] = { input: { teamAPlayersGross: norm2(aArr), teamBPlayersGross: norm2(bArr), teamADrive: aDrive, teamBDrive: bDrive } };
    } else {
      // Best Ball: individual player scores
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
  if (data.pointsValue === undefined) toMerge.pointsValue = 1;
  // DRIVE_TRACKING: Default to false
  if (data.trackDrives === undefined) toMerge.trackDrives = false;
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

export const seedTournamentDefaults = onDocumentCreated("tournaments/{tournamentId}", async (event) => {
  const ref = event.data?.ref;
  const data = event.data?.data();
  if (!ref || !data) return;

  const toMerge: any = {};

  if (data.year === undefined) toMerge.year = new Date().getFullYear();
  if (data.name === undefined) toMerge.name = "";
  if (data.series === undefined) toMerge.series = "";
  if (data.active === undefined) toMerge.active = false;
  if (!Array.isArray(data.roundIds)) toMerge.roundIds = [];
  if (data.tournamentLogo === undefined) toMerge.tournamentLogo = "";

  // Default teamA structure
  if (!data.teamA || typeof data.teamA !== "object") {
    toMerge.teamA = { id: "teamA", name: "", logo: "", color: "", rosterByTier: {}, handicapByPlayer: {} };
  } else {
    // Fill in missing teamA fields
    const teamA: any = { ...data.teamA };
    if (teamA.id === undefined) teamA.id = "teamA";
    if (teamA.name === undefined) teamA.name = "";
    if (teamA.logo === undefined) teamA.logo = "";
    if (teamA.color === undefined) teamA.color = "";
    if (teamA.rosterByTier === undefined) teamA.rosterByTier = {};
    if (teamA.handicapByPlayer === undefined) teamA.handicapByPlayer = {};
    toMerge.teamA = teamA;
  }

  // Default teamB structure
  if (!data.teamB || typeof data.teamB !== "object") {
    toMerge.teamB = { id: "teamB", name: "", logo: "", color: "", rosterByTier: {}, handicapByPlayer: {} };
  } else {
    // Fill in missing teamB fields
    const teamB: any = { ...data.teamB };
    if (teamB.id === undefined) teamB.id = "teamB";
    if (teamB.name === undefined) teamB.name = "";
    if (teamB.logo === undefined) teamB.logo = "";
    if (teamB.color === undefined) teamB.color = "";
    if (teamB.rosterByTier === undefined) teamB.rosterByTier = {};
    if (teamB.handicapByPlayer === undefined) teamB.handicapByPlayer = {};
    toMerge.teamB = teamB;
  }

  if (Object.keys(toMerge).length > 0) {
    toMerge._seededAt = FieldValue.serverTimestamp();
    await ref.set(toMerge, { merge: true });
  }
});

export const seedCourseDefaults = onDocumentCreated("courses/{courseId}", async (event) => {
  const ref = event.data?.ref;
  const data = event.data?.data();
  if (!ref || !data) return;

  const toMerge: any = {};
  
  // Create holes array with 18 holes if not present
  if (!Array.isArray(data.holes)) {
    toMerge.holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1,
      hcpIndex: 0,
      par: 4
    }));
  }
  
  // Set default par (72) if not present
  if (data.par === undefined) toMerge.par = 72;
  
  // Set default name if not present
  if (data.name === undefined) toMerge.name = "";
  
  // Set default tees if not present
  if (data.tees === undefined) toMerge.tees = "";
  
  if (Object.keys(toMerge).length > 0) {
    toMerge._seededAt = FieldValue.serverTimestamp();
    await ref.set(toMerge, { merge: true });
  }
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
    // Scramble: one gross score per team
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
  if (format === "twoManShamble") {
    // Shamble: individual player scores, GROSS only (no strokes applied)
    const aArr = to2(h.teamAPlayersGross || []);
    const bArr = to2(h.teamBPlayersGross || []);
    if (aArr[0]==null || aArr[1]==null || bArr[0]==null || bArr[1]==null) return null;
    
    // Best GROSS (no handicap) for each team
    const aBest = Math.min(aArr[0]!, aArr[1]!);
    const bBest = Math.min(bArr[0]!, bArr[1]!);
    return aBest < bBest ? "teamA" : bBest < aBest ? "teamB" : "AS";
  }
  // Best Ball: individual player scores with NET calculation
  const aArr = to2(h.teamAPlayersGross || []);
  const bArr = to2(h.teamBPlayersGross || []);
  if (aArr[0]==null || aArr[1]==null || bArr[0]==null || bArr[1]==null) return null;

  const getNet = (g:number|null, pIdx:number, teamArr:any[]) => {
    const s = clamp01(teamArr?.[pIdx]?.strokesReceived?.[i-1]);
    return g! - s;
  };
  const aBest = Math.min(getNet(aArr[0],0,match.teamAPlayers), getNet(aArr[1],1,match.teamAPlayers));
  const bBest = Math.min(getNet(bArr[0],0,match.teamBPlayers), getNet(bArr[1],1,match.teamBPlayers));
  
  return aBest < bBest ? "teamA" : bBest < aBest ? "teamB" : "AS";
}

function summarize(format: RoundFormat, match: any) {
  let a = 0, b = 0, thru = 0;
  let runningMargin = 0; // positive = Team A leading, negative = Team B leading
  let wasTeamADown3PlusBack9 = false;
  let wasTeamAUp3PlusBack9 = false;
  const marginHistory: number[] = []; // Track margin after each completed hole

  for (const i of holesRange(match.holes ?? {})) {
    const res = decideHole(format, i, match);
    if (res === null) continue;
    thru = Math.max(thru, i);
    if (res === "teamA") { a++; runningMargin++; }
    else if (res === "teamB") { b++; runningMargin--; }
    
    // Track margin after this hole
    marginHistory.push(runningMargin);

    // Track momentum on back 9 (holes 10-18)
    if (i >= 10) {
      if (runningMargin <= -3) wasTeamADown3PlusBack9 = true;
      if (runningMargin >= 3) wasTeamAUp3PlusBack9 = true;
    }
  }
  const leader = a > b ? "teamA" : b > a ? "teamB" : null;
  const margin = Math.abs(a - b);
  const holesLeft = 18 - thru;
  // Match closes when: someone wins (margin > holesLeft), OR all 18 holes are completed
  const closed = (leader !== null && margin > holesLeft) || thru === 18;
  const dormie = leader !== null && margin === holesLeft && thru < 18;
  const winner = (thru === 18 && a === b) ? "AS" : (leader ?? "AS");
  return { 
    holesWonA: a, holesWonB: b, thru, leader, margin, dormie, closed, winner,
    wasTeamADown3PlusBack9, wasTeamAUp3PlusBack9, marginHistory
  };
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

// --- STATS ENGINE (Updated with 6 new stats) ---

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
  const tId = after.tournamentId || "";
  const rId = after.roundId || "";
  
  let format: RoundFormat = "twoManBestBall";
  let points = 1;
  let courseId = "";
  let coursePar = 72; // Default, will be updated from course doc
  let day = 0;
  let playerTierLookup: Record<string, string> = {};
  let playerHandicapLookup: Record<string, number> = {};
  let teamAId = "teamA";
  let teamBId = "teamB";
  let tournamentYear = 0;
  let tournamentName = "";
  let tournamentSeries = "";

  // Fetch Context (Round & Tournament)
  if (rId) {
    const rSnap = await db.collection("rounds").doc(rId).get();
    if (rSnap.exists) {
      const rData = rSnap.data();
      format = (rData?.format as RoundFormat) || "twoManBestBall";
      points = rData?.pointsValue ?? 1;
      courseId = rData?.courseId || "";
      day = rData?.day ?? 0;
      
      // Try to get course par from embedded course data
      if (rData?.course?.holes && Array.isArray(rData.course.holes)) {
        coursePar = rData.course.holes.reduce((sum: number, h: any) => sum + (h?.par || 4), 0);
      }
    }
  }
  
  // Fetch course par from courseId if available (overrides embedded)
  if (courseId) {
    const cSnap = await db.collection("courses").doc(courseId).get();
    if (cSnap.exists) {
      const cData = cSnap.data();
      // Use stored par if available, otherwise calculate from holes
      if (typeof cData?.par === "number") {
        coursePar = cData.par;
      } else if (Array.isArray(cData?.holes)) {
        coursePar = cData.holes.reduce((sum: number, h: any) => sum + (h?.par || 4), 0);
      }
    }
  }
  if (tId) {
    const tSnap = await db.collection("tournaments").doc(tId).get();
    if (tSnap.exists) {
      const d = tSnap.data()!;
      teamAId = d.teamA?.id || "teamA";
      teamBId = d.teamB?.id || "teamB";
      tournamentYear = d.year || 0;
      tournamentName = d.name || "";
      tournamentSeries = d.series || "";
      
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

  // --- Calculate match-wide stats by iterating through holes ---
  const holesData = after.holes || {};
  let leadChanges = 0;
  let wasTeamANeverBehind = true;
  let wasTeamBNeverBehind = true;
  let winningHole: number | null = null;
  let prevLeader: "teamA" | "teamB" | null = null;
  let runningMargin = 0;
  
  // Track balls used for best ball format (per player index)
  const teamABallsUsed = [0, 0]; // [player0, player1] - total (includes ties)
  const teamBBallsUsed = [0, 0];
  const teamABallsUsedSolo = [0, 0]; // strictly better than partner
  const teamBBallsUsedSolo = [0, 0];
  const teamABallsUsedShared = [0, 0]; // tied with partner
  const teamBBallsUsedShared = [0, 0];
  const teamABallsUsedSoloWonHole = [0, 0]; // solo ball AND team won hole
  const teamBBallsUsedSoloWonHole = [0, 0];
  const teamABallsUsedSoloPush = [0, 0]; // solo ball AND hole was halved
  const teamBBallsUsedSoloPush = [0, 0];
  
  // DRIVE_TRACKING: Track drives used for scramble/shamble
  const teamADrivesUsed = [0, 0];
  const teamBDrivesUsed = [0, 0];
  
  // SCORING STATS: Track individual gross/net scores (for best ball & singles)
  const teamAPlayerGross = [0, 0]; // Sum of gross scores per player
  const teamBPlayerGross = [0, 0];
  const teamAPlayerNet = [0, 0];   // Sum of net scores per player
  const teamBPlayerNet = [0, 0];
  
  // SCORING STATS: Track team gross scores (for scramble & shamble)
  let teamATotalGross = 0;
  let teamBTotalGross = 0;
  
  const finalThru = status.thru || 18;
  
  for (let i = 1; i <= finalThru; i++) {
    const h = holesData[String(i)]?.input ?? {};
    
    // Determine hole winner (reuse logic from decideHole)
    const holeResult = decideHole(format, i, after);
    
    if (holeResult === "teamA") {
      runningMargin++;
    } else if (holeResult === "teamB") {
      runningMargin--;
    }
    
    // Determine current leader
    const currentLeader = runningMargin > 0 ? "teamA" : runningMargin < 0 ? "teamB" : null;
    
    // Track lead changes (only when leader actually changes, not ties)
    if (currentLeader !== null && prevLeader !== null && currentLeader !== prevLeader) {
      leadChanges++;
    }
    if (currentLeader !== null) {
      prevLeader = currentLeader;
    }
    
    // Track "never behind"
    if (runningMargin < 0) wasTeamANeverBehind = false;
    if (runningMargin > 0) wasTeamBNeverBehind = false;
    
    // Track winning hole (when match was closed)
    if (status.closed && winningHole === null) {
      const margin = Math.abs(runningMargin);
      const holesLeft = 18 - i;
      if (margin > holesLeft) {
        winningHole = i;
      }
    }
    
    // Best Ball: Track whose ball was used (which player had lower net)
    if (format === "twoManBestBall") {
      const aArr = h.teamAPlayersGross;
      const bArr = h.teamBPlayersGross;
      
      if (Array.isArray(aArr) && aArr[0] != null && aArr[1] != null) {
        const a0Stroke = clamp01(after.teamAPlayers?.[0]?.strokesReceived?.[i-1]);
        const a1Stroke = clamp01(after.teamAPlayers?.[1]?.strokesReceived?.[i-1]);
        const a0Net = aArr[0] - a0Stroke;
        const a1Net = aArr[1] - a1Stroke;
        // Total balls used (includes ties)
        if (a0Net <= a1Net) teamABallsUsed[0]++;
        if (a1Net <= a0Net) teamABallsUsed[1]++;
        // Solo vs Shared
        if (a0Net < a1Net) {
          teamABallsUsedSolo[0]++;
          if (holeResult === "teamA") teamABallsUsedSoloWonHole[0]++;
          if (holeResult === "AS") teamABallsUsedSoloPush[0]++;
        } else if (a1Net < a0Net) {
          teamABallsUsedSolo[1]++;
          if (holeResult === "teamA") teamABallsUsedSoloWonHole[1]++;
          if (holeResult === "AS") teamABallsUsedSoloPush[1]++;
        } else {
          // Tied - both shared
          teamABallsUsedShared[0]++;
          teamABallsUsedShared[1]++;
        }
      }
      
      if (Array.isArray(bArr) && bArr[0] != null && bArr[1] != null) {
        const b0Stroke = clamp01(after.teamBPlayers?.[0]?.strokesReceived?.[i-1]);
        const b1Stroke = clamp01(after.teamBPlayers?.[1]?.strokesReceived?.[i-1]);
        const b0Net = bArr[0] - b0Stroke;
        const b1Net = bArr[1] - b1Stroke;
        // Total balls used (includes ties)
        if (b0Net <= b1Net) teamBBallsUsed[0]++;
        if (b1Net <= b0Net) teamBBallsUsed[1]++;
        // Solo vs Shared
        if (b0Net < b1Net) {
          teamBBallsUsedSolo[0]++;
          if (holeResult === "teamB") teamBBallsUsedSoloWonHole[0]++;
          if (holeResult === "AS") teamBBallsUsedSoloPush[0]++;
        } else if (b1Net < b0Net) {
          teamBBallsUsedSolo[1]++;
          if (holeResult === "teamB") teamBBallsUsedSoloWonHole[1]++;
          if (holeResult === "AS") teamBBallsUsedSoloPush[1]++;
        } else {
          // Tied - both shared
          teamBBallsUsedShared[0]++;
          teamBBallsUsedShared[1]++;
        }
      }
    }
    
    // Shamble: Track whose ball was used (which player had lower GROSS - no strokes)
    if (format === "twoManShamble") {
      const aArr = h.teamAPlayersGross;
      const bArr = h.teamBPlayersGross;
      
      if (Array.isArray(aArr) && aArr[0] != null && aArr[1] != null) {
        // Total balls used (includes ties)
        if (aArr[0] <= aArr[1]) teamABallsUsed[0]++;
        if (aArr[1] <= aArr[0]) teamABallsUsed[1]++;
        // Solo vs Shared
        if (aArr[0] < aArr[1]) {
          teamABallsUsedSolo[0]++;
          if (holeResult === "teamA") teamABallsUsedSoloWonHole[0]++;
          if (holeResult === "AS") teamABallsUsedSoloPush[0]++;
        } else if (aArr[1] < aArr[0]) {
          teamABallsUsedSolo[1]++;
          if (holeResult === "teamA") teamABallsUsedSoloWonHole[1]++;
          if (holeResult === "AS") teamABallsUsedSoloPush[1]++;
        } else {
          // Tied - both shared
          teamABallsUsedShared[0]++;
          teamABallsUsedShared[1]++;
        }
      }
      
      if (Array.isArray(bArr) && bArr[0] != null && bArr[1] != null) {
        // Total balls used (includes ties)
        if (bArr[0] <= bArr[1]) teamBBallsUsed[0]++;
        if (bArr[1] <= bArr[0]) teamBBallsUsed[1]++;
        // Solo vs Shared
        if (bArr[0] < bArr[1]) {
          teamBBallsUsedSolo[0]++;
          if (holeResult === "teamB") teamBBallsUsedSoloWonHole[0]++;
          if (holeResult === "AS") teamBBallsUsedSoloPush[0]++;
        } else if (bArr[1] < bArr[0]) {
          teamBBallsUsedSolo[1]++;
          if (holeResult === "teamB") teamBBallsUsedSoloWonHole[1]++;
          if (holeResult === "AS") teamBBallsUsedSoloPush[1]++;
        } else {
          // Tied - both shared
          teamBBallsUsedShared[0]++;
          teamBBallsUsedShared[1]++;
        }
      }
    }
    
    // DRIVE_TRACKING: Track drives used for scramble/shamble
    if (format === "twoManScramble" || format === "twoManShamble") {
      const aDrive = h.teamADrive;
      const bDrive = h.teamBDrive;
      if (aDrive === 0) teamADrivesUsed[0]++;
      else if (aDrive === 1) teamADrivesUsed[1]++;
      if (bDrive === 0) teamBDrivesUsed[0]++;
      else if (bDrive === 1) teamBDrivesUsed[1]++;
    }
    
    // SCORING STATS: Calculate scores based on format
    if (format === "twoManScramble") {
      // Team format: one gross score per team
      const aGross = h.teamAGross;
      const bGross = h.teamBGross;
      if (isNum(aGross)) teamATotalGross += aGross;
      if (isNum(bGross)) teamBTotalGross += bGross;
    } else if (format === "singles") {
      // Individual format: one score per player
      const aGross = h.teamAPlayerGross;
      const bGross = h.teamBPlayerGross;
      if (isNum(aGross)) {
        teamAPlayerGross[0] += aGross;
        const aStroke = clamp01(after.teamAPlayers?.[0]?.strokesReceived?.[i-1]);
        teamAPlayerNet[0] += (aGross - aStroke);
      }
      if (isNum(bGross)) {
        teamBPlayerGross[0] += bGross;
        const bStroke = clamp01(after.teamBPlayers?.[0]?.strokesReceived?.[i-1]);
        teamBPlayerNet[0] += (bGross - bStroke);
      }
    } else if (format === "twoManShamble") {
      // Shamble: individual scores but team uses best gross
      const aArr = h.teamAPlayersGross;
      const bArr = h.teamBPlayersGross;
      if (Array.isArray(aArr)) {
        if (isNum(aArr[0])) teamAPlayerGross[0] += aArr[0];
        if (isNum(aArr[1])) teamAPlayerGross[1] += aArr[1];
        // Team total is best gross
        if (isNum(aArr[0]) && isNum(aArr[1])) {
          teamATotalGross += Math.min(aArr[0], aArr[1]);
        } else if (isNum(aArr[0])) {
          teamATotalGross += aArr[0];
        } else if (isNum(aArr[1])) {
          teamATotalGross += aArr[1];
        }
      }
      if (Array.isArray(bArr)) {
        if (isNum(bArr[0])) teamBPlayerGross[0] += bArr[0];
        if (isNum(bArr[1])) teamBPlayerGross[1] += bArr[1];
        // Team total is best gross
        if (isNum(bArr[0]) && isNum(bArr[1])) {
          teamBTotalGross += Math.min(bArr[0], bArr[1]);
        } else if (isNum(bArr[0])) {
          teamBTotalGross += bArr[0];
        } else if (isNum(bArr[1])) {
          teamBTotalGross += bArr[1];
        }
      }
    } else {
      // Best Ball: individual scores with net calculation
      const aArr = h.teamAPlayersGross;
      const bArr = h.teamBPlayersGross;
      if (Array.isArray(aArr)) {
        if (isNum(aArr[0])) {
          teamAPlayerGross[0] += aArr[0];
          const a0Stroke = clamp01(after.teamAPlayers?.[0]?.strokesReceived?.[i-1]);
          teamAPlayerNet[0] += (aArr[0] - a0Stroke);
        }
        if (isNum(aArr[1])) {
          teamAPlayerGross[1] += aArr[1];
          const a1Stroke = clamp01(after.teamAPlayers?.[1]?.strokesReceived?.[i-1]);
          teamAPlayerNet[1] += (aArr[1] - a1Stroke);
        }
      }
      if (Array.isArray(bArr)) {
        if (isNum(bArr[0])) {
          teamBPlayerGross[0] += bArr[0];
          const b0Stroke = clamp01(after.teamBPlayers?.[0]?.strokesReceived?.[i-1]);
          teamBPlayerNet[0] += (bArr[0] - b0Stroke);
        }
        if (isNum(bArr[1])) {
          teamBPlayerGross[1] += bArr[1];
          const b1Stroke = clamp01(after.teamBPlayers?.[1]?.strokesReceived?.[i-1]);
          teamBPlayerNet[1] += (bArr[1] - b1Stroke);
        }
      }
    }
  }

  const batch = db.batch();

  const writeFact = (p: any, team: "teamA" | "teamB", pIdx: number, opponentPlayers: any[], myTeamPlayers: any[]) => {
    if (!p?.playerId) return;
    
    let outcome: "win" | "loss" | "halve" = "loss"; 
    let pts = 0;
    if (result.winner === "AS") { outcome = "halve"; pts = points / 2; }
    else if (result.winner === team) { outcome = "win"; pts = points; }

    // Holes won/lost/halved from this player's perspective
    const holesWon = team === "teamA" ? (result.holesWonA || 0) : (result.holesWonB || 0);
    const holesLost = team === "teamA" ? (result.holesWonB || 0) : (result.holesWonA || 0);
    const holesHalved = finalThru - holesWon - holesLost;

    // Comeback/BlownLead: Was down/up 3+ on back 9
    const wasDown3PlusBack9 = team === "teamA" ? status.wasTeamADown3PlusBack9 : status.wasTeamAUp3PlusBack9;
    const wasUp3PlusBack9 = team === "teamA" ? status.wasTeamAUp3PlusBack9 : status.wasTeamADown3PlusBack9;
    const comebackWin = outcome === "win" && wasDown3PlusBack9 === true;
    const blownLead = outcome === "loss" && wasUp3PlusBack9 === true;
    
    // NEW: wasNeverBehind from this player's perspective
    const wasNeverBehind = team === "teamA" ? wasTeamANeverBehind : wasTeamBNeverBehind;
    
    // NEW: strokesGiven - sum of strokesReceived array
    const strokesGiven = Array.isArray(p.strokesReceived) 
      ? p.strokesReceived.reduce((sum: number, v: number) => sum + (v || 0), 0)
      : 0;
    
    // NEW: ballsUsed stats - for best ball and shamble
    let ballsUsed: number | null = null;
    let ballsUsedSolo: number | null = null;
    let ballsUsedShared: number | null = null;
    let ballsUsedSoloWonHole: number | null = null;
    let ballsUsedSoloPush: number | null = null;
    if (format === "twoManBestBall" || format === "twoManShamble") {
      ballsUsed = team === "teamA" ? teamABallsUsed[pIdx] : teamBBallsUsed[pIdx];
      ballsUsedSolo = team === "teamA" ? teamABallsUsedSolo[pIdx] : teamBBallsUsedSolo[pIdx];
      ballsUsedShared = team === "teamA" ? teamABallsUsedShared[pIdx] : teamBBallsUsedShared[pIdx];
      ballsUsedSoloWonHole = team === "teamA" ? teamABallsUsedSoloWonHole[pIdx] : teamBBallsUsedSoloWonHole[pIdx];
      ballsUsedSoloPush = team === "teamA" ? teamABallsUsedSoloPush[pIdx] : teamBBallsUsedSoloPush[pIdx];
    }
    
    // DRIVE_TRACKING: drivesUsed - only for scramble/shamble
    let drivesUsed: number | null = null;
    if (format === "twoManScramble" || format === "twoManShamble") {
      drivesUsed = team === "teamA" ? teamADrivesUsed[pIdx] : teamBDrivesUsed[pIdx];
    }
    
    // SCORING STATS: Calculate based on format
    let totalGross: number | null = null;
    let totalNet: number | null = null;
    let strokesVsParGross: number | null = null;
    let strokesVsParNet: number | null = null;
    let teamTotalGross: number | null = null;
    let teamStrokesVsParGross: number | null = null;
    
    if (format === "twoManBestBall" || format === "singles") {
      // Individual scoring formats - track player's own gross and net
      const playerGrossArr = team === "teamA" ? teamAPlayerGross : teamBPlayerGross;
      const playerNetArr = team === "teamA" ? teamAPlayerNet : teamBPlayerNet;
      totalGross = playerGrossArr[pIdx];
      totalNet = playerNetArr[pIdx];
      strokesVsParGross = totalGross - coursePar;
      strokesVsParNet = totalNet - coursePar;
    } else if (format === "twoManScramble" || format === "twoManShamble") {
      // Team scoring formats - track team gross
      teamTotalGross = team === "teamA" ? teamATotalGross : teamBTotalGross;
      teamStrokesVsParGross = teamTotalGross - coursePar;
    }

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

    // --- 2. PARTNERS ---
    const partnerIds: string[] = [];
    const partnerTiers: string[] = [];
    const partnerHandicaps: (number | null)[] = [];

    if (Array.isArray(myTeamPlayers)) {
      myTeamPlayers.forEach((tm) => {
        if (tm && tm.playerId && tm.playerId !== p.playerId) {
          partnerIds.push(tm.playerId);
          partnerTiers.push(playerTierLookup[tm.playerId] || "Unknown");
          partnerHandicaps.push(playerHandicapLookup[tm.playerId] ?? null);
        }
      });
    }

    const factData: any = {
      playerId: p.playerId, matchId, tournamentId: tId, roundId: rId, format,
      outcome, pointsEarned: pts,
      
      playerTier: myTier,
      playerTeamId: myTeamId,
      opponentTeamId: oppTeamId,
      
      // Handicaps
      playerHandicap,
      opponentHandicaps,
      partnerHandicaps,

      // Opponent Arrays
      opponentIds,
      opponentTiers,

      // Partner Arrays
      partnerIds,
      partnerTiers,

      // Match result details
      holesWon,
      holesLost,
      holesHalved,
      finalMargin: status.margin || 0,
      finalThru: status.thru || 18,

      // Momentum stats
      comebackWin,
      blownLead,
      
      // NEW: Additional stats
      strokesGiven,
      leadChanges,
      wasNeverBehind,
      winningHole,

      // Round context
      courseId,
      day,

      // Tournament context
      tournamentYear,
      tournamentName,
      tournamentSeries,
      
      updatedAt: FieldValue.serverTimestamp(),
    };
    
    // Format-specific stats (only include if applicable)
    if (ballsUsed !== null) factData.ballsUsed = ballsUsed;
    if (ballsUsedSolo !== null) factData.ballsUsedSolo = ballsUsedSolo;
    if (ballsUsedShared !== null) factData.ballsUsedShared = ballsUsedShared;
    if (ballsUsedSoloWonHole !== null) factData.ballsUsedSoloWonHole = ballsUsedSoloWonHole;
    if (ballsUsedSoloPush !== null) factData.ballsUsedSoloPush = ballsUsedSoloPush;
    if (drivesUsed !== null) factData.drivesUsed = drivesUsed;
    
    // Scoring stats
    factData.coursePar = coursePar;
    if (totalGross !== null) factData.totalGross = totalGross;
    if (totalNet !== null) factData.totalNet = totalNet;
    if (strokesVsParGross !== null) factData.strokesVsParGross = strokesVsParGross;
    if (strokesVsParNet !== null) factData.strokesVsParNet = strokesVsParNet;
    if (teamTotalGross !== null) factData.teamTotalGross = teamTotalGross;
    if (teamStrokesVsParGross !== null) factData.teamStrokesVsParGross = teamStrokesVsParGross;

    batch.set(db.collection("playerMatchFacts").doc(`${matchId}_${p.playerId}`), factData);
  };

  const pA = after.teamAPlayers || [];
  const pB = after.teamBPlayers || [];
  
  // Pass player index (pIdx) to writeFact for ballsUsed/drivesUsed lookup
  if (Array.isArray(pA)) pA.forEach((p: any, idx: number) => writeFact(p, "teamA", idx, pB, pA));
  if (Array.isArray(pB)) pB.forEach((p: any, idx: number) => writeFact(p, "teamB", idx, pA, pB));

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