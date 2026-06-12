/**
 * Admin-only stats callables: the "nuclear" all-stats recalculation and the
 * round recap generator. Moved from index.ts; the deployed function names are
 * unchanged (index.ts re-exports these under the same export names).
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "../helpers/adminAuth.js";
import { computeVsAllForRound, type PlayerFactForSim } from "../helpers/vsAllSimulation.js";

function db() {
  return getFirestore();
}

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
  // Very restrictive rate limit - this is expensive
  await requireAdmin(request, "recalculateAllStats", { maxCalls: 2, windowSeconds: 600 });

  // Extract data
  const { dryRun = false } = request.data;

  // Step 1: Find ALL existing playerMatchFacts across ALL tournaments
  const existingFactsSnap = await db().collection("playerMatchFacts").get();

  const factsToDelete = existingFactsSnap.docs.length;
  const affectedPlayerIds = new Set<string>();
  const tournamentsAffected = new Set<string>();

  existingFactsSnap.docs.forEach(d => {
    const data = d.data();
    if (data.playerId) affectedPlayerIds.add(data.playerId);
    if (data.tournamentId) tournamentsAffected.add(data.tournamentId);
  });

  // Step 2: Find ALL closed matches across ALL tournaments
  const matchesSnap = await db().collection("matches").get();

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
    const batch = db().batch();
    const chunk = factDocs.slice(i, i + 500);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // Step 4: "Touch" EVERY closed match to trigger updateMatchFacts
  // We update a _recalculatedAt timestamp field to trigger the onDocumentWritten
  const touchTimestamp = FieldValue.serverTimestamp();
  const touchedMatchIds: string[] = [];

  for (let i = 0; i < closedMatches.length; i += 500) {
    const batch = db().batch();
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
  try {
    const { uid } = await requireAdmin(request, "computeRoundRecap", { maxCalls: 2, windowSeconds: 30 });

    // Extract data
    const { roundId } = request.data;
    if (!roundId) {
      throw new HttpsError("invalid-argument", "roundId is required");
    }

  // Check if recap already exists - FAIL if it does
  const existingRecapSnap = await db().collection("roundRecaps").doc(roundId).get();
  if (existingRecapSnap.exists) {
    throw new HttpsError(
      "already-exists",
      "Round recap already exists. Delete it manually before regenerating."
    );
  }

  // Fetch round metadata
  const roundSnap = await db().collection("rounds").doc(roundId).get();
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
  const courseSnap = await db().collection("courses").doc(round.courseId).get();
  if (!courseSnap.exists) {
    throw new HttpsError("not-found", "Course not found");
  }
  const course = courseSnap.data()!;
  const courseHoles = course.holes || [];
  // Build authoritative per-hole par array (1-indexed)
  const holePars = Array.from({ length: 18 }, (_, i) => {
    const h = courseHoles.find((hh: any) => hh.number === i + 1);
    return h?.par ?? 4;
  });
  const coursePar = holePars.reduce((a, b) => a + b, 0);
  const slopeRating = course.slope || 113;
  const courseRating = course.rating || coursePar;

  // Fetch all playerMatchFacts for this round
  const factsSnap = await db().collection("playerMatchFacts")
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

  for (let i = 0; i < playerIds.length; i += 10) {
    const batch = playerIds.slice(i, i + 10);
    const playersSnap = await db().collection("players")
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

  // Compute scoring leaders (gross/net to par)
  const scoringGross: any[] = [];
  const scoringNet: any[] = [];
  const scoringTeamGross: any[] = [];
  const scoringTeamNet: any[] = [];

  // For singles and bestBall: individual gross and net
  // For bestBall: also team net
  // For shamble and scramble: team gross only
  const isSingles = round.format === "singles";
  const isBestBall = round.format === "twoManBestBall";
  const isShamble = round.format === "twoManShamble";
  const isScramble = round.format === "twoManScramble" || round.format === "fourManScramble";

  if (isSingles || isBestBall) {
    // Individual scoring leaders
    const playerScores = new Map<string, { gross: number; net: number; holesPlayed: number; totalGross?: number; totalNet?: number }>();
    for (const fact of allFacts) {
      if (fact.totalGross != null && fact.holesPlayed && fact.holePerformance) {
        // Calculate actual par for holes played using authoritative holePars
        let actualPar = 0;
        for (const perf of fact.holePerformance) {
          if (perf.hole != null && perf.gross != null) {
            const idx = typeof perf.hole === "number" ? perf.hole - 1 : null;
            if (idx !== null && idx >= 0 && idx < holePars.length) {
              actualPar += holePars[idx];
            }
          }
        }
        // Calculate strokes vs par for holes actually played
        const grossVsPar = fact.totalGross - actualPar;
        const netVsPar = (fact.totalNet != null) ? fact.totalNet - actualPar : 0;
        playerScores.set(fact.playerId, {
          gross: grossVsPar,
          net: netVsPar,
          holesPlayed: fact.holesPlayed,
          totalGross: fact.totalGross,
          totalNet: fact.totalNet,
        });
      }
    }

    // Individual gross leaders
    for (const [playerId, scores] of playerScores.entries()) {
      const per18 = (scores.gross * 18) / scores.holesPlayed;
      scoringGross.push({
        playerId,
        playerName: playerNames[playerId] || playerId,
        strokesVsPar: scores.gross,
        holesCompleted: scores.holesPlayed,
        strokesVsParPer18: Math.round(per18 * 100) / 100,
        totalGross: typeof scores.totalGross === 'number' ? scores.totalGross : undefined,
      });
    }
    scoringGross.sort((a, b) => a.strokesVsParPer18 - b.strokesVsParPer18);

    // Individual net leaders
    for (const [playerId, scores] of playerScores.entries()) {
      const per18 = (scores.net * 18) / scores.holesPlayed;
      scoringNet.push({
        playerId,
        playerName: playerNames[playerId] || playerId,
        strokesVsPar: scores.net,
        holesCompleted: scores.holesPlayed,
        strokesVsParPer18: Math.round(per18 * 100) / 100,
        totalNet: typeof scores.totalNet === 'number' ? scores.totalNet : undefined,
      });
    }
    scoringNet.sort((a, b) => a.strokesVsParPer18 - b.strokesVsParPer18);
  }

  if (isBestBall) {
    // Team net leaders for bestBall
    // Group by team (partner pairs)
    const teamNetScores = new Map<string, { net: number; holesPlayed: number; playerNames: string[]; totalNet?: number }>();

    for (const fact of allFacts) {
      // Create team key from sorted player IDs
      const allPlayerIds = [fact.playerId, ...(fact.partnerIds || [])];
      allPlayerIds.sort();
      const teamKey = allPlayerIds.join("_");

      if (!teamNetScores.has(teamKey)) {
        const teamPlayerNames = allPlayerIds.map(id => playerNames[id] || id);

        // Compute team net by summing hole-by-hole best net scores
        let teamNetTotal = 0;
        let teamTotalNetAbsolute = 0;
        let holesWithScores = 0;

        // Get all facts for this team
        const teamFacts = allFacts.filter(f => {
          const fPlayerIds = [f.playerId, ...(f.partnerIds || [])];
          fPlayerIds.sort();
          return fPlayerIds.join("_") === teamKey;
        });

        // For each hole, compute team best-net using each player's full course handicap (no spin-down)
        // Build hole handicap index array (1..18) from course definition
        const holeHcpIndexes: number[] = Array.from({ length: 18 }, (_, idx) => {
          const ch = course.holes?.find((hh: any) => hh.number === idx + 1);
          return ch?.hcpIndex ?? 0;
        });

        const computeStrokesReceivedFromCourseHcp = (courseHcp: number) => {
          const rounded = Math.round(courseHcp);
          const capped = Math.min(Math.max(rounded, 0), 18);
          // Return 0/1 per hole where holeHcpIndex <= capped (only one stroke max per hole)
          return holeHcpIndexes.map(hIdx => (hIdx > 0 && hIdx <= capped) ? 1 : 0);
        };

        for (let holeNum = 1; holeNum <= 18; holeNum++) {
          const holeNetsRel: number[] = [];
          const holeNetsAbs: number[] = [];

          for (const tf of teamFacts) {
            const perf = tf.holePerformance?.find((p: any) => p.hole === holeNum);
            if (perf && perf.gross != null && perf.par != null) {
              // Compute strokes received for this player based on their course handicap (rounded, capped at 18)
              const playerCourseHcp = typeof tf.playerHandicap === 'number' ? tf.playerHandicap : 0;
              const strokesArr = computeStrokesReceivedFromCourseHcp(playerCourseHcp);
              const stroke = strokesArr[holeNum - 1] || 0;
              const net = perf.gross - stroke;
              holeNetsRel.push(net - perf.par);
              holeNetsAbs.push(net);
            }
          }

          if (holeNetsRel.length > 0) {
            teamNetTotal += Math.min(...holeNetsRel);
            teamTotalNetAbsolute += Math.min(...holeNetsAbs);
            holesWithScores++;
          }
        }

        if (holesWithScores > 0) {
          teamNetScores.set(teamKey, {
            net: teamNetTotal,
            holesPlayed: holesWithScores,
            playerNames: teamPlayerNames,
            totalNet: teamTotalNetAbsolute,
          });
        }
      }
    }

    // Build team net leaders
    for (const [teamKey, scores] of teamNetScores.entries()) {
      const per18 = (scores.net * 18) / scores.holesPlayed;
      scoringTeamNet.push({
        playerId: teamKey,
        playerName: scores.playerNames.join(" / "),
        strokesVsPar: scores.net,
        holesCompleted: scores.holesPlayed,
        strokesVsParPer18: Math.round(per18 * 100) / 100,
        totalNet: typeof scores.totalNet === 'number' ? scores.totalNet : undefined,
        teamKey,
      });
    }
    scoringTeamNet.sort((a, b) => a.strokesVsParPer18 - b.strokesVsParPer18);
  }

  if (isShamble || isScramble) {
    // Team gross leaders for shamble/scramble
    const teamGrossScores = new Map<string, { gross: number; holesPlayed: number; playerNames: string[]; totalGross?: number }>();

    for (const fact of allFacts) {
      const allPlayerIds = [fact.playerId, ...(fact.partnerIds || [])];
      allPlayerIds.sort();
      const teamKey = allPlayerIds.join("_");

      if (!teamGrossScores.has(teamKey) && fact.teamTotalGross != null && fact.holesPlayed && fact.holePerformance) {
        const teamPlayerNames = allPlayerIds.map(id => playerNames[id] || id);

        // Calculate actual par for holes played
        let actualPar = 0;
        for (const perf of fact.holePerformance) {
          if (perf.par != null) {
            actualPar += perf.par;
          }
        }

        // Calculate team gross vs par for holes actually played
        const teamGrossVsPar = fact.teamTotalGross - actualPar;

        teamGrossScores.set(teamKey, {
          gross: teamGrossVsPar,
          holesPlayed: fact.holesPlayed,
          playerNames: teamPlayerNames,
          totalGross: fact.teamTotalGross,
        });
      }
    }

    // Build team gross leaders
    for (const [teamKey, scores] of teamGrossScores.entries()) {
      const per18 = (scores.gross * 18) / scores.holesPlayed;
      scoringTeamGross.push({
        playerId: teamKey,
        playerName: scores.playerNames.join(" / "),
        strokesVsPar: scores.gross,
        holesCompleted: scores.holesPlayed,
        strokesVsParPer18: Math.round(per18 * 100) / 100,
        totalGross: typeof (scores as any).totalGross === 'number' ? (scores as any).totalGross : undefined,
        teamKey,
      });
    }
    scoringTeamGross.sort((a, b) => a.strokesVsParPer18 - b.strokesVsParPer18);
  }

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

  // Build recap document - only include defined fields to avoid Firestore undefined errors
  const leaders: any = {
    birdiesGross,
    birdiesNet,
    eaglesGross,
    eaglesNet,
    bestHole,
    worstHole,
  };

  // Only add scoring fields if they have data
  if (scoringGross.length > 0) leaders.scoringGross = scoringGross;
  if (scoringNet.length > 0) leaders.scoringNet = scoringNet;
  if (scoringTeamGross.length > 0) leaders.scoringTeamGross = scoringTeamGross;
  if (scoringTeamNet.length > 0) leaders.scoringTeamNet = scoringTeamNet;

  const recapDoc = {
    roundId,
    tournamentId: round.tournamentId,
    format: round.format,
    day: round.day,
    courseId: round.courseId,
    courseName: course.name || "Unknown Course",
    coursePar,
    holePars, // authoritative per-hole par array
    vsAllRecords,
    holeAverages,
    leaders,
    computedAt: FieldValue.serverTimestamp(),
    computedBy: uid,
  };

  // Write to roundRecaps collection
  await db().collection("roundRecaps").doc(roundId).set(recapDoc);

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
  } catch (error: any) {
    console.error("computeRoundRecap error:", error);
    console.error("Error stack:", error.stack);

    // If it's already an HttpsError, rethrow it
    if (error.code && error.message) {
      throw error;
    }

    // Otherwise, wrap in an internal error with details
    throw new HttpsError(
      "internal",
      `Internal error: ${error.message || "Unknown error"}`,
      { originalError: error.toString(), stack: error.stack }
    );
  }
});
