/**
 * "vs All" simulation for Round Recap
 * Simulates head-to-head matches between all players/teams in a round
 */

import type { RoundFormat } from "../types.js";
import { calculateCourseHandicap, calculateStrokesReceived } from "../ghin.js";
import { isSinglesFormat, isBestBallFormat, isShambleFormat, isScrambleFormat } from "../types.js";

// Minimal subset of PlayerMatchFact needed for simulation
export interface PlayerFactForSim {
  playerId: string;
  playerName: string;
  playerHandicap: number; // handicap index
  team: "teamA" | "teamB";
  partnerIds?: string[];
  holePerformance: {
    hole: number;
    gross: number | null;
    net?: number | null;
    par: number;
    strokes?: 0 | 1; // Original strokes from the actual match
  }[];
}

export interface CourseHoleInfo {
  number: number;
  par: number;
  hcpIndex: number;
}

export interface VsAllRecord {
  playerId: string;
  playerName: string;
  wins: number;
  losses: number;
  ties: number;
  teamKey?: string; // For team formats: "player1Id_player2Id"
}

/**
 * Simulate a head-to-head match between two players/teams
 * Computes new strokesReceived arrays based on spin-down, then compares hole-by-hole
 */
export function simulateHeadToHead(
  playerA: PlayerFactForSim,
  playerB: PlayerFactForSim,
  courseHoles: CourseHoleInfo[],
  format: RoundFormat,
  slopeRating: number,
  courseRating: number,
  coursePar: number
): { winner: "A" | "B" | "tie"; holesWonA: number; holesWonB: number } {
  let holesWonA = 0;
  let holesWonB = 0;
  let margin = 0; // positive = A leading, negative = B leading

  // For singles and bestBall, compute new strokesReceived based on spin-down
  let strokesA: number[] = [];
  let strokesB: number[] = [];

  if (isSinglesFormat(format) || isBestBallFormat(format)) {
    const courseHandicapA = calculateCourseHandicap(
      playerA.playerHandicap,
      slopeRating,
      courseRating,
      coursePar
    );
    const courseHandicapB = calculateCourseHandicap(
      playerB.playerHandicap,
      slopeRating,
      courseRating,
      coursePar
    );

    // Spin down to lowest handicap
    const lowestHandicap = Math.min(courseHandicapA, courseHandicapB);
    const adjustedHandicapA = courseHandicapA - lowestHandicap;
    const adjustedHandicapB = courseHandicapB - lowestHandicap;

    strokesA = calculateStrokesReceived(adjustedHandicapA, courseHoles);
    strokesB = calculateStrokesReceived(adjustedHandicapB, courseHoles);
  }

  // Compare hole-by-hole (1-18)
  for (let holeNum = 1; holeNum <= 18; holeNum++) {
    const perfA = playerA.holePerformance.find((p) => p.hole === holeNum);
    const perfB = playerB.holePerformance.find((p) => p.hole === holeNum);

    if (!perfA || !perfB || perfA.gross == null || perfB.gross == null) {
      continue; // Skip if either player has no score
    }

    let scoreA: number;
    let scoreB: number;

    if (isSinglesFormat(format)) {
      // Singles: use net scores with new strokesReceived
      const strokeA = strokesA[holeNum - 1] || 0;
      const strokeB = strokesB[holeNum - 1] || 0;
      scoreA = perfA.gross - strokeA;
      scoreB = perfB.gross - strokeB;
    } else if (isBestBallFormat(format)) {
      // Best ball: use net scores with new strokesReceived
      const strokeA = strokesA[holeNum - 1] || 0;
      const strokeB = strokesB[holeNum - 1] || 0;
      scoreA = perfA.gross - strokeA;
      scoreB = perfB.gross - strokeB;
    } else if (isShambleFormat(format) || isScrambleFormat(format)) {
      // Shamble/Scramble: use GROSS scores (no handicap)
      scoreA = perfA.gross;
      scoreB = perfB.gross;
    } else {
      // Fallback: gross
      scoreA = perfA.gross;
      scoreB = perfB.gross;
    }

    // Determine hole winner
    if (scoreA < scoreB) {
      holesWonA++;
      margin++;
    } else if (scoreB < scoreA) {
      holesWonB++;
      margin--;
    }
    // Tie: no change to holesWon or margin

    // Check if match is closed (mathematically decided)
    const holesRemaining = 18 - holeNum;
    if (Math.abs(margin) > holesRemaining) {
      // Match is decided, stop processing further holes
      break;
    }
  }

  // Determine final winner
  let winner: "A" | "B" | "tie";
  if (holesWonA > holesWonB) {
    winner = "A";
  } else if (holesWonB > holesWonA) {
    winner = "B";
  } else {
    winner = "tie";
  }

  return { winner, holesWonA, holesWonB };
}

/**
 * Compute "vs All" records for all players in a round
 * For team formats, groups players by team and simulates team vs team
 */
export function computeVsAllForRound(
  playerFacts: PlayerFactForSim[],
  courseHoles: CourseHoleInfo[],
  format: RoundFormat,
  slopeRating: number,
  courseRating: number,
  coursePar: number
): VsAllRecord[] {
  const records: VsAllRecord[] = [];

  if (isSinglesFormat(format)) {
    // Singles: each player vs all other players
    for (let i = 0; i < playerFacts.length; i++) {
      const playerA = playerFacts[i];
      let wins = 0;
      let losses = 0;
      let ties = 0;

      for (let j = 0; j < playerFacts.length; j++) {
        if (i === j) continue; // Don't simulate against self

        const playerB = playerFacts[j];
        const result = simulateHeadToHead(
          playerA,
          playerB,
          courseHoles,
          format,
          slopeRating,
          courseRating,
          coursePar
        );

        if (result.winner === "A") {
          wins++;
        } else if (result.winner === "B") {
          losses++;
        } else {
          ties++;
        }
      }

      records.push({
        playerId: playerA.playerId,
        playerName: playerA.playerName,
        wins,
        losses,
        ties,
      });
    }
  } else {
    // Team formats: group by team (using partnerIds), then simulate team vs team
    // Build teams: map from teamKey to team members
    const teams = new Map<string, PlayerFactForSim[]>();

    for (const fact of playerFacts) {
      // Create a team key by sorting player IDs
      const allPlayerIds = [fact.playerId, ...(fact.partnerIds || [])];
      allPlayerIds.sort();
      const teamKey = allPlayerIds.join("_");

      if (!teams.has(teamKey)) {
        teams.set(teamKey, []);
      }
      teams.get(teamKey)!.push(fact);
    }

    const teamKeys = Array.from(teams.keys());

    // For each team, simulate against all other teams
    for (let i = 0; i < teamKeys.length; i++) {
      const teamKeyA = teamKeys[i];
      const teamMembersA = teams.get(teamKeyA)!;

      // Pick representative player from team A (for simulation purposes)
      // In team formats, all members share the same holePerformance (team scores)
      const repA = teamMembersA[0];

      let wins = 0;
      let losses = 0;
      let ties = 0;

      for (let j = 0; j < teamKeys.length; j++) {
        if (i === j) continue; // Don't simulate against self

        const teamKeyB = teamKeys[j];
        const teamMembersB = teams.get(teamKeyB)!;
        const repB = teamMembersB[0];

        const result = simulateHeadToHead(
          repA,
          repB,
          courseHoles,
          format,
          slopeRating,
          courseRating,
          coursePar
        );

        if (result.winner === "A") {
          wins++;
        } else if (result.winner === "B") {
          losses++;
        } else {
          ties++;
        }
      }

      // Create a record for each team member (all share same W-L-T)
      for (const member of teamMembersA) {
        records.push({
          playerId: member.playerId,
          playerName: member.playerName,
          wins,
          losses,
          ties,
          teamKey: teamKeyA,
        });
      }
    }
  }

  return records;
}
