/**
 * Firebase Cloud Functions for Rowdy Cup PWA
 * 
 * This file orchestrates all cloud functions, importing shared logic from modules.
 * 
 * Structure:
 * - helpers/matchHelpers.ts - Match setup utilities
 * - scoring/matchScoring.ts - Match scoring calculations
 * - types.ts - Shared TypeScript types
 * 
 * Updated: 2025-12-01 - Added holePerformance array to playerMatchFacts
 */

import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Import shared modules
import type { RoundFormat } from "./types.js";
import { 
  playersPerSide, 
  ensureSideSize, 
  normalizeHoles, 
  defaultStatus 
} from "./helpers/matchHelpers.js";
import { 
  summarize, 
  buildStatusAndResult,
  decideHole,
  holesRange,
  clamp01,
  isNum
} from "./scoring/matchScoring.js";

initializeApp();
const db = getFirestore();

// ============================================================================
// DOCUMENT SEED TRIGGERS
// These functions initialize default values when documents are created
// ============================================================================

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
    matchNumber: match.matchNumber ?? 0, // For ordering matches on Round page
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
  
  if (!Array.isArray(data.holes)) {
    toMerge.holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1,
      hcpIndex: 0,
      par: 4,
      yards: 0
    }));
  }
  
  if (data.par === undefined) toMerge.par = 72;
  if (data.name === undefined) toMerge.name = "";
  if (data.tees === undefined) toMerge.tees = "";
  
  if (Object.keys(toMerge).length > 0) {
    toMerge._seededAt = FieldValue.serverTimestamp();
    await ref.set(toMerge, { merge: true });
  }
});

// ============================================================================
// MATCH SCORING
// Computes match status and result on every match write
// ============================================================================

export const computeMatchOnWrite = onDocumentWritten("matches/{matchId}", async (event) => {
  const before = event.data?.before?.data() || {};
  const after = event.data?.after?.data();
  if (!after) return;
  
  // Prevent loops - only run if meaningful data changed
  const changed = [
    ...Object.keys(after).filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k])),
    ...Object.keys(before).filter(k => after[k] === undefined)
  ];
  if (changed.every(k => ["status", "result", "_computeSig"].includes(k))) return;

  const roundId = after.roundId;
  if (!roundId) return;
  const rSnap = await db.collection("rounds").doc(roundId).get();
  const format = (rSnap.data()?.format as RoundFormat) || "twoManBestBall";

  // Use imported scoring functions
  const summary = summarize(format, after);
  const { status, result } = buildStatusAndResult(summary);

  if (JSON.stringify(before.status) === JSON.stringify(status) && 
      JSON.stringify(before.result) === JSON.stringify(result)) return;

  await event.data!.after.ref.set({ status, result }, { merge: true });
});

// ============================================================================
// STATS ENGINE
// Generates PlayerMatchFact documents when matches close
// ============================================================================

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

  const tId = after.tournamentId || "";
  const rId = after.roundId || "";
  
  // Extract course handicaps from match document
  // Array order: [teamA[0], teamA[1], teamB[0], teamB[1]]
  const matchCourseHandicaps: number[] = Array.isArray(after.courseHandicaps) 
    ? after.courseHandicaps 
    : [0, 0, 0, 0];
  
  let format: RoundFormat = "twoManBestBall";
  let points = 1;
  let courseId = "";
  let coursePar = 72;
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
      
      if (rData?.course?.holes && Array.isArray(rData.course.holes)) {
        coursePar = rData.course.holes.reduce((sum: number, h: any) => sum + (h?.par || 4), 0);
      }
    }
  }
  
  // Re-compute status/result to ensure we have latest calculations
  // (avoids race condition with computeMatchOnWrite)
  const matchSummary = summarize(format, after);
  const { status, result } = buildStatusAndResult(matchSummary);
  
  if (courseId) {
    const cSnap = await db.collection("courses").doc(courseId).get();
    if (cSnap.exists) {
      const cData = cSnap.data();
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

  // Calculate match-wide stats by iterating through holes
  const holesData = after.holes || {};
  let leadChanges = 0;
  let wasTeamANeverBehind = true;
  let wasTeamBNeverBehind = true;
  let winningHole: number | null = null;
  let prevLeader: "teamA" | "teamB" | null = null;
  let runningMargin = 0;
  
  // Ball usage tracking (best ball & shamble)
  const teamABallsUsed = [0, 0];
  const teamBBallsUsed = [0, 0];
  const teamABallsUsedSolo = [0, 0];
  const teamBBallsUsedSolo = [0, 0];
  const teamABallsUsedShared = [0, 0];
  const teamBBallsUsedShared = [0, 0];
  const teamABallsUsedSoloWonHole = [0, 0];
  const teamBBallsUsedSoloWonHole = [0, 0];
  const teamABallsUsedSoloPush = [0, 0];
  const teamBBallsUsedSoloPush = [0, 0];
  
  // Drive tracking (scramble & shamble)
  const teamADrivesUsed = [0, 0];
  const teamBDrivesUsed = [0, 0];
  
  // Scoring stats
  const teamAPlayerGross = [0, 0];
  const teamBPlayerGross = [0, 0];
  const teamAPlayerNet = [0, 0];
  const teamBPlayerNet = [0, 0];
  let teamATotalGross = 0;
  let teamBTotalGross = 0;
  
  const finalThru = status.thru || 18;
  
  // 18th hole tracking
  let marginGoingInto18 = 0;
  let hole18Result: "teamA" | "teamB" | "AS" | null = null;
  const teamABallUsedOn18: (boolean | null)[] = [null, null];
  const teamBBallUsedOn18: (boolean | null)[] = [null, null];
  
  for (const i of holesRange(holesData)) {
    const h = holesData[String(i)]?.input ?? {};
    
    if (i === 18) {
      marginGoingInto18 = runningMargin;
    }
    
    const holeResult = decideHole(format, i, after);
    
    if (i === 18) {
      hole18Result = holeResult;
    }
    
    if (holeResult === "teamA") {
      runningMargin++;
    } else if (holeResult === "teamB") {
      runningMargin--;
    }
    
    const currentLeader = runningMargin > 0 ? "teamA" : runningMargin < 0 ? "teamB" : null;
    
    if (currentLeader !== null && prevLeader !== null && currentLeader !== prevLeader) {
      leadChanges++;
    }
    if (currentLeader !== null) {
      prevLeader = currentLeader;
    }
    
    if (runningMargin < 0) wasTeamANeverBehind = false;
    if (runningMargin > 0) wasTeamBNeverBehind = false;
    
    if (status.closed && winningHole === null) {
      const margin = Math.abs(runningMargin);
      const holesLeft = 18 - i;
      if (margin > holesLeft) {
        winningHole = i;
      }
    }
    
    // Best Ball ball usage tracking
    if (format === "twoManBestBall") {
      const aArr = h.teamAPlayersGross;
      const bArr = h.teamBPlayersGross;
      
      if (Array.isArray(aArr) && aArr[0] != null && aArr[1] != null) {
        const a0Stroke = clamp01(after.teamAPlayers?.[0]?.strokesReceived?.[i-1]);
        const a1Stroke = clamp01(after.teamAPlayers?.[1]?.strokesReceived?.[i-1]);
        const a0Net = aArr[0] - a0Stroke;
        const a1Net = aArr[1] - a1Stroke;
        if (a0Net <= a1Net) teamABallsUsed[0]++;
        if (a1Net <= a0Net) teamABallsUsed[1]++;
        if (a0Net < a1Net) {
          teamABallsUsedSolo[0]++;
          if (holeResult === "teamA") teamABallsUsedSoloWonHole[0]++;
          if (holeResult === "AS") teamABallsUsedSoloPush[0]++;
          if (i === 18) { teamABallUsedOn18[0] = true; teamABallUsedOn18[1] = false; }
        } else if (a1Net < a0Net) {
          teamABallsUsedSolo[1]++;
          if (holeResult === "teamA") teamABallsUsedSoloWonHole[1]++;
          if (holeResult === "AS") teamABallsUsedSoloPush[1]++;
          if (i === 18) { teamABallUsedOn18[0] = false; teamABallUsedOn18[1] = true; }
        } else {
          teamABallsUsedShared[0]++;
          teamABallsUsedShared[1]++;
          if (i === 18) { teamABallUsedOn18[0] = true; teamABallUsedOn18[1] = true; }
        }
      }
      
      if (Array.isArray(bArr) && bArr[0] != null && bArr[1] != null) {
        const b0Stroke = clamp01(after.teamBPlayers?.[0]?.strokesReceived?.[i-1]);
        const b1Stroke = clamp01(after.teamBPlayers?.[1]?.strokesReceived?.[i-1]);
        const b0Net = bArr[0] - b0Stroke;
        const b1Net = bArr[1] - b1Stroke;
        if (b0Net <= b1Net) teamBBallsUsed[0]++;
        if (b1Net <= b0Net) teamBBallsUsed[1]++;
        if (b0Net < b1Net) {
          teamBBallsUsedSolo[0]++;
          if (holeResult === "teamB") teamBBallsUsedSoloWonHole[0]++;
          if (holeResult === "AS") teamBBallsUsedSoloPush[0]++;
          if (i === 18) { teamBBallUsedOn18[0] = true; teamBBallUsedOn18[1] = false; }
        } else if (b1Net < b0Net) {
          teamBBallsUsedSolo[1]++;
          if (holeResult === "teamB") teamBBallsUsedSoloWonHole[1]++;
          if (holeResult === "AS") teamBBallsUsedSoloPush[1]++;
          if (i === 18) { teamBBallUsedOn18[0] = false; teamBBallUsedOn18[1] = true; }
        } else {
          teamBBallsUsedShared[0]++;
          teamBBallsUsedShared[1]++;
          if (i === 18) { teamBBallUsedOn18[0] = true; teamBBallUsedOn18[1] = true; }
        }
      }
    }
    
    // Shamble ball usage tracking (GROSS scores)
    if (format === "twoManShamble") {
      const aArr = h.teamAPlayersGross;
      const bArr = h.teamBPlayersGross;
      
      if (Array.isArray(aArr) && aArr[0] != null && aArr[1] != null) {
        if (aArr[0] <= aArr[1]) teamABallsUsed[0]++;
        if (aArr[1] <= aArr[0]) teamABallsUsed[1]++;
        if (aArr[0] < aArr[1]) {
          teamABallsUsedSolo[0]++;
          if (holeResult === "teamA") teamABallsUsedSoloWonHole[0]++;
          if (holeResult === "AS") teamABallsUsedSoloPush[0]++;
          if (i === 18) { teamABallUsedOn18[0] = true; teamABallUsedOn18[1] = false; }
        } else if (aArr[1] < aArr[0]) {
          teamABallsUsedSolo[1]++;
          if (holeResult === "teamA") teamABallsUsedSoloWonHole[1]++;
          if (holeResult === "AS") teamABallsUsedSoloPush[1]++;
          if (i === 18) { teamABallUsedOn18[0] = false; teamABallUsedOn18[1] = true; }
        } else {
          teamABallsUsedShared[0]++;
          teamABallsUsedShared[1]++;
          if (i === 18) { teamABallUsedOn18[0] = true; teamABallUsedOn18[1] = true; }
        }
      }
      
      if (Array.isArray(bArr) && bArr[0] != null && bArr[1] != null) {
        if (bArr[0] <= bArr[1]) teamBBallsUsed[0]++;
        if (bArr[1] <= bArr[0]) teamBBallsUsed[1]++;
        if (bArr[0] < bArr[1]) {
          teamBBallsUsedSolo[0]++;
          if (holeResult === "teamB") teamBBallsUsedSoloWonHole[0]++;
          if (holeResult === "AS") teamBBallsUsedSoloPush[0]++;
          if (i === 18) { teamBBallUsedOn18[0] = true; teamBBallUsedOn18[1] = false; }
        } else if (bArr[1] < bArr[0]) {
          teamBBallsUsedSolo[1]++;
          if (holeResult === "teamB") teamBBallsUsedSoloWonHole[1]++;
          if (holeResult === "AS") teamBBallsUsedSoloPush[1]++;
          if (i === 18) { teamBBallUsedOn18[0] = false; teamBBallUsedOn18[1] = true; }
        } else {
          teamBBallsUsedShared[0]++;
          teamBBallsUsedShared[1]++;
          if (i === 18) { teamBBallUsedOn18[0] = true; teamBBallUsedOn18[1] = true; }
        }
      }
    }
    
    // Drive tracking
    if (format === "twoManScramble" || format === "twoManShamble") {
      const aDrive = h.teamADrive;
      const bDrive = h.teamBDrive;
      if (aDrive === 0) teamADrivesUsed[0]++;
      else if (aDrive === 1) teamADrivesUsed[1]++;
      if (bDrive === 0) teamBDrivesUsed[0]++;
      else if (bDrive === 1) teamBDrivesUsed[1]++;
    }
    
    // Scoring stats by format
    if (format === "twoManScramble") {
      const aGross = h.teamAGross;
      const bGross = h.teamBGross;
      if (isNum(aGross)) teamATotalGross += aGross;
      if (isNum(bGross)) teamBTotalGross += bGross;
    } else if (format === "singles") {
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
      const aArr = h.teamAPlayersGross;
      const bArr = h.teamBPlayersGross;
      if (Array.isArray(aArr)) {
        if (isNum(aArr[0])) teamAPlayerGross[0] += aArr[0];
        if (isNum(aArr[1])) teamAPlayerGross[1] += aArr[1];
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
        if (isNum(bArr[0]) && isNum(bArr[1])) {
          teamBTotalGross += Math.min(bArr[0], bArr[1]);
        } else if (isNum(bArr[0])) {
          teamBTotalGross += bArr[0];
        } else if (isNum(bArr[1])) {
          teamBTotalGross += bArr[1];
        }
      }
    } else {
      // Best Ball
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

  // Fetch course holes data for holePerformance
  let courseHoles: { number: number; par: number }[] = [];
  if (courseId) {
    const cSnap2 = await db.collection("courses").doc(courseId).get();
    if (cSnap2.exists && Array.isArray(cSnap2.data()?.holes)) {
      courseHoles = cSnap2.data()!.holes.map((h: any) => ({ number: h.number || 0, par: h.par || 4 }));
    }
  }
  // Fallback to default pars if no course data
  if (courseHoles.length === 0) {
    courseHoles = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4 }));
  }

  const writeFact = (p: any, team: "teamA" | "teamB", pIdx: number, opponentPlayers: any[], myTeamPlayers: any[]) => {
    if (!p?.playerId) return;
    
    let outcome: "win" | "loss" | "halve" = "loss"; 
    let pts = 0;
    if (result.winner === "AS") { outcome = "halve"; pts = points / 2; }
    else if (result.winner === team) { outcome = "win"; pts = points; }

    const holesWon = team === "teamA" ? (result.holesWonA || 0) : (result.holesWonB || 0);
    const holesLost = team === "teamA" ? (result.holesWonB || 0) : (result.holesWonA || 0);
    const holesHalved = finalThru - holesWon - holesLost;

    const wasDown3PlusBack9 = team === "teamA" ? status.wasTeamADown3PlusBack9 : status.wasTeamAUp3PlusBack9;
    const wasUp3PlusBack9 = team === "teamA" ? status.wasTeamAUp3PlusBack9 : status.wasTeamADown3PlusBack9;
    const comebackWin = outcome === "win" && wasDown3PlusBack9 === true;
    const blownLead = outcome === "loss" && wasUp3PlusBack9 === true;
    
    const wasNeverBehind = team === "teamA" ? wasTeamANeverBehind : wasTeamBNeverBehind;
    
    const strokesGiven = Array.isArray(p.strokesReceived) 
      ? p.strokesReceived.reduce((sum: number, v: number) => sum + (v || 0), 0)
      : 0;
    
    // Ball usage stats
    let ballsUsed: number | null = null;
    let ballsUsedSolo: number | null = null;
    let ballsUsedShared: number | null = null;
    let ballsUsedSoloWonHole: number | null = null;
    let ballsUsedSoloPush: number | null = null;
    let ballUsedOn18: boolean | null = null;
    
    if (format === "twoManBestBall" || format === "twoManShamble") {
      ballsUsed = team === "teamA" ? teamABallsUsed[pIdx] : teamBBallsUsed[pIdx];
      ballsUsedSolo = team === "teamA" ? teamABallsUsedSolo[pIdx] : teamBBallsUsedSolo[pIdx];
      ballsUsedShared = team === "teamA" ? teamABallsUsedShared[pIdx] : teamBBallsUsedShared[pIdx];
      ballsUsedSoloWonHole = team === "teamA" ? teamABallsUsedSoloWonHole[pIdx] : teamBBallsUsedSoloWonHole[pIdx];
      ballsUsedSoloPush = team === "teamA" ? teamABallsUsedSoloPush[pIdx] : teamBBallsUsedSoloPush[pIdx];
      ballUsedOn18 = team === "teamA" ? teamABallUsedOn18[pIdx] : teamBBallUsedOn18[pIdx];
    }
    
    // Drive stats
    let drivesUsed: number | null = null;
    if (format === "twoManScramble" || format === "twoManShamble") {
      drivesUsed = team === "teamA" ? teamADrivesUsed[pIdx] : teamBDrivesUsed[pIdx];
    }
    
    // Scoring stats
    let totalGross: number | null = null;
    let totalNet: number | null = null;
    let strokesVsParGross: number | null = null;
    let strokesVsParNet: number | null = null;
    let teamTotalGross: number | null = null;
    let teamStrokesVsParGross: number | null = null;
    
    // Get player's course handicap from match document
    // Array structure depends on format:
    // - Singles: [teamA, teamB] (2 elements)
    // - 2-player formats: [teamA[0], teamA[1], teamB[0], teamB[1]] (4 elements)
    let courseHcpIndex: number;
    if (format === "singles") {
      // Singles: index 0 = teamA, index 1 = teamB
      courseHcpIndex = team === "teamA" ? 0 : 1;
    } else {
      // 2-player formats: [teamA[0], teamA[1], teamB[0], teamB[1]]
      courseHcpIndex = team === "teamA" ? pIdx : pIdx + 2;
    }
    const playerCourseHandicap = matchCourseHandicaps[courseHcpIndex] ?? 0;
    
    if (format === "twoManBestBall" || format === "singles") {
      const playerGrossArr = team === "teamA" ? teamAPlayerGross : teamBPlayerGross;
      totalGross = playerGrossArr[pIdx];
      // totalNet = totalGross - playerCourseHandicap (course handicap, not match strokes)
      totalNet = totalGross - playerCourseHandicap;
      strokesVsParGross = totalGross - coursePar;
      // strokesVsParNet uses course handicap from match document (integer)
      strokesVsParNet = totalGross - playerCourseHandicap - coursePar;
    } else if (format === "twoManScramble" || format === "twoManShamble") {
      teamTotalGross = team === "teamA" ? teamATotalGross : teamBTotalGross;
      teamStrokesVsParGross = teamTotalGross - coursePar;
    }

    const myTier = playerTierLookup[p.playerId] || "Unknown";
    const myTeamId = team === "teamA" ? teamAId : teamBId;
    const oppTeamId = team === "teamA" ? teamBId : teamAId;
    const playerHandicap = playerHandicapLookup[p.playerId] ?? null;

    // 18th hole decision tracking
    let decidedOn18 = false;
    let won18thHole: boolean | null = null;
    
    // decidedOn18 = true when match went to 18 AND wasn't closed before hole 18
    // winningHole === null means AS match, winningHole === 18 means decided on 18
    const matchWentTo18 = finalThru === 18 && (winningHole === null || winningHole === 18);
    
    if (matchWentTo18 && hole18Result !== null) {
      const myTeamWon18 = (team === "teamA" && hole18Result === "teamA") || 
                          (team === "teamB" && hole18Result === "teamB");
      const myTeamLost18 = (team === "teamA" && hole18Result === "teamB") || 
                           (team === "teamB" && hole18Result === "teamA");
      const pushed18 = hole18Result === "AS";
      
      if (marginGoingInto18 === 0) {
        if (!pushed18) {
          decidedOn18 = true;
          won18thHole = myTeamWon18 ? true : false;
        }
      } else if (Math.abs(marginGoingInto18) === 1) {
        if ((marginGoingInto18 > 0 && team === "teamB" && hole18Result === "teamB") ||
            (marginGoingInto18 < 0 && team === "teamA" && hole18Result === "teamA") ||
            (marginGoingInto18 > 0 && team === "teamA" && hole18Result === "teamB") ||
            (marginGoingInto18 < 0 && team === "teamB" && hole18Result === "teamA")) {
          decidedOn18 = true;
          won18thHole = myTeamWon18 ? true : myTeamLost18 ? false : null;
        }
      }
    }

    // Build holePerformance array
    const holePerformance: any[] = [];
    for (const holeNum of holesRange(holesData)) {
      const h = holesData[String(holeNum)]?.input ?? {};
      const holeInfo = courseHoles.find(ch => ch.number === holeNum) || { number: holeNum, par: 4 };
      
      // Determine hole result from team perspective
      const hResult = decideHole(format, holeNum, after);
      let holeResult: 'win' | 'loss' | 'halve' | null = null;
      if (hResult === team) holeResult = 'win';
      else if (hResult === 'AS') holeResult = 'halve';
      else if (hResult !== null) holeResult = 'loss';
      
      const holeData: any = {
        hole: holeNum,
        par: holeInfo.par,
        result: holeResult,
      };
      
      if (format === "singles") {
        const gross = team === "teamA" ? h.teamAPlayerGross : h.teamBPlayerGross;
        holeData.gross = gross ?? null;
        if (gross != null) {
          const strokeVal = clamp01(p.strokesReceived?.[holeNum - 1]);
          holeData.strokes = strokeVal as 0 | 1;
          holeData.net = gross - strokeVal;
        }
      } else if (format === "twoManBestBall") {
        const arr = team === "teamA" ? h.teamAPlayersGross : h.teamBPlayersGross;
        const gross = Array.isArray(arr) ? arr[pIdx] : null;
        holeData.gross = gross ?? null;
        if (gross != null) {
          const strokeVal = clamp01(p.strokesReceived?.[holeNum - 1]);
          holeData.strokes = strokeVal as 0 | 1;
          holeData.net = gross - strokeVal;
        }
      } else if (format === "twoManShamble") {
        // Shamble: individual gross, no net/strokes, but has driveUsed
        const arr = team === "teamA" ? h.teamAPlayersGross : h.teamBPlayersGross;
        const gross = Array.isArray(arr) ? arr[pIdx] : null;
        holeData.gross = gross ?? null;
        const driveVal = team === "teamA" ? h.teamADrive : h.teamBDrive;
        holeData.driveUsed = driveVal === pIdx;
      } else if (format === "twoManScramble") {
        // Scramble: team gross, has driveUsed
        const gross = team === "teamA" ? h.teamAGross : h.teamBGross;
        holeData.gross = gross ?? null;
        const driveVal = team === "teamA" ? h.teamADrive : h.teamBDrive;
        holeData.driveUsed = driveVal === pIdx;
      }
      
      holePerformance.push(holeData);
    }

    // Opponent/Partner arrays
    const opponentIds: string[] = [];
    const opponentTiers: string[] = [];
    const opponentHandicaps: (number | null)[] = [];
    const partnerIds: string[] = [];
    const partnerTiers: string[] = [];
    const partnerHandicaps: (number | null)[] = [];

    if (Array.isArray(opponentPlayers)) {
      opponentPlayers.forEach((op) => {
        if (op && op.playerId) {
          opponentIds.push(op.playerId);
          opponentTiers.push(playerTierLookup[op.playerId] || "Unknown");
          opponentHandicaps.push(playerHandicapLookup[op.playerId] ?? null);
        }
      });
    }

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
      playerHandicap,
      opponentHandicaps,
      partnerHandicaps,
      opponentIds,
      opponentTiers,
      partnerIds,
      partnerTiers,
      holesWon,
      holesLost,
      holesHalved,
      finalMargin: status.margin || 0,
      finalThru: status.thru || 18,
      comebackWin,
      blownLead,
      strokesGiven,
      leadChanges,
      wasNeverBehind,
      winningHole,
      decidedOn18,
      won18thHole,
      courseId,
      day,
      tournamentYear,
      tournamentName,
      tournamentSeries,
      updatedAt: FieldValue.serverTimestamp(),
    };
    
    // Conditionally add format-specific stats
    if (ballsUsed !== null) factData.ballsUsed = ballsUsed;
    if (ballsUsedSolo !== null) factData.ballsUsedSolo = ballsUsedSolo;
    if (ballsUsedShared !== null) factData.ballsUsedShared = ballsUsedShared;
    if (ballsUsedSoloWonHole !== null) factData.ballsUsedSoloWonHole = ballsUsedSoloWonHole;
    if (ballsUsedSoloPush !== null) factData.ballsUsedSoloPush = ballsUsedSoloPush;
    if (ballUsedOn18 !== null) factData.ballUsedOn18 = ballUsedOn18;
    if (drivesUsed !== null) factData.drivesUsed = drivesUsed;
    
    factData.coursePar = coursePar;
    factData.playerCourseHandicap = playerCourseHandicap;
    if (totalGross !== null) factData.totalGross = totalGross;
    if (totalNet !== null) factData.totalNet = totalNet;
    if (strokesVsParGross !== null) factData.strokesVsParGross = strokesVsParGross;
    if (strokesVsParNet !== null) factData.strokesVsParNet = strokesVsParNet;
    if (teamTotalGross !== null) factData.teamTotalGross = teamTotalGross;
    if (teamStrokesVsParGross !== null) factData.teamStrokesVsParGross = teamStrokesVsParGross;
    
    // Add holePerformance array
    factData.holePerformance = holePerformance;

    batch.set(db.collection("playerMatchFacts").doc(`${matchId}_${p.playerId}`), factData);
  };

  const pA = after.teamAPlayers || [];
  const pB = after.teamBPlayers || [];
  
  if (Array.isArray(pA)) pA.forEach((p: any, idx: number) => writeFact(p, "teamA", idx, pB, pA));
  if (Array.isArray(pB)) pB.forEach((p: any, idx: number) => writeFact(p, "teamB", idx, pA, pB));

  await batch.commit();
});

// ============================================================================
// PLAYER STATS AGGREGATION
// Aggregates PlayerMatchFact documents into PlayerStats
// ============================================================================

export const aggregatePlayerStats = onDocumentWritten("playerMatchFacts/{factId}", async (event) => {
  const data = event.data?.after?.data() || event.data?.before?.data();
  if (!data?.playerId) return;

  const snap = await db.collection("playerMatchFacts").where("playerId", "==", data.playerId).get();
  let wins = 0, losses = 0, halves = 0, totalPoints = 0, matchesPlayed = 0;

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
