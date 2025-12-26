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
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

// Import shared modules
import type { RoundFormat, PlayerHoleScore, HoleSkinData, PlayerSkinsTotal, SkinsResultDoc } from "./types.js";
import { DEFAULT_COURSE_PAR, JEKYLL_AND_HYDE_THRESHOLD } from "./constants.js";
import { calculateCourseHandicap, calculateStrokesReceived, calculateSkinsStrokes } from "./ghin.js";
import { computeVsAllForRound, type PlayerFactForSim } from "./helpers/vsAllSimulation.js";
import { checkRateLimit } from "./rateLimit.js";
import { ensureTournamentTeamColors } from "./utils/teamColors.js";
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
  if (changed.every(k => ["status", "result", "_computeSig", "_lastComputed"].includes(k))) return;
  
  // Compute signature from holes data to detect actual changes
  const holesSig = JSON.stringify(after.holes || {});
  if (after._computeSig === holesSig) return;

  const roundId = after.roundId;
  if (!roundId) return;
  const rSnap = await db.collection("rounds").doc(roundId).get();
  const format = (rSnap.data()?.format as RoundFormat) || "twoManBestBall";

  // Use imported scoring functions
  const summary = summarize(format, after);
  const { status, result } = buildStatusAndResult(summary);

  if (JSON.stringify(before.status) === JSON.stringify(status) && 
      JSON.stringify(before.result) === JSON.stringify(result)) return;

  // Check if all 18 holes have scores entered
  const holesData = after.holes || {};
  let completedHolesCount = 0;
  for (const key of Object.keys(holesData)) {
    const holeNum = parseInt(key, 10);
    if (holeNum >= 1 && holeNum <= 18) {
      const input = holesData[key]?.input;
      let hasScore = false;
      if (format === "singles") {
        hasScore = input?.teamAPlayerGross != null || input?.teamBPlayerGross != null;
      } else if (format === "twoManScramble" || format === "fourManScramble") {
        hasScore = input?.teamAGross != null || input?.teamBGross != null;
      } else if (format === "twoManBestBall" || format === "twoManShamble") {
        const aArr = input?.teamAPlayersGross;
        const bArr = input?.teamBPlayersGross;
        hasScore = (Array.isArray(aArr) && (aArr[0] != null || aArr[1] != null)) ||
                   (Array.isArray(bArr) && (bArr[0] != null || bArr[1] != null));
      }
      if (hasScore) completedHolesCount++;
    }
  }
  const allHolesCompleted = completedHolesCount === 18;
  
  // Auto-complete match when it's closed AND all 18 holes are scored
  const shouldAutoComplete = status.closed && allHolesCompleted && !before.completed;

  // Store computation signature and context for updateMatchFacts to avoid re-fetching
  // This denormalization reduces Firestore reads in updateMatchFacts by caching
  // frequently-needed round data that doesn't change during a match
  const roundData = rSnap.data();
  const updateData: any = { 
    status, 
    result, 
    _computeSig: holesSig,
    _lastComputed: { 
      format, 
      roundId, 
      courseId: roundData?.courseId,
      pointsValue: roundData?.pointsValue ?? 1,
      day: roundData?.day ?? 0,
    },
  };
  
  if (shouldAutoComplete) {
    updateData.completed = true;
  }
  
  await event.data!.after.ref.set(updateData, { merge: true });
});

// ============================================================================
// STATS ENGINE
// Generates PlayerMatchFact documents when matches close
// ============================================================================

export const updateMatchFacts = onDocumentWritten("matches/{matchId}", async (event) => {
  const matchId = event.params.matchId;
  const after = event.data?.after?.data();
  
  const tId = after?.tournamentId || "";
  const rId = after?.roundId || "";
  
  // Reuse cached context from computeMatchOnWrite to avoid redundant fetches
  // This optimization reduces Firestore reads by 1 (round doc) per match close
  const cachedData = after?._lastComputed || {};
  let format: RoundFormat = (cachedData.format as RoundFormat) || "twoManBestBall";
  let points = cachedData.pointsValue ?? 1;
  let courseId = cachedData.courseId || "";
  let day = cachedData.day ?? 0;
  
  // Only fetch round if cached data is incomplete (fallback for old matches)
  const needsRoundFetch = !cachedData.format || cachedData.pointsValue === undefined;
  if (needsRoundFetch && rId) {
    const rSnap = await db.collection("rounds").doc(rId).get();
    if (rSnap.exists) {
      const rData = rSnap.data();
      format = (rData?.format as RoundFormat) || format;
      points = rData?.pointsValue ?? points;
      courseId = courseId || (rData?.courseId || "");
      day = rData?.day ?? day;
    }
  }
  
  // Only write facts when match is closed (status.closed === true)
  const shouldWriteFacts = after?.status?.closed === true;
  
  if (!after || !shouldWriteFacts) {
    // Clean up facts if match not closed, re-opened, or deleted
    const snap = await db.collection("playerMatchFacts").where("matchId", "==", matchId).get();
    if (snap.empty) return;
    const b = db.batch();
    snap.docs.forEach(d => b.delete(d.ref));
    await b.commit();
    return;
  }
  
  // Extract course handicaps from match document
  // Array order: [teamA[0], teamA[1], teamB[0], teamB[1]]
  const matchCourseHandicaps: number[] = Array.isArray(after.courseHandicaps) 
    ? after.courseHandicaps 
    : [0, 0, 0, 0];
  
  let coursePar = DEFAULT_COURSE_PAR;
  let playerTierLookup: Record<string, string> = {};
  let playerHandicapLookup: Record<string, number> = {};
  let teamAId = "teamA";
  let teamBId = "teamB";
  let tournamentYear = 0;
  let tournamentName = "";
  let tournamentSeries = "";
  let teamACaptainId: string | null = null;
  let teamACoCaptainId: string | null = null;
  let teamBCaptainId: string | null = null;
  let teamBCoCaptainId: string | null = null;

  // Use pre-computed status/result from match document (computed by computeMatchOnWrite)
  // This avoids redundant computation and race conditions
  const status = after?.status || { leader: null, margin: 0, thru: 0, dormie: false, closed: false };
  const result = after?.result || {};
  
  // Get holes data for stats computation
  const holesData = after.holes || {};
  
  // Fetch course data ONCE (consolidating two separate fetches)
  let courseHoles: { number: number; par: number }[] = [];
  if (courseId) {
    const cSnap = await db.collection("courses").doc(courseId).get();
    if (cSnap.exists) {
      const cData = cSnap.data();
      // Extract par from course document
      if (typeof cData?.par === "number") {
        coursePar = cData.par;
      } else if (Array.isArray(cData?.holes)) {
        coursePar = cData.holes.reduce((sum: number, h: any) => sum + (h?.par || 4), 0);
      }
      // Extract holes array for ham-and-egg calculations
      if (Array.isArray(cData?.holes)) {
        courseHoles = cData.holes.map((h: any) => ({ number: h.number || 0, par: h.par || 4 }));
      }
    }
  }
  // Fallback to default pars if no course data
  if (courseHoles.length === 0) {
    courseHoles = Array.from({ length: 18 }, (_, idx) => ({ number: idx + 1, par: 4 }));
  }

  if (tId) {
    const tSnap = await db.collection("tournaments").doc(tId).get();
    if (tSnap.exists) {
      const dRaw = tSnap.data()!;
      const d = ensureTournamentTeamColors(dRaw as any) as any;
      teamAId = d.teamA?.id || "teamA";
      teamBId = d.teamB?.id || "teamB";
      tournamentYear = d.year || 0;
      tournamentName = d.name || "";
      tournamentSeries = d.series || "";
      teamACaptainId = d.teamA?.captainId || null;
      teamACoCaptainId = d.teamA?.coCaptainId || null;
      teamBCaptainId = d.teamB?.captainId || null;
      teamBCoCaptainId = d.teamB?.coCaptainId || null;
      
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

  // Pre-calculate winningHole before main loop
  // This is the hole where the match was decided (margin > holes remaining)
  // Note: holesData already declared earlier in function for completedHolesCount check
  let winningHole: number | null = null;
  {
    let tempMargin = 0;
    for (const i of holesRange(holesData)) {
      const holeResult = decideHole(format, i, after);
      if (holeResult === "teamA") tempMargin++;
      else if (holeResult === "teamB") tempMargin--;
      
      const margin = Math.abs(tempMargin);
      const holesLeft = 18 - i;
      if (margin > holesLeft && winningHole === null) {
        winningHole = i;
        break;
      }
    }
  }
  
  // Check if there's post-match data (actual scores entered after winningHole)
  let hasPostMatchData = false;
  if (winningHole !== null) {
    for (const i of holesRange(holesData)) {
      if (i <= winningHole) continue;
      const input = holesData[String(i)]?.input;
      let hasScore = false;
      if (format === "singles") {
        hasScore = input?.teamAPlayerGross != null || input?.teamBPlayerGross != null;
      } else if (format === "twoManScramble" || format === "fourManScramble") {
        hasScore = input?.teamAGross != null || input?.teamBGross != null;
      } else if (format === "twoManBestBall" || format === "twoManShamble") {
        const aArr = input?.teamAPlayersGross;
        const bArr = input?.teamBPlayersGross;
        hasScore = (Array.isArray(aArr) && (aArr[0] != null || aArr[1] != null)) ||
                   (Array.isArray(bArr) && (bArr[0] != null || bArr[1] != null));
      }
      if (hasScore) {
        hasPostMatchData = true;
        break;
      }
    }
  }

  // Calculate match-wide stats by iterating through holes
  let leadChanges = 0;
  let wasTeamANeverBehind = true;
  let wasTeamBNeverBehind = true;
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
  
  // Ham & Egg tracking (bestBall & shamble): one player net par or better, other net bogey or worse
  let teamAHamAndEggCount = 0;
  let teamBHamAndEggCount = 0;
  
  // Jekyll & Hyde tracking: compare worst ball total vs best ball total
  // For bestBall: uses NET scores; for shamble: uses GROSS scores
  let teamABestBallTotal = 0;
  let teamBBestBallTotal = 0;
  let teamAWorstBallTotal = 0;
  let teamBWorstBallTotal = 0;
  
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
    
    // Determine if this hole is part of the match (before or at winningHole)
    // Match stats only accumulate for match holes; scoring stats accumulate for all holes
    const isMatchHole = winningHole === null || i <= winningHole;
    
    if (i === 18) {
      marginGoingInto18 = runningMargin;
    }
    
    const holeResult = decideHole(format, i, after);
    
    if (i === 18) {
      hole18Result = holeResult;
    }
    
    // Match status tracking - only for match holes
    if (isMatchHole) {
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
    }
    
    // Best Ball ball usage tracking - only for match holes
    if (format === "twoManBestBall" && isMatchHole) {
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
      
      // Ham & Egg tracking for Best Ball
      // One player NET par or better, other player NET double bogey or worse
      const hp = courseHoles.find(ch => ch.number === i)?.par ?? 4;
      if (Array.isArray(aArr) && aArr[0] != null && aArr[1] != null) {
        const a0Stroke = clamp01(after.teamAPlayers?.[0]?.strokesReceived?.[i-1]);
        const a1Stroke = clamp01(after.teamAPlayers?.[1]?.strokesReceived?.[i-1]);
        const a0Net = aArr[0] - a0Stroke;
        const a1Net = aArr[1] - a1Stroke;
        const a0NetVsPar = a0Net - hp;
        const a1NetVsPar = a1Net - hp;
        // Ham & Egg: one NET <= 0 (par or better) AND other NET >= 2 (double bogey or worse)
        if ((a0NetVsPar <= 0 && a1NetVsPar >= 2) || (a1NetVsPar <= 0 && a0NetVsPar >= 2)) {
          teamAHamAndEggCount++;
        }
        // Jekyll & Hyde tracking: best ball (min NET) and worst ball (max NET) per hole
        teamABestBallTotal += Math.min(a0Net, a1Net);
        teamAWorstBallTotal += Math.max(a0Net, a1Net);
      }
      if (Array.isArray(bArr) && bArr[0] != null && bArr[1] != null) {
        const b0Stroke = clamp01(after.teamBPlayers?.[0]?.strokesReceived?.[i-1]);
        const b1Stroke = clamp01(after.teamBPlayers?.[1]?.strokesReceived?.[i-1]);
        const b0Net = bArr[0] - b0Stroke;
        const b1Net = bArr[1] - b1Stroke;
        const b0NetVsPar = b0Net - hp;
        const b1NetVsPar = b1Net - hp;
        if ((b0NetVsPar <= 0 && b1NetVsPar >= 2) || (b1NetVsPar <= 0 && b0NetVsPar >= 2)) {
          teamBHamAndEggCount++;
        }
        // Jekyll & Hyde tracking: best ball (min NET) and worst ball (max NET) per hole
        teamBBestBallTotal += Math.min(b0Net, b1Net);
        teamBWorstBallTotal += Math.max(b0Net, b1Net);
      }
    }
    
    // Shamble ball usage tracking (GROSS scores) - only for match holes
    if (format === "twoManShamble" && isMatchHole) {
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
      
      // Ham & Egg tracking for Shamble (GROSS scores, since no strokes)
      // One player gross par or better, other gross double bogey or worse
      const hp = courseHoles.find(ch => ch.number === i)?.par ?? 4;
      if (Array.isArray(aArr) && aArr[0] != null && aArr[1] != null) {
        const a0VsPar = aArr[0] - hp;
        const a1VsPar = aArr[1] - hp;
        // Ham & Egg: one <= 0 (par or better) AND other >= 2 (double bogey or worse)
        if ((a0VsPar <= 0 && a1VsPar >= 2) || (a1VsPar <= 0 && a0VsPar >= 2)) {
          teamAHamAndEggCount++;
        }
        // Jekyll & Hyde tracking: best ball (min GROSS) and worst ball (max GROSS) per hole
        teamABestBallTotal += Math.min(aArr[0], aArr[1]);
        teamAWorstBallTotal += Math.max(aArr[0], aArr[1]);
      }
      if (Array.isArray(bArr) && bArr[0] != null && bArr[1] != null) {
        const b0VsPar = bArr[0] - hp;
        const b1VsPar = bArr[1] - hp;
        if ((b0VsPar <= 0 && b1VsPar >= 2) || (b1VsPar <= 0 && b0VsPar >= 2)) {
          teamBHamAndEggCount++;
        }
        // Jekyll & Hyde tracking: best ball (min GROSS) and worst ball (max GROSS) per hole
        teamBBestBallTotal += Math.min(bArr[0], bArr[1]);
        teamBWorstBallTotal += Math.max(bArr[0], bArr[1]);
      }
    }
    
    // Drive tracking - only for match holes
    if ((format === "twoManScramble" || format === "twoManShamble") && isMatchHole) {
      const aDrive = h.teamADrive;
      const bDrive = h.teamBDrive;
      if (aDrive === 0) teamADrivesUsed[0]++;
      else if (aDrive === 1) teamADrivesUsed[1]++;
      if (bDrive === 0) teamBDrivesUsed[0]++;
      else if (bDrive === 1) teamBDrivesUsed[1]++;
    }
    
    // Scoring stats by format - tracks ALL holes (including post-match)
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

  // Determine which players in this match are captains
  const pA = after.teamAPlayers || [];
  const pB = after.teamBPlayers || [];
  const teamAPlayerIds = pA.map((p: any) => p?.playerId).filter(Boolean);
  const teamBPlayerIds = pB.map((p: any) => p?.playerId).filter(Boolean);
  
  const teamACaptainInMatch = teamACaptainId && teamAPlayerIds.includes(teamACaptainId);
  const teamBCaptainInMatch = teamBCaptainId && teamBPlayerIds.includes(teamBCaptainId);
  const isCaptainVsCaptainMatch = teamACaptainInMatch && teamBCaptainInMatch;

  const writeFact = (p: any, team: "teamA" | "teamB", pIdx: number, opponentPlayers: any[], myTeamPlayers: any[]) => {
    if (!p?.playerId) return;
    
    // Captain status for this player
    const myCaptainId = team === "teamA" ? teamACaptainId : teamBCaptainId;
    const myCoCaptainId = team === "teamA" ? teamACoCaptainId : teamBCoCaptainId;
    const isCaptain = p.playerId === myCaptainId;
    const isCoCaptain = p.playerId === myCoCaptainId;
    // captainVsCaptain is only true for the captains themselves in a captain-vs-captain match
    const captainVsCaptain = isCaptainVsCaptainMatch && isCaptain;
    
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
    
    // Ham & Egg stats (team-level count, same for both players on a team)
    let hamAndEggCount: number | null = null;
    if (format === "twoManBestBall" || format === "twoManShamble") {
      hamAndEggCount = team === "teamA" ? teamAHamAndEggCount : teamBHamAndEggCount;
    }
    
    // Jekyll & Hyde: worst ball total - best ball total >= JEKYLL_AND_HYDE_THRESHOLD
    let jekyllAndHyde: boolean | null = null;
    if (format === "twoManBestBall" || format === "twoManShamble") {
      const bestBallTotal = team === "teamA" ? teamABestBallTotal : teamBBestBallTotal;
      const worstBallTotal = team === "teamA" ? teamAWorstBallTotal : teamBWorstBallTotal;
      jekyllAndHyde = (worstBallTotal - bestBallTotal) >= JEKYLL_AND_HYDE_THRESHOLD;
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
      // totalGross/totalNet will be computed from holePerformance below
      // (ensures post-match holes are included regardless of when match closed)
      totalGross = null;
      totalNet = null;
      strokesVsParGross = null;
      strokesVsParNet = null;
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

    // Build holePerformance array (tracks ALL holes with any scores, including post-match)
    const holePerformance: any[] = [];
    // per-player scoring counters
    let birdies = 0;
    let eagles = 0;
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
        // Count birdies/eagles for singles
        if (holeData.gross != null && holeInfo.par != null) {
          const diff = holeData.gross - holeInfo.par;
          if (diff === -1) birdies++;
          else if (diff <= -2) eagles++;
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
        // Partner's net score for comparison
        if (Array.isArray(arr)) {
          const partnerIdx = pIdx === 0 ? 1 : 0;
          const partnerGross = arr[partnerIdx];
          if (isNum(partnerGross)) {
            const partnerStroke = clamp01(myTeamPlayers?.[partnerIdx]?.strokesReceived?.[holeNum - 1]);
            holeData.partnerNet = partnerGross - partnerStroke;
          } else {
            holeData.partnerNet = null;
          }
          }
          // Count birdies/eagles for best ball from individual GROSS scores
          if (holeData.gross != null && holeInfo.par != null) {
            const diff = holeData.gross - holeInfo.par;
            if (diff === -1) birdies++;
            else if (diff <= -2) eagles++;
        }
      } else if (format === "twoManShamble") {
        // Shamble: individual gross, no net/strokes, but has driveUsed
        const arr = team === "teamA" ? h.teamAPlayersGross : h.teamBPlayersGross;
        const gross = Array.isArray(arr) ? arr[pIdx] : null;
        holeData.gross = gross ?? null;
        // Partner's gross score for comparison (shamble uses gross)
        if (Array.isArray(arr)) {
          const partnerIdx = pIdx === 0 ? 1 : 0;
          holeData.partnerGross = isNum(arr[partnerIdx]) ? arr[partnerIdx] : null;
        }
        const driveVal = team === "teamA" ? h.teamADrive : h.teamBDrive;
        holeData.driveUsed = driveVal === pIdx;
        // Count birdies/eagles for shamble (individual gross available)
        if (holeData.gross != null && holeInfo.par != null) {
          const diff = holeData.gross - holeInfo.par;
          if (diff === -1) birdies++;
          else if (diff <= -2) eagles++;
        }
      } else if (format === "twoManScramble") {
        // Scramble: team gross, has driveUsed
        const gross = team === "teamA" ? h.teamAGross : h.teamBGross;
        holeData.gross = gross ?? null;
        const driveVal = team === "teamA" ? h.teamADrive : h.teamBDrive;
        holeData.driveUsed = driveVal === pIdx;
        // For scramble, attribute birdies/eagles to all team players (team gross applies to whole team)
        if (holeData.gross != null && holeInfo.par != null) {
          const diff = holeData.gross - holeInfo.par;
          if (diff === -1) birdies++;
          else if (diff <= -2) eagles++;
        }
      }
      
      holePerformance.push(holeData);
    }

    // After building holePerformance (which includes post-match holes), compute per-player totals
    // and how many holes this player actually has a score for
    const holesPlayedForPlayer = holePerformance.reduce(
      (sum, hh) => sum + (typeof hh.gross === "number" ? 1 : 0),
      0
    );

    if (format === "twoManBestBall" || format === "singles") {
      const grossSum = holePerformance.reduce((s, hh) => s + (typeof hh.gross === "number" ? hh.gross : 0), 0);
      totalGross = grossSum;
      // totalNet should be based on course handicap, not strokesReceived
      totalNet = typeof totalGross === "number" ? totalGross - playerCourseHandicap : null;
      strokesVsParGross = typeof totalGross === "number" ? (totalGross - coursePar) : null;
      // Use player's course handicap for strokesVsParNet calculation (not strokesReceived)
      strokesVsParNet = typeof totalGross === "number" ? (totalGross - playerCourseHandicap - coursePar) : null;
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
      hasPostMatchData,
      holesPlayed: holesPlayedForPlayer,
      decidedOn18,
      won18thHole,
      courseId,
      day,
      tournamentYear,
      tournamentName,
      tournamentSeries,
      updatedAt: FieldValue.serverTimestamp(),
    };
    
    // Captain tracking - only add if true to avoid clutter
    if (isCaptain) factData.isCaptain = true;
    if (isCoCaptain) factData.isCoCaptain = true;
    if (captainVsCaptain) factData.captainVsCaptain = true;
    
    // Conditionally add format-specific stats
    if (ballsUsed !== null) factData.ballsUsed = ballsUsed;
    if (ballsUsedSolo !== null) factData.ballsUsedSolo = ballsUsedSolo;
    if (ballsUsedShared !== null) factData.ballsUsedShared = ballsUsedShared;
    if (ballsUsedSoloWonHole !== null) factData.ballsUsedSoloWonHole = ballsUsedSoloWonHole;
    if (ballsUsedSoloPush !== null) factData.ballsUsedSoloPush = ballsUsedSoloPush;
    if (ballUsedOn18 !== null) factData.ballUsedOn18 = ballUsedOn18;
    if (drivesUsed !== null) factData.drivesUsed = drivesUsed;
    if (hamAndEggCount !== null) factData.hamAndEggCount = hamAndEggCount;
    if (jekyllAndHyde === true) factData.jekyllAndHyde = true;
    
    // Best Ball & Worst Ball totals (for bestBall/shamble team comparison)
    if (format === "twoManBestBall" || format === "twoManShamble") {
      const bestBallTotal = team === "teamA" ? teamABestBallTotal : teamBBestBallTotal;
      const worstBallTotal = team === "teamA" ? teamAWorstBallTotal : teamBWorstBallTotal;
      factData.bestBallTotal = bestBallTotal;
      factData.worstBallTotal = worstBallTotal;
      factData.worstBallStrokesVsPar = worstBallTotal - coursePar;
    }
    
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
    // Add birdie/eagle counters if any
    if (birdies > 0) factData.birdies = birdies;
    if (eagles > 0) factData.eagles = eagles;

    batch.set(db.collection("playerMatchFacts").doc(`${matchId}_${p.playerId}`), factData);
  };

  if (Array.isArray(pA)) pA.forEach((p: any, idx: number) => writeFact(p, "teamA", idx, pB, pA));
  if (Array.isArray(pB)) pB.forEach((p: any, idx: number) => writeFact(p, "teamB", idx, pA, pB));

  await batch.commit();
});

// ============================================================================
// SKINS COMPUTATION
// Computes hole-by-hole skins data for the entire round when any match updates
// Stores pre-computed results in rounds/{roundId}/skinsResults/computed
// ============================================================================

export const computeRoundSkins = onDocumentWritten("matches/{matchId}", async (event) => {
  const after = event.data?.after?.data();
  const before = event.data?.before?.data();
  
  // Get round ID from after or before (handle deletion)
  const roundId = after?.roundId || before?.roundId;
  if (!roundId) return;
  
  // Fetch round to check if skins are enabled
  const roundSnap = await db.collection("rounds").doc(roundId).get();
  if (!roundSnap.exists) return;
  
  const round = roundSnap.data()!;
  const format = round.format as RoundFormat;
  
  // Only singles and twoManBestBall support skins
  if (format !== "singles" && format !== "twoManBestBall") return;
  
  const skinsGrossPot = round.skinsGrossPot ?? 0;
  const skinsNetPot = round.skinsNetPot ?? 0;
  
  // Skip if no skins configured
  if (skinsGrossPot <= 0 && skinsNetPot <= 0) return;
  
  // Fetch all matches for this round
  const matchesSnap = await db.collection("matches").where("roundId", "==", roundId).get();
  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  
  if (matches.length === 0) return;
  
  // Fetch course data
  const courseId = round.courseId;
  if (!courseId) return;
  
  const courseSnap = await db.collection("courses").doc(courseId).get();
  if (!courseSnap.exists) return;
  
  const course = courseSnap.data()!;
  const courseHoles: { number: number; par: number; hcpIndex: number }[] = course.holes || [];
  
  if (courseHoles.length === 0) return;
  
  // Fetch tournament for handicap data
  const tournamentId = round.tournamentId;
  if (!tournamentId) return;
  
  const tournamentSnap = await db.collection("tournaments").doc(tournamentId).get();
  if (!tournamentSnap.exists) return;
  
  const tournament = tournamentSnap.data()!;
  
  // Fetch player names
  const playerIds = new Set<string>();
  matches.forEach((match: any) => {
    (match.teamAPlayers || []).forEach((p: any) => playerIds.add(p.playerId));
    (match.teamBPlayers || []).forEach((p: any) => playerIds.add(p.playerId));
  });
  
  const playerNames: Record<string, string> = {};
  const playerIdArray = Array.from(playerIds);
  
  // Batch fetch players (30 at a time due to Firestore limit)
  for (let i = 0; i < playerIdArray.length; i += 30) {
    const batch = playerIdArray.slice(i, i + 30);
    const playersSnap = await db.collection("players").where("__name__", "in", batch).get();
    playersSnap.docs.forEach(d => {
      playerNames[d.id] = d.data().displayName || d.id;
    });
  }
  
  // Skins calculation parameters
  const handicapPercent = round.skinsHandicapPercent ?? 100;
  const slopeRating = course.slope ?? 113;
  const courseRating = course.rating ?? (course.par ?? 72);
  const coursePar = course.par ?? 72;
  
  // Cache skins strokes per player to avoid recomputing
  const skinsStrokesCache = new Map<string, number[]>();
  
  const getSkinsStrokesForPlayer = (playerId: string, teamKey: "teamA" | "teamB"): number[] => {
    const cacheKey = `${teamKey}:${playerId}`;
    const existing = skinsStrokesCache.get(cacheKey);
    if (existing) return existing;
    
    const teamData = teamKey === "teamA" ? tournament.teamA : tournament.teamB;
    const handicapIndex = teamData?.handicapByPlayer?.[playerId] ?? 0;
    
    const strokes = calculateSkinsStrokes(
      handicapIndex,
      handicapPercent,
      slopeRating,
      courseRating,
      coursePar,
      courseHoles
    );
    
    skinsStrokesCache.set(cacheKey, strokes);
    return strokes;
  };
  
  // Build hole-by-hole skins data
  const holeSkinsData: HoleSkinData[] = [];
  
  for (let holeNum = 1; holeNum <= 18; holeNum++) {
    const holeKey = String(holeNum);
    const holeInfo = courseHoles.find(h => h.number === holeNum);
    const par = holeInfo?.par ?? 4;
    
    // Collect all player scores for this hole across all matches
    const allScores: PlayerHoleScore[] = [];
    
    matches.forEach((match: any) => {
      const holeData = match.holes?.[holeKey];
      if (!holeData) return;
      
      const input = holeData.input || {};
      
      if (format === "singles") {
        // Singles: one player per team
        const teamAPlayer = match.teamAPlayers?.[0];
        const teamBPlayer = match.teamBPlayers?.[0];
        
        if (teamAPlayer) {
          const gross = input.teamAPlayerGross ?? null;
          const skinsStrokes = getSkinsStrokesForPlayer(teamAPlayer.playerId, "teamA");
          const strokesReceived = skinsStrokes[holeNum - 1];
          
          const net = gross !== null ? gross - strokesReceived : null;
          const playerThru = match.status?.thru ?? 0;
          
          allScores.push({
            playerId: teamAPlayer.playerId,
            playerName: playerNames[teamAPlayer.playerId] || teamAPlayer.playerId,
            gross,
            net,
            hasStroke: strokesReceived > 0,
            playerThru,
            playerTeeTime: match.teeTime ?? null,
          });
        }
        
        if (teamBPlayer) {
          const gross = input.teamBPlayerGross ?? null;
          const skinsStrokes = getSkinsStrokesForPlayer(teamBPlayer.playerId, "teamB");
          const strokesReceived = skinsStrokes[holeNum - 1];
          
          const net = gross !== null ? gross - strokesReceived : null;
          const playerThru = match.status?.thru ?? 0;
          
          allScores.push({
            playerId: teamBPlayer.playerId,
            playerName: playerNames[teamBPlayer.playerId] || teamBPlayer.playerId,
            gross,
            net,
            hasStroke: strokesReceived > 0,
            playerThru,
            playerTeeTime: match.teeTime ?? null,
          });
        }
      } else if (format === "twoManBestBall") {
        // Best Ball: two players per team
        [match.teamAPlayers, match.teamBPlayers].forEach((team: any[], teamIdx: number) => {
          const isTeamA = teamIdx === 0;
          team?.forEach((player: any, playerIdx: number) => {
            const grossArray = isTeamA 
              ? input.teamAPlayersGross 
              : input.teamBPlayersGross;
            
            const gross = grossArray?.[playerIdx] ?? null;
            const teamKey: "teamA" | "teamB" = isTeamA ? "teamA" : "teamB";
            const skinsStrokes = getSkinsStrokesForPlayer(player.playerId, teamKey);
            const strokesReceived = skinsStrokes[holeNum - 1];
            
            const net = gross !== null ? gross - strokesReceived : null;
            const playerThru = match.status?.thru ?? 0;
            
            allScores.push({
              playerId: player.playerId,
              playerName: playerNames[player.playerId] || player.playerId,
              gross,
              net,
              hasStroke: strokesReceived > 0,
              playerThru,
              playerTeeTime: match.teeTime ?? null,
            });
          });
        });
      }
    });
    
    // Determine gross winner
    const grossScores = allScores.filter(s => s.gross !== null);
    const grossLowScore = grossScores.length > 0 ? Math.min(...grossScores.map(s => s.gross!)) : null;
    const grossWinners = grossScores.filter(s => s.gross === grossLowScore);
    const grossWinner = grossWinners.length === 1 ? grossWinners[0].playerId : null;
    const grossTiedCount = grossWinners.length;
    
    // Determine net winner
    const netScores = allScores.filter(s => s.net !== null);
    const netLowScore = netScores.length > 0 ? Math.min(...netScores.map(s => s.net!)) : null;
    const netWinners = netScores.filter(s => s.net === netLowScore);
    const netWinner = netWinners.length === 1 ? netWinners[0].playerId : null;
    const netTiedCount = netWinners.length;
    
    // Sort all scores: lowest first, null scores at end
    allScores.sort((a, b) => {
      if (a.gross === null) return 1;
      if (b.gross === null) return -1;
      return a.gross - b.gross;
    });
    
    // Check if all players have completed this hole
    const allPlayersCompleted = allScores.length > 0 && allScores.every(s => s.gross !== null);
    
    holeSkinsData.push({
      holeNumber: holeNum,
      par,
      grossWinner,
      netWinner,
      grossLowScore,
      netLowScore,
      grossTiedCount,
      netTiedCount,
      allScores,
      allPlayersCompleted,
    });
  }
  
  // Compute player totals (leaderboard)
  const totalsMap = new Map<string, PlayerSkinsTotal>();
  
  // Initialize all players
  matches.forEach((match: any) => {
    [...(match.teamAPlayers || []), ...(match.teamBPlayers || [])].forEach((p: any) => {
      if (!totalsMap.has(p.playerId)) {
        totalsMap.set(p.playerId, {
          playerId: p.playerId,
          playerName: playerNames[p.playerId] || p.playerId,
          grossSkinsWon: 0,
          netSkinsWon: 0,
          grossHoles: [],
          netHoles: [],
          grossEarnings: 0,
          netEarnings: 0,
          totalEarnings: 0,
        });
      }
    });
  });
  
  // Count skins won per player
  holeSkinsData.forEach(hole => {
    if (hole.grossWinner) {
      const player = totalsMap.get(hole.grossWinner);
      if (player) {
        player.grossSkinsWon++;
        player.grossHoles.push(hole.holeNumber);
      }
    }
    if (hole.netWinner) {
      const player = totalsMap.get(hole.netWinner);
      if (player) {
        player.netSkinsWon++;
        player.netHoles.push(hole.holeNumber);
      }
    }
  });
  
  // Calculate earnings
  const totalGrossSkins = holeSkinsData.filter(h => h.grossWinner !== null).length;
  const totalNetSkins = holeSkinsData.filter(h => h.netWinner !== null).length;
  const grossValuePerSkin = totalGrossSkins > 0 ? skinsGrossPot / totalGrossSkins : 0;
  const netValuePerSkin = totalNetSkins > 0 ? skinsNetPot / totalNetSkins : 0;
  
  totalsMap.forEach(player => {
    player.grossEarnings = player.grossSkinsWon * grossValuePerSkin;
    player.netEarnings = player.netSkinsWon * netValuePerSkin;
    player.totalEarnings = player.grossEarnings + player.netEarnings;
  });
  
  // Build sorted player totals (highest earnings first, filter to only those with skins)
  const playerTotals = Array.from(totalsMap.values())
    .filter(p => p.grossSkinsWon > 0 || p.netSkinsWon > 0)
    .sort((a, b) => b.totalEarnings - a.totalEarnings);
  
  // Create computation signature from all match holes data
  const computeSig = JSON.stringify(matches.map((m: any) => m.holes || {}));
  
  // Check if we need to write (avoid redundant writes)
  const skinsResultRef = db.collection("rounds").doc(roundId).collection("skinsResults").doc("computed");
  const existingSnap = await skinsResultRef.get();
  
  if (existingSnap.exists && existingSnap.data()?._computeSig === computeSig) {
    // No change, skip write
    return;
  }
  
  // Write pre-computed skins results
  const skinsResultDoc: SkinsResultDoc = {
    holeSkinsData,
    playerTotals,
    skinsGrossPot,
    skinsNetPot,
    lastUpdated: FieldValue.serverTimestamp(),
    _computeSig: computeSig,
  };
  
  await skinsResultRef.set(skinsResultDoc);
});

// ============================================================================
// PLAYER STATS AGGREGATION
// Aggregates PlayerMatchFact documents into PlayerStats by series, tournament, and round
// Collections: 
//   - playerStats/{playerId}/bySeries/{series}
//   - playerStats/{playerId}/byTournament/{tournamentId}
//   - playerStats/{playerId}/byRound/{roundId}
// ============================================================================

/**
 * Helper to build stats object from an array of playerMatchFact documents
 */
function buildStatsFromFacts(facts: FirebaseFirestore.QueryDocumentSnapshot[], idField: string, idValue: string): any {
  // Initialize stats
  let wins = 0, losses = 0, halves = 0, points = 0, matchesPlayed = 0;
  let totalGross = 0, totalNet = 0, holesPlayed = 0;
  let strokesVsParGross = 0, strokesVsParNet = 0;
  let birdies = 0, eagles = 0;
  let holesWon = 0, holesLost = 0, holesHalved = 0;
  let comebackWins = 0, blownLeads = 0, neverBehindWins = 0;
  let jekyllAndHydes = 0, clutchWins = 0;
  let drivesUsed = 0, ballsUsed = 0, ballsUsedSolo = 0, hamAndEggs = 0;
  let captainWins = 0, captainLosses = 0, captainHalves = 0;
  let captainVsCaptainWins = 0, captainVsCaptainLosses = 0, captainVsCaptainHalves = 0;
  
  // Get playerId from first fact (all should have same playerId)
  const playerId = facts.length > 0 ? facts[0].data().playerId : null;
  
  // Format breakdown
  const formatBreakdown: Record<string, { wins: number; losses: number; halves: number; matches: number }> = {
    singles: { wins: 0, losses: 0, halves: 0, matches: 0 },
    twoManBestBall: { wins: 0, losses: 0, halves: 0, matches: 0 },
    twoManShamble: { wins: 0, losses: 0, halves: 0, matches: 0 },
    twoManScramble: { wins: 0, losses: 0, halves: 0, matches: 0 },
  };

  facts.forEach(d => {
    const f = d.data();
    matchesPlayed++;
    points += (f.pointsEarned || 0);
    
    // Win/Loss/Halve
    if (f.outcome === "win") {
      wins++;
      if (f.format && formatBreakdown[f.format]) formatBreakdown[f.format].wins++;
    } else if (f.outcome === "loss") {
      losses++;
      if (f.format && formatBreakdown[f.format]) formatBreakdown[f.format].losses++;
    } else {
      halves++;
      if (f.format && formatBreakdown[f.format]) formatBreakdown[f.format].halves++;
    }
    if (f.format && formatBreakdown[f.format]) formatBreakdown[f.format].matches++;
    
    // Hole results
    holesWon += (f.holesWon || 0);
    holesLost += (f.holesLost || 0);
    holesHalved += (f.holesHalved || 0);
    
    // Scoring stats (only for individual formats)
    if (f.format === "singles" || f.format === "twoManBestBall") {
      if (typeof f.totalGross === "number") totalGross += f.totalGross;
      if (typeof f.totalNet === "number") totalNet += f.totalNet;
      if (typeof f.strokesVsParGross === "number") strokesVsParGross += f.strokesVsParGross;
      if (typeof f.strokesVsParNet === "number") strokesVsParNet += f.strokesVsParNet;
      // Prefer explicit holesPlayed from fact when present; otherwise
      // fall back to counting gross scores in holePerformance or finalThru.
      let factHolesPlayed = 0;
      if (typeof f.holesPlayed === "number") {
        factHolesPlayed = f.holesPlayed;
      } else if (Array.isArray(f.holePerformance)) {
        factHolesPlayed = f.holePerformance.reduce(
          (sum: number, hp: any) => sum + (typeof hp.gross === "number" ? 1 : 0),
          0
        );
      } else {
        factHolesPlayed = f.finalThru || 18;
      }
      holesPlayed += factHolesPlayed;
      
      // Count birdies and eagles from holePerformance
      if (Array.isArray(f.holePerformance)) {
        f.holePerformance.forEach((hp: any) => {
          if (hp.gross != null && hp.par != null) {
            const diff = hp.gross - hp.par;
            if (diff === -1) birdies++;
            else if (diff <= -2) eagles++;
          }
        });
      }
    }
    
    // Badge counters
    if (f.comebackWin === true) comebackWins++;
    if (f.blownLead === true) blownLeads++;
    if (f.wasNeverBehind === true && f.outcome === "win") neverBehindWins++;
    if (f.jekyllAndHyde === true) jekyllAndHydes++;
    
    // Clutch win: match decided on 18th AND player's team won
    if (f.decidedOn18 === true && f.won18thHole === true) clutchWins++;
    
    // Team format stats
    if (typeof f.drivesUsed === "number") drivesUsed += f.drivesUsed;
    if (typeof f.ballsUsed === "number") ballsUsed += f.ballsUsed;
    if (typeof f.ballsUsedSolo === "number") ballsUsedSolo += f.ballsUsedSolo;
    if (typeof f.hamAndEggCount === "number") hamAndEggs += f.hamAndEggCount;
    
    // Captain stats
    if (f.isCaptain === true) {
      if (f.outcome === "win") captainWins++;
      else if (f.outcome === "loss") captainLosses++;
      else captainHalves++;
      
      if (f.captainVsCaptain === true) {
        if (f.outcome === "win") captainVsCaptainWins++;
        else if (f.outcome === "loss") captainVsCaptainLosses++;
        else captainVsCaptainHalves++;
      }
    }
  });

  // Build the stats document
  const statsDoc: any = {
    playerId,
    [idField]: idValue,
    wins,
    losses,
    halves,
    points,
    matchesPlayed,
    formatBreakdown,
    holesWon,
    holesLost,
    holesHalved,
    comebackWins,
    blownLeads,
    neverBehindWins,
    jekyllAndHydes,
    clutchWins,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  
  // Only include scoring stats if we have individual format data
  if (holesPlayed > 0) {
    statsDoc.totalGross = totalGross;
    statsDoc.totalNet = totalNet;
    statsDoc.holesPlayed = holesPlayed;
    statsDoc.strokesVsParGross = strokesVsParGross;
    statsDoc.strokesVsParNet = strokesVsParNet;
    statsDoc.birdies = birdies;
    statsDoc.eagles = eagles;
  }
  
  // Only include team format stats if we have them
  if (drivesUsed > 0) statsDoc.drivesUsed = drivesUsed;
  if (ballsUsed > 0) statsDoc.ballsUsed = ballsUsed;
  if (ballsUsedSolo > 0) statsDoc.ballsUsedSolo = ballsUsedSolo;
  if (hamAndEggs > 0) statsDoc.hamAndEggs = hamAndEggs;
  
  // Only include captain stats if player was ever captain
  if (captainWins > 0 || captainLosses > 0 || captainHalves > 0) {
    statsDoc.captainWins = captainWins;
    statsDoc.captainLosses = captainLosses;
    statsDoc.captainHalves = captainHalves;
  }
  if (captainVsCaptainWins > 0 || captainVsCaptainLosses > 0 || captainVsCaptainHalves > 0) {
    statsDoc.captainVsCaptainWins = captainVsCaptainWins;
    statsDoc.captainVsCaptainLosses = captainVsCaptainLosses;
    statsDoc.captainVsCaptainHalves = captainVsCaptainHalves;
  }

  return statsDoc;
}

export const aggregatePlayerStats = onDocumentWritten("playerMatchFacts/{factId}", async (event) => {
  const data = event.data?.after?.data() || event.data?.before?.data();
  if (!data?.playerId) return;
  
  const playerId = data.playerId;
  const series = data.tournamentSeries;
  const tournamentId = data.tournamentId;
  const roundId = data.roundId;
  
  // If no series, skip aggregation (shouldn't happen but be safe)
  if (!series) {
    console.warn(`playerMatchFact ${event.params.factId} has no tournamentSeries, skipping aggregation`);
    return;
  }

  // Aggregate by series
  const seriesSnap = await db.collection("playerMatchFacts")
    .where("playerId", "==", playerId)
    .where("tournamentSeries", "==", series)
    .get();
  
  const seriesStatsRef = db.collection("playerStats").doc(playerId)
    .collection("bySeries").doc(series);
  
  if (seriesSnap.empty) {
    await seriesStatsRef.delete();
  } else {
    const seriesStats = buildStatsFromFacts(seriesSnap.docs, "series", series);
    await seriesStatsRef.set(seriesStats);
  }

  // Aggregate by tournament
  if (tournamentId) {
    const tournamentSnap = await db.collection("playerMatchFacts")
      .where("playerId", "==", playerId)
      .where("tournamentId", "==", tournamentId)
      .get();
    
    const tournamentStatsRef = db.collection("playerStats").doc(playerId)
      .collection("byTournament").doc(tournamentId);
    
    if (tournamentSnap.empty) {
      await tournamentStatsRef.delete();
    } else {
      const tournamentStats = buildStatsFromFacts(tournamentSnap.docs, "tournamentId", tournamentId);
      await tournamentStatsRef.set(tournamentStats);
    }
  }

  // Aggregate by round
  if (roundId) {
    const roundSnap = await db.collection("playerMatchFacts")
      .where("playerId", "==", playerId)
      .where("roundId", "==", roundId)
      .get();
    
    const roundStatsRef = db.collection("playerStats").doc(playerId)
      .collection("byRound").doc(roundId);
    
    if (roundSnap.empty) {
      await roundStatsRef.delete();
    } else {
      const roundStats = buildStatsFromFacts(roundSnap.docs, "roundId", roundId);
      await roundStatsRef.set(roundStats);
    }
  }
});

// ============================================================================
// ADMIN CALLABLE FUNCTIONS
// These functions are called from the admin UI to create documents
// ============================================================================

// GHIN handicap helpers now live in ./ghin.ts (calculateCourseHandicap, calculateStrokesReceived)

/**
 * Admin-only function to create a match with calculated strokesReceived.
 * 
 * Data payload:
 * - id: string - Match document ID
 * - tournamentId: string
 * - roundId: string
 * - teeTime: Timestamp
 * - teamAPlayers: Array<{ playerId: string, handicapIndex: number }>
 * - teamBPlayers: Array<{ playerId: string, handicapIndex: number }>
 */
export const seedMatch = onCall(async (request) => {
  // Auth check
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  // Rate limiting check
  const rateLimit = checkRateLimit(uid, "seedMatch", { maxCalls: 20, windowSeconds: 60 });
  if (!rateLimit.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      `Rate limit exceeded. Try again in ${Math.ceil((rateLimit.resetAt - Date.now()) / 1000)}s`
    );
  }

  // Verify admin status
  const playerSnap = await db.collection("players").where("authUid", "==", uid).get();
  if (playerSnap.empty || !playerSnap.docs[0].data().isAdmin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }

  // Extract data
  const { id, tournamentId, roundId, teeTime, teamAPlayers, teamBPlayers } = request.data;

  // Validate required fields
  if (!id || !tournamentId || !roundId || !teamAPlayers || !teamBPlayers) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }

  if (!Array.isArray(teamAPlayers) || !Array.isArray(teamBPlayers)) {
    throw new HttpsError("invalid-argument", "teamAPlayers and teamBPlayers must be arrays");
  }

  // Fetch round to get courseId
  const roundDoc = await db.collection("rounds").doc(roundId).get();
  if (!roundDoc.exists) {
    throw new HttpsError("not-found", "Round not found");
  }

  const round = roundDoc.data()!;
  const courseId = round.courseId;
  if (!courseId) {
    throw new HttpsError("failed-precondition", "Round does not have a courseId");
  }

  // Fetch course to get hole data
  const courseDoc = await db.collection("courses").doc(courseId).get();
  if (!courseDoc.exists) {
    throw new HttpsError("not-found", "Course not found");
  }

  const course = courseDoc.data()!;
  const courseHoles = course.holes || [];
  if (courseHoles.length !== 18) {
    throw new HttpsError("failed-precondition", "Course must have 18 holes");
  }

  // Get course parameters for GHIN calculation
  const slopeRating = course.slope ?? 113;
  const courseRating = (typeof course.rating === 'number') ? course.rating : (course.par ?? DEFAULT_COURSE_PAR);
  const coursePar = course.par ?? DEFAULT_COURSE_PAR;

  // Fetch tournament to get handicap indexes (fallback when caller doesn't provide them)
  const tournamentDoc = await db.collection("tournaments").doc(tournamentId).get();
  const teamAHandicaps: Record<string, number> = {};
  const teamBHandicaps: Record<string, number> = {};
  if (tournamentDoc.exists) {
    const t = ensureTournamentTeamColors(tournamentDoc.data()! as any) as any;
    if (t.teamA?.handicapByPlayer) Object.assign(teamAHandicaps, t.teamA.handicapByPlayer);
    if (t.teamB?.handicapByPlayer) Object.assign(teamBHandicaps, t.teamB.handicapByPlayer);
  }

  // Calculate course handicap for each player using GHIN formula. If the caller
  // didn't provide a `handicapIndex`, fall back to the tournament's map.
  const allCourseHandicaps = [
    ...teamAPlayers.map((p: any) => {
      const hi = (p && typeof p.handicapIndex === 'number') ? p.handicapIndex : (teamAHandicaps[p.playerId] ?? teamBHandicaps[p.playerId] ?? 0);
      return calculateCourseHandicap(hi, slopeRating, courseRating, coursePar);
    }),
    ...teamBPlayers.map((p: any) => {
      const hi = (p && typeof p.handicapIndex === 'number') ? p.handicapIndex : (teamAHandicaps[p.playerId] ?? teamBHandicaps[p.playerId] ?? 0);
      return calculateCourseHandicap(hi, slopeRating, courseRating, coursePar);
    }),
  ];

  // "Spin down" from the lowest course handicap
  const lowestHandicap = Math.min(...allCourseHandicaps);

  // Build player arrays with strokes
  const teamAPlayersWithStrokes = teamAPlayers.map((p: any, idx: number) => {
    const courseHandicap = allCourseHandicaps[idx];
    const adjustedHandicap = courseHandicap - lowestHandicap;
    return {
      playerId: p.playerId,
      strokesReceived: calculateStrokesReceived(adjustedHandicap, courseHoles),
    };
  });

  const teamBPlayersWithStrokes = teamBPlayers.map((p: any, idx: number) => {
    const courseHandicap = allCourseHandicaps[teamAPlayers.length + idx];
    const adjustedHandicap = courseHandicap - lowestHandicap;
    return {
      playerId: p.playerId,
      strokesReceived: calculateStrokesReceived(adjustedHandicap, courseHoles),
    };
  });

  // Store calculated course handicaps for reference
  const courseHandicaps = allCourseHandicaps;

  // Create match document
  // teeTime is optional - can be set later in Firestore
  let teeTimeTimestamp: Timestamp | null = null;
  if (teeTime) {
    if (typeof teeTime === 'string') {
      const date = new Date(teeTime);
      if (!isNaN(date.getTime())) teeTimeTimestamp = Timestamp.fromDate(date);
    } else if (typeof teeTime === 'object' && '_seconds' in teeTime) {
      teeTimeTimestamp = Timestamp.fromMillis(teeTime._seconds * 1000 + (teeTime._nanoseconds || 0) / 1000000);
    } else if (teeTime instanceof Timestamp) {
      teeTimeTimestamp = teeTime;
    }
  }
  // Determine matchNumber: if caller provided `matchNumber` use it, otherwise
  // compute the lowest available positive integer for this round.
  let matchNumberToUse: number = request.data?.matchNumber ?? 0;
  if (!matchNumberToUse || typeof matchNumberToUse !== 'number' || matchNumberToUse <= 0) {
    const existingSnaps = await db.collection('matches').where('roundId', '==', roundId).get();
    const nums = existingSnaps.docs.map(d => Number(d.data()?.matchNumber) || 0).filter(n => n > 0);
    // find smallest missing positive integer starting at 1
    let candidate = 1;
    const numSet = new Set(nums);
    while (numSet.has(candidate)) candidate++;
    matchNumberToUse = candidate;
  }

  // Fetch player auth UIDs for security rules optimization
  const allPlayerIds = [...teamAPlayers, ...teamBPlayers].map((p: any) => p.playerId);
  const authorizedUids: string[] = [];
  for (const playerId of allPlayerIds) {
    const pSnap = await db.collection("players").doc(playerId).get();
    if (pSnap.exists) {
      const authUid = pSnap.data()?.authUid;
      if (authUid) authorizedUids.push(authUid);
    }
  }

  const matchDoc: any = {
    id,
    tournamentId,
    roundId,
    matchNumber: matchNumberToUse,
    teeTime: teeTimeTimestamp,
    teamAPlayers: teamAPlayersWithStrokes,
    teamBPlayers: teamBPlayersWithStrokes,
    courseHandicaps,
    authorizedUids,  // Store UIDs directly for efficient security rules
    holes: {},
    status: {
      leader: null,
      margin: 0,
      thru: 0,
      dormie: false,
      closed: false,
    },
    result: {},
  };

  // Write to Firestore
  await db.collection("matches").doc(id).set(matchDoc);

  return { success: true, matchId: id };
});

/**
 * Admin-only function to edit an existing match.
 * 
 * Data payload:
 * - matchId: string - Match document ID
 * - tournamentId: string
 * - roundId: string
 * - teeTime?: string (ISO datetime format)
 * - teamAPlayers: Array<{ playerId: string, handicapIndex: number }>
 * - teamBPlayers: Array<{ playerId: string, handicapIndex: number }>
 */
export const editMatch = onCall(async (request) => {
  // Auth check
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  // Rate limiting check
  const rateLimit = checkRateLimit(uid, "editMatch", { maxCalls: 30, windowSeconds: 60 });
  if (!rateLimit.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      `Rate limit exceeded. Try again in ${Math.ceil((rateLimit.resetAt - Date.now()) / 1000)}s`
    );
  }

  // Verify admin status
  const playerSnap = await db.collection("players").where("authUid", "==", uid).get();
  if (playerSnap.empty || !playerSnap.docs[0].data().isAdmin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }

  // Extract data
  const { matchId, tournamentId, roundId, teeTime, teamAPlayers, teamBPlayers } = request.data;

  // Validate required fields
  if (!matchId || !tournamentId || !roundId || !teamAPlayers || !teamBPlayers) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }

  if (!Array.isArray(teamAPlayers) || !Array.isArray(teamBPlayers)) {
    throw new HttpsError("invalid-argument", "teamAPlayers and teamBPlayers must be arrays");
  }

  // Check if match exists
  const matchDoc = await db.collection("matches").doc(matchId).get();
  if (!matchDoc.exists) {
    throw new HttpsError("not-found", "Match not found");
  }

  // Fetch round to get courseId
  const roundDoc = await db.collection("rounds").doc(roundId).get();
  if (!roundDoc.exists) {
    throw new HttpsError("not-found", "Round not found");
  }

  const round = roundDoc.data()!;
  const courseId = round.courseId;
  if (!courseId) {
    throw new HttpsError("failed-precondition", "Round does not have a courseId");
  }

  // Fetch course to get hole data
  const courseDoc = await db.collection("courses").doc(courseId).get();
  if (!courseDoc.exists) {
    throw new HttpsError("not-found", "Course not found");
  }

  const course = courseDoc.data()!;
  const courseHoles = course.holes || [];
  if (courseHoles.length !== 18) {
    throw new HttpsError("failed-precondition", "Course must have 18 holes");
  }

  // Get course parameters for GHIN calculation
  const slopeRating = course.slope ?? 113;
  const courseRating = (typeof course.rating === 'number') ? course.rating : (course.par ?? DEFAULT_COURSE_PAR);
  const coursePar = course.par ?? DEFAULT_COURSE_PAR;

  // Fetch tournament to get handicap indexes (fallback when caller doesn't provide them)
  const tournamentDocEdit = await db.collection("tournaments").doc(tournamentId).get();
  const teamAHandicapsEdit: Record<string, number> = {};
  const teamBHandicapsEdit: Record<string, number> = {};
  if (tournamentDocEdit.exists) {
    const t = ensureTournamentTeamColors(tournamentDocEdit.data()! as any) as any;
    if (t.teamA?.handicapByPlayer) Object.assign(teamAHandicapsEdit, t.teamA.handicapByPlayer);
    if (t.teamB?.handicapByPlayer) Object.assign(teamBHandicapsEdit, t.teamB.handicapByPlayer);
  }

  // Calculate course handicap for each player using GHIN formula. If the caller
  // didn't provide a `handicapIndex`, fall back to the tournament's map.
  const allCourseHandicaps = [
    ...teamAPlayers.map((p: any) => {
      const hi = (p && typeof p.handicapIndex === 'number') ? p.handicapIndex : (teamAHandicapsEdit[p.playerId] ?? teamBHandicapsEdit[p.playerId] ?? 0);
      return calculateCourseHandicap(hi, slopeRating, courseRating, coursePar);
    }),
    ...teamBPlayers.map((p: any) => {
      const hi = (p && typeof p.handicapIndex === 'number') ? p.handicapIndex : (teamAHandicapsEdit[p.playerId] ?? teamBHandicapsEdit[p.playerId] ?? 0);
      return calculateCourseHandicap(hi, slopeRating, courseRating, coursePar);
    }),
  ];

  // "Spin down" from the lowest course handicap
  const lowestHandicap = Math.min(...allCourseHandicaps);

  // Build player arrays with strokes
  const teamAPlayersWithStrokes = teamAPlayers.map((p: any, idx: number) => {
    const courseHandicap = allCourseHandicaps[idx];
    const adjustedHandicap = courseHandicap - lowestHandicap;
    return {
      playerId: p.playerId,
      strokesReceived: calculateStrokesReceived(adjustedHandicap, courseHoles),
    };
  });

  const teamBPlayersWithStrokes = teamBPlayers.map((p: any, idx: number) => {
    const courseHandicap = allCourseHandicaps[teamAPlayers.length + idx];
    const adjustedHandicap = courseHandicap - lowestHandicap;
    return {
      playerId: p.playerId,
      strokesReceived: calculateStrokesReceived(adjustedHandicap, courseHoles),
    };
  });

  // Store calculated course handicaps for reference
  const courseHandicaps = allCourseHandicaps;

  // Parse teeTime if provided
  let teeTimeTimestamp: Timestamp | null = null;
  if (teeTime) {
    // Handle ISO string format from datetime-local input
    if (typeof teeTime === 'string') {
      const date = new Date(teeTime);
      teeTimeTimestamp = Timestamp.fromDate(date);
    } else if (typeof teeTime === 'object' && '_seconds' in teeTime) {
      teeTimeTimestamp = Timestamp.fromMillis(teeTime._seconds * 1000 + (teeTime._nanoseconds || 0) / 1000000);
    } else if (teeTime instanceof Timestamp) {
      teeTimeTimestamp = teeTime;
    }
  }

  // Update match document
  const updates: any = {
    tournamentId,
    roundId,
    teamAPlayers: teamAPlayersWithStrokes,
    teamBPlayers: teamBPlayersWithStrokes,
    courseHandicaps,
  };

  // Only update teeTime if provided
  if (teeTimeTimestamp) {
    updates.teeTime = teeTimeTimestamp;
  }

  // Write to Firestore
  await db.collection("matches").doc(matchId).update(updates);

  return { success: true, matchId };
});

/**
 * Admin-only function to recalculate strokesReceived for an existing match.
 * Uses current tournament handicap indexes and course data.
 * 
 * Data payload:
 * - matchId: string - Match document ID
 */
export const recalculateMatchStrokes = onCall(async (request) => {
  // Auth check
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  // Rate limiting check
  const rateLimit = checkRateLimit(uid, "recalculateMatchStrokes", { maxCalls: 10, windowSeconds: 60 });
  if (!rateLimit.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      `Rate limit exceeded. Try again in ${Math.ceil((rateLimit.resetAt - Date.now()) / 1000)}s`
    );
  }

  // Verify admin status
  const playerSnap = await db.collection("players").where("authUid", "==", uid).get();
  if (playerSnap.empty || !playerSnap.docs[0].data().isAdmin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }

  // Extract data
  const { matchId } = request.data;

  // Validate required fields
  if (!matchId) {
    throw new HttpsError("invalid-argument", "Missing matchId");
  }

  // Fetch match
  const matchDoc = await db.collection("matches").doc(matchId).get();
  if (!matchDoc.exists) {
    throw new HttpsError("not-found", "Match not found");
  }

  const match = matchDoc.data()!;
  const tournamentId = match.tournamentId;
  const roundId = match.roundId;

  if (!tournamentId || !roundId) {
    throw new HttpsError("failed-precondition", "Match missing tournamentId or roundId");
  }

  // Fetch tournament to get handicap indexes
  const tournamentDoc = await db.collection("tournaments").doc(tournamentId).get();
  if (!tournamentDoc.exists) {
    throw new HttpsError("not-found", "Tournament not found");
  }

  const tournament = tournamentDoc.data()!;
  const teamAHandicaps = tournament.teamA?.handicapByPlayer || {};
  const teamBHandicaps = tournament.teamB?.handicapByPlayer || {};

  // Fetch round to get courseId
  const roundDoc = await db.collection("rounds").doc(roundId).get();
  if (!roundDoc.exists) {
    throw new HttpsError("not-found", "Round not found");
  }

  const round = roundDoc.data()!;
  const courseId = round.courseId;
  if (!courseId) {
    throw new HttpsError("failed-precondition", "Round does not have a courseId");
  }

  // Fetch course to get hole data
  const courseDoc = await db.collection("courses").doc(courseId).get();
  if (!courseDoc.exists) {
    throw new HttpsError("not-found", "Course not found");
  }

  const course = courseDoc.data()!;
  const courseHoles = course.holes || [];
  if (courseHoles.length !== 18) {
    throw new HttpsError("failed-precondition", "Course must have 18 holes");
  }

  // Get course parameters for GHIN calculation
  const slopeRating = course.slope ?? 113;
  const courseRating = (typeof course.rating === 'number') ? course.rating : (course.par ?? DEFAULT_COURSE_PAR);
  const coursePar = course.par ?? DEFAULT_COURSE_PAR;

  // Get player IDs from match
  const teamAPlayers = match.teamAPlayers || [];
  const teamBPlayers = match.teamBPlayers || [];

  // Calculate course handicaps using GHIN formula
  const allCourseHandicaps = [
    ...teamAPlayers.map((p: any) => {
      const handicapIndex = teamAHandicaps[p.playerId] ?? 0;
      return calculateCourseHandicap(handicapIndex, slopeRating, courseRating, coursePar);
    }),
    ...teamBPlayers.map((p: any) => {
      const handicapIndex = teamBHandicaps[p.playerId] ?? 0;
      return calculateCourseHandicap(handicapIndex, slopeRating, courseRating, coursePar);
    }),
  ];

  // "Spin down" from the lowest course handicap
  const lowestHandicap = Math.min(...allCourseHandicaps);

  // Build updated player arrays with strokes
  const teamAPlayersWithStrokes = teamAPlayers.map((p: any, idx: number) => {
    const courseHandicap = allCourseHandicaps[idx];
    const adjustedHandicap = courseHandicap - lowestHandicap;
    return {
      playerId: p.playerId,
      strokesReceived: calculateStrokesReceived(adjustedHandicap, courseHoles),
    };
  });

  const teamBPlayersWithStrokes = teamBPlayers.map((p: any, idx: number) => {
    const courseHandicap = allCourseHandicaps[teamAPlayers.length + idx];
    const adjustedHandicap = courseHandicap - lowestHandicap;
    return {
      playerId: p.playerId,
      strokesReceived: calculateStrokesReceived(adjustedHandicap, courseHoles),
    };
  });

  // Update match document
  await db.collection("matches").doc(matchId).update({
    teamAPlayers: teamAPlayersWithStrokes,
    teamBPlayers: teamBPlayersWithStrokes,
    courseHandicaps: allCourseHandicaps,
  });

  return { success: true, matchId, courseHandicaps: allCourseHandicaps };
});

/**
 * Admin-only function to recalculate ALL playerMatchFacts across ALL tournaments.
 * 
 * IMPORTANT: This function ensures data integrity by:
 * 1. Deleting ALL existing playerMatchFacts (clean slate across ALL tournaments)
 * 2. Letting aggregatePlayerStats automatically delete all playerStats (via triggers)
 * 3. "Touching" EVERY closed match across ALL tournaments to trigger regeneration
 * 4. aggregatePlayerStats automatically rebuilds all stats from fresh facts
 * 
 * This is a "nuclear" recalculation that resets everything.
 * Safe for small tournaments (<1000 matches) and well within Firebase free tier.
 * 
 * Data payload:
 * - dryRun?: boolean - If true, only report what would be done (no changes)
 */
export const recalculateAllStats = onCall(async (request) => {
  // Auth check
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  // Rate limiting check (very restrictive - this is expensive)
  const rateLimit = checkRateLimit(uid, "recalculateAllStats", { maxCalls: 2, windowSeconds: 600 });
  if (!rateLimit.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      `Rate limit exceeded. Try again in ${Math.ceil((rateLimit.resetAt - Date.now()) / 1000)}s`
    );
  }

  // Verify admin status
  const playerSnap = await db.collection("players").where("authUid", "==", uid).get();
  if (playerSnap.empty || !playerSnap.docs[0].data().isAdmin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }

  // Extract data
  const { dryRun = false } = request.data;

  // Step 1: Find ALL existing playerMatchFacts across ALL tournaments
  const existingFactsSnap = await db.collection("playerMatchFacts").get();
  
  const factsToDelete = existingFactsSnap.docs.length;
  const affectedPlayerIds = new Set<string>();
  const tournamentsAffected = new Set<string>();
  
  existingFactsSnap.docs.forEach(d => {
    const data = d.data();
    if (data.playerId) affectedPlayerIds.add(data.playerId);
    if (data.tournamentId) tournamentsAffected.add(data.tournamentId);
  });

  // Step 2: Find ALL closed matches across ALL tournaments
  const matchesSnap = await db.collection("matches").get();
  
  const closedMatches = matchesSnap.docs.filter(d => d.data().status?.closed === true);
  const matchesToRecalculate = closedMatches.length;

  // Also collect player IDs from matches (in case facts were never created)
  closedMatches.forEach(d => {
    const data = d.data();
    if (data.tournamentId) tournamentsAffected.add(data.tournamentId);
    (data.teamAPlayers || []).forEach((p: any) => {
      if (p.playerId) affectedPlayerIds.add(p.playerId);
    });
    (data.teamBPlayers || []).forEach((p: any) => {
      if (p.playerId) affectedPlayerIds.add(p.playerId);
    });
  });

  // If dry run, just report what would happen
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      factsToDelete,
      affectedPlayers: affectedPlayerIds.size,
      tournamentsAffected: tournamentsAffected.size,
      matchesToRecalculate,
      message: `Would delete ${factsToDelete} facts across ${tournamentsAffected.size} tournaments, affecting ${affectedPlayerIds.size} players, and regenerate facts for ${matchesToRecalculate} matches. playerStats will be automatically cleaned up and rebuilt by triggers.`
    };
  }

  // Step 3: Delete ALL existing playerMatchFacts
  // Use batched deletes (max 500 per batch)
  // This triggers aggregatePlayerStats to delete all playerStats automatically
  const factDocs = existingFactsSnap.docs;
  for (let i = 0; i < factDocs.length; i += 500) {
    const batch = db.batch();
    const chunk = factDocs.slice(i, i + 500);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // Step 4: "Touch" EVERY closed match to trigger updateMatchFacts
  // We update a _recalculatedAt timestamp field to trigger the onDocumentWritten
  const touchTimestamp = FieldValue.serverTimestamp();
  const touchedMatchIds: string[] = [];
  
  for (let i = 0; i < closedMatches.length; i += 500) {
    const batch = db.batch();
    const chunk = closedMatches.slice(i, i + 500);
    chunk.forEach(d => {
      batch.update(d.ref, { _recalculatedAt: touchTimestamp });
      touchedMatchIds.push(d.id);
    });
    await batch.commit();
  }

  return {
    success: true,
    dryRun: false,
    factsDeleted: factsToDelete,
    statsAutoCleanedUp: affectedPlayerIds.size,
    tournamentsRecalculated: tournamentsAffected.size,
    matchesRecalculated: touchedMatchIds.length,
    message: `Deleted ${factsToDelete} facts across ${tournamentsAffected.size} tournaments. Triggered regeneration for ${touchedMatchIds.length} matches. playerStats for ${affectedPlayerIds.size} players will be automatically rebuilt by triggers.`
  };
});

// ============================================================================
// COMPUTE ROUND RECAP
// Manually-triggered function to precompute round statistics including "vs All"
// ============================================================================

export const computeRoundRecap = onCall(async (request) => {
  // Auth check
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  // Rate limiting (2 calls per 10 minutes)
  const rateLimit = checkRateLimit(uid, "computeRoundRecap", { maxCalls: 2, windowSeconds: 600 });
  if (!rateLimit.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      `Rate limit exceeded. Try again in ${Math.ceil((rateLimit.resetAt - Date.now()) / 1000)}s`
    );
  }

  // Verify admin status
  const playerSnap = await db.collection("players").where("authUid", "==", uid).get();
  if (playerSnap.empty || !playerSnap.docs[0].data().isAdmin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }

  // Extract data
  const { roundId } = request.data;
  if (!roundId) {
    throw new HttpsError("invalid-argument", "roundId is required");
  }

  // Check if recap already exists - FAIL if it does
  const existingRecapSnap = await db.collection("roundRecaps").doc(roundId).get();
  if (existingRecapSnap.exists) {
    throw new HttpsError(
      "already-exists",
      "Round recap already exists. Delete it manually before regenerating."
    );
  }

  // Fetch round metadata
  const roundSnap = await db.collection("rounds").doc(roundId).get();
  if (!roundSnap.exists) {
    throw new HttpsError("not-found", "Round not found");
  }
  const round = roundSnap.data()!;
  
  if (!round.format) {
    throw new HttpsError("failed-precondition", "Round format must be set before generating recap");
  }
  if (!round.courseId) {
    throw new HttpsError("failed-precondition", "Round must have a course assigned");
  }

  // Fetch course data
  const courseSnap = await db.collection("courses").doc(round.courseId).get();
  if (!courseSnap.exists) {
    throw new HttpsError("not-found", "Course not found");
  }
  const course = courseSnap.data()!;
  const courseHoles = course.holes || [];
  const coursePar = course.par || 72;
  const slopeRating = course.slope || 113;
  const courseRating = course.rating || coursePar;

  // Fetch all playerMatchFacts for this round
  const factsSnap = await db.collection("playerMatchFacts")
    .where("roundId", "==", roundId)
    .get();

  if (factsSnap.empty) {
    throw new HttpsError(
      "failed-precondition",
      "No player match facts found for this round. Ensure all matches are closed."
    );
  }

  const allFacts = factsSnap.docs.map(d => d.data());

  // Fetch player names
  const playerIds = [...new Set(allFacts.map(f => f.playerId))];
  const playerNames: Record<string, string> = {};
  
  for (let i = 0; i < playerIds.length; i += 30) {
    const batch = playerIds.slice(i, i + 30);
    const playersSnap = await db.collection("players")
      .where("__name__", "in", batch)
      .get();
    playersSnap.docs.forEach(d => {
      playerNames[d.id] = d.data().displayName || d.id;
    });
  }

  // Transform facts into simulation format
  const playerFactsForSim: PlayerFactForSim[] = allFacts.map(f => ({
    playerId: f.playerId,
    playerName: playerNames[f.playerId] || f.playerId,
    playerHandicap: f.playerHandicap || 0,
    team: f.team,
    partnerIds: f.partnerIds,
    holePerformance: f.holePerformance || [],
  }));

  // Compute "vs All" records
  const vsAllRecords = computeVsAllForRound(
    playerFactsForSim,
    courseHoles,
    round.format,
    slopeRating,
    courseRating,
    coursePar
  );

  // Compute hole-by-hole averages
  const holeAverages: any[] = [];
  for (let holeNum = 1; holeNum <= 18; holeNum++) {
    const holeData = courseHoles.find((h: any) => h.number === holeNum);
    const holePar = holeData?.par || 4;

    const grossScores: number[] = [];
    const netScores: number[] = [];

    for (const fact of allFacts) {
      const perf = fact.holePerformance?.find((p: any) => p.hole === holeNum);
      if (perf && perf.gross != null) {
        grossScores.push(perf.gross);
        if (perf.net != null) {
          netScores.push(perf.net);
        }
      }
    }

    const avgGross = grossScores.length > 0
      ? grossScores.reduce((a, b) => a + b, 0) / grossScores.length
      : null;
    const avgNet = netScores.length > 0
      ? netScores.reduce((a, b) => a + b, 0) / netScores.length
      : null;

    holeAverages.push({
      holeNumber: holeNum,
      par: holePar,
      avgGross: avgGross ? Math.round(avgGross * 100) / 100 : null,
      avgNet: avgNet ? Math.round(avgNet * 100) / 100 : null,
      lowestGross: grossScores.length > 0 ? Math.min(...grossScores) : null,
      lowestNet: netScores.length > 0 ? Math.min(...netScores) : null,
      highestGross: grossScores.length > 0 ? Math.max(...grossScores) : null,
      highestNet: netScores.length > 0 ? Math.max(...netScores) : null,
      scoringCount: grossScores.length,
    });
  }

  // Compute birdie/eagle leaders
  // For team formats (scramble/shamble), group by team
  // For bestBall, keep individual tracking
  const isTeamBirdieFormat = round.format === "twoManScramble" || round.format === "twoManShamble" || round.format === "fourManScramble";
  
  const birdieGrossMap = new Map<string, { count: number; holes: number[]; playerNames?: string[] }>();
  const birdieNetMap = new Map<string, { count: number; holes: number[]; playerNames?: string[] }>();
  const eagleGrossMap = new Map<string, { count: number; holes: number[]; playerNames?: string[] }>();
  const eagleNetMap = new Map<string, { count: number; holes: number[]; playerNames?: string[] }>();

  if (isTeamBirdieFormat) {
    // For scramble/shamble: group by team and count birdies/eagles per team
    const teamBirdies = new Map<string, { count: number; holes: number[]; playerNames: string[] }>();
    const teamEagles = new Map<string, { count: number; holes: number[]; playerNames: string[] }>();
    
    for (const fact of allFacts) {
      // Create team key
      const allPlayerIds = [fact.playerId, ...(fact.partnerIds || [])];
      allPlayerIds.sort();
      const teamKey = allPlayerIds.join("_");
      
      if (!teamBirdies.has(teamKey)) {
        const teamPlayerNames = allPlayerIds.map(id => playerNames[id] || id);
        teamBirdies.set(teamKey, { count: 0, holes: [], playerNames: teamPlayerNames });
        teamEagles.set(teamKey, { count: 0, holes: [], playerNames: teamPlayerNames });
      }
      
      // Only count once per team (first member processes the team performance)
      const teamData = teamBirdies.get(teamKey)!;
      if (teamData.count === 0 || teamData.holes.length === 0) {
        // Process hole performance for this team (only once)
        for (const perf of fact.holePerformance || []) {
          if (perf.gross != null && perf.par != null) {
            const grossVsPar = perf.gross - perf.par;
            
            if (grossVsPar === -1 && !teamBirdies.get(teamKey)!.holes.includes(perf.hole)) {
              teamBirdies.get(teamKey)!.count++;
              teamBirdies.get(teamKey)!.holes.push(perf.hole);
            } else if (grossVsPar <= -2 && !teamEagles.get(teamKey)!.holes.includes(perf.hole)) {
              teamEagles.get(teamKey)!.count++;
              teamEagles.get(teamKey)!.holes.push(perf.hole);
            }
          }
        }
      }
    }
    
    // Convert team maps to individual player entries (using teamKey as playerId)
    for (const [teamKey, data] of teamBirdies.entries()) {
      birdieGrossMap.set(teamKey, { count: data.count, holes: data.holes, playerNames: data.playerNames });
    }
    for (const [teamKey, data] of teamEagles.entries()) {
      eagleGrossMap.set(teamKey, { count: data.count, holes: data.holes, playerNames: data.playerNames });
    }
    // No net tracking for scramble/shamble (gross only)
  } else {
    // Individual tracking for singles and bestBall
    for (const fact of allFacts) {
      const playerId = fact.playerId;
      const playerName = playerNames[playerId] || playerId;

      if (!birdieGrossMap.has(playerId)) {
        birdieGrossMap.set(playerId, { count: 0, holes: [] });
        birdieNetMap.set(playerId, { count: 0, holes: [] });
        eagleGrossMap.set(playerId, { count: 0, holes: [] });
        eagleNetMap.set(playerId, { count: 0, holes: [] });
      }

      for (const perf of fact.holePerformance || []) {
        if (perf.gross != null && perf.par != null) {
          const grossVsPar = perf.gross - perf.par;
          
          if (grossVsPar === -1) {
            birdieGrossMap.get(playerId)!.count++;
            birdieGrossMap.get(playerId)!.holes.push(perf.hole);
          } else if (grossVsPar <= -2) {
            eagleGrossMap.get(playerId)!.count++;
            eagleGrossMap.get(playerId)!.holes.push(perf.hole);
          }

          if (perf.net != null) {
            const netVsPar = perf.net - perf.par;
            
            if (netVsPar === -1) {
              birdieNetMap.get(playerId)!.count++;
              birdieNetMap.get(playerId)!.holes.push(perf.hole);
            } else if (netVsPar <= -2) {
              eagleNetMap.get(playerId)!.count++;
              eagleNetMap.get(playerId)!.holes.push(perf.hole);
            }
          }
        }
      }
    }
  }

  const toLeaderArray = (map: Map<string, { count: number; holes: number[]; playerNames?: string[] }>) => {
    return Array.from(map.entries())
      .filter(([_, data]) => data.count > 0)
      .map(([playerId, data]) => ({
        playerId,
        playerName: data.playerNames ? data.playerNames.join(" / ") : (playerNames[playerId] || playerId),
        count: data.count,
        holes: data.holes,
      }))
      .sort((a, b) => b.count - a.count);
  };

  const birdiesGross = toLeaderArray(birdieGrossMap);
  const birdiesNet = toLeaderArray(birdieNetMap);
  const eaglesGross = toLeaderArray(eagleGrossMap);
  const eaglesNet = toLeaderArray(eagleNetMap);

  // Best/worst holes (by average strokes vs par)
  const holesWithScores = holeAverages.filter(h => h.avgGross != null);
  let bestHole = null;
  let worstHole = null;

  if (holesWithScores.length > 0) {
    const sorted = holesWithScores
      .map(h => ({
        holeNumber: h.holeNumber,
        avgVsPar: h.avgGross! - h.par,
      }))
      .sort((a, b) => a.avgVsPar - b.avgVsPar);

    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    if (best.avgVsPar < 0) {
      bestHole = {
        holeNumber: best.holeNumber,
        avgStrokesUnderPar: Math.abs(Math.round(best.avgVsPar * 100) / 100),
      };
    }

    if (worst.avgVsPar > 0) {
      worstHole = {
        holeNumber: worst.holeNumber,
        avgStrokesOverPar: Math.round(worst.avgVsPar * 100) / 100,
      };
    }
  }

  // Build recap document
  const recapDoc = {
    roundId,
    tournamentId: round.tournamentId,
    format: round.format,
    day: round.day,
    courseId: round.courseId,
    courseName: course.name || "Unknown Course",
    coursePar,
    vsAllRecords,
    holeAverages,
    leaders: {
      birdiesGross,
      birdiesNet,
      eaglesGross,
      eaglesNet,
      bestHole,
      worstHole,
    },
    computedAt: FieldValue.serverTimestamp(),
    computedBy: uid,
  };

  // Write to roundRecaps collection
  await db.collection("roundRecaps").doc(roundId).set(recapDoc);

  return {
    success: true,
    roundId,
    stats: {
      playersAnalyzed: playerIds.length,
      vsAllMatchupsSimulated: vsAllRecords.length > 0 
        ? vsAllRecords[0].wins + vsAllRecords[0].losses + vsAllRecords[0].ties
        : 0,
      birdiesGrossLeader: birdiesGross[0]?.playerName || "None",
      birdiesGrossCount: birdiesGross[0]?.count || 0,
      eaglesGrossLeader: eaglesGross[0]?.playerName || "None",
      eaglesGrossCount: eaglesGross[0]?.count || 0,
    },
    message: "Round recap generated successfully",
  };
});

