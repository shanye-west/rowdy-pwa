import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";

import { db } from "./firebase";
import { RoundFormat, clamp01, isNum } from "./utils";

export const updateMatchFacts = onDocumentWritten("matches/{matchId}", async (event) => {
  const matchId = event.params.matchId;
  const after = event.data?.after?.data();

  if (!after || !after.status?.closed) {
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
  let coursePar = 72;
  let day = 0;
  let playerTierLookup: Record<string, string> = {};
  let playerHandicapLookup: Record<string, number> = {};
  let teamAId = "teamA";
  let teamBId = "teamB";
  let tournamentYear = 0;
  let tournamentName = "";
  let tournamentSeries = "";

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

  const holesData = after.holes || {};
  let leadChanges = 0;
  let wasTeamANeverBehind = true;
  let wasTeamBNeverBehind = true;
  let winningHole: number | null = null;
  let prevLeader: "teamA" | "teamB" | null = null;
  let runningMargin = 0;

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

  const teamADrivesUsed = [0, 0];
  const teamBDrivesUsed = [0, 0];

  const teamAPlayerGross = [0, 0];
  const teamBPlayerGross = [0, 0];
  const teamAPlayerNet = [0, 0];
  const teamBPlayerNet = [0, 0];

  let teamATotalGross = 0;
  let teamBTotalGross = 0;

  const finalThru = status.thru || 18;

  let marginGoingInto18 = 0;
  let hole18Result: "teamA" | "teamB" | "AS" | null = null;

  const teamABallUsedOn18: (boolean | null)[] = [null, null];
  const teamBBallUsedOn18: (boolean | null)[] = [null, null];

  for (let i = 1; i <= finalThru; i++) {
    const h = holesData[String(i)]?.input ?? {};

    if (i === 18) {
      marginGoingInto18 = runningMargin;
    }

    let holeResult: "teamA" | "teamB" | "AS" | null = null;

    if (format === "twoManScramble") {
      const { teamAGross: a, teamBGross: b } = h;
      if (isNum(a) && isNum(b)) {
        holeResult = a < b ? "teamA" : b < a ? "teamB" : "AS";
      }
    } else if (format === "singles") {
      const { teamAPlayerGross: aG, teamBPlayerGross: bG } = h;
      if (isNum(aG) && isNum(bG)) {
        const aNet = aG - clamp01(after.teamAPlayers?.[0]?.strokesReceived?.[i-1]);
        const bNet = bG - clamp01(after.teamBPlayers?.[0]?.strokesReceived?.[i-1]);
        holeResult = aNet < bNet ? "teamA" : bNet < aNet ? "teamB" : "AS";
      }
    } else if (format === "twoManShamble") {
      const aArr = h.teamAPlayersGross || [];
      const bArr = h.teamBPlayersGross || [];
      if (Array.isArray(aArr) && aArr[0] != null && aArr[1] != null && Array.isArray(bArr) && bArr[0] != null && bArr[1] != null) {
        const aBest = Math.min(aArr[0], aArr[1]);
        const bBest = Math.min(bArr[0], bArr[1]);
        holeResult = aBest < bBest ? "teamA" : bBest < aBest ? "teamB" : "AS";
      }
    } else {
      const aArr = h.teamAPlayersGross || [];
      const bArr = h.teamBPlayersGross || [];
      if (Array.isArray(aArr) && aArr[0] != null && aArr[1] != null && Array.isArray(bArr) && bArr[0] != null && bArr[1] != null) {
        const getNet = (g:number|null, pIdx:number, teamArr:any[]) => {
          const s = clamp01(teamArr?.[pIdx]?.strokesReceived?.[i-1]);
          return g! - s;
        };
        const aBest = Math.min(getNet(aArr[0],0,after.teamAPlayers), getNet(aArr[1],1,after.teamAPlayers));
        const bBest = Math.min(getNet(bArr[0],0,after.teamBPlayers), getNet(bArr[1],1,after.teamBPlayers));
        holeResult = aBest < bBest ? "teamA" : bBest < aBest ? "teamB" : "AS";
      }
    }

    if (holeResult !== null) {
      if (holeResult === "teamA") runningMargin++;
      else if (holeResult === "teamB") runningMargin--;

      const currentLeader = runningMargin > 0 ? "teamA" : runningMargin < 0 ? "teamB" : null;
      if (currentLeader !== prevLeader && currentLeader !== null && prevLeader !== null) {
        leadChanges++;
      }
      if (currentLeader === "teamA") wasTeamBNeverBehind = false;
      if (currentLeader === "teamB") wasTeamANeverBehind = false;
      prevLeader = currentLeader;

      if (Math.abs(runningMargin) > (finalThru - i) && winningHole === null) {
        winningHole = i;
      }

      if (i === 18) {
        hole18Result = holeResult;
      }

      if (format === "twoManBestBall" || format === "twoManShamble") {
        const aArr = h.teamAPlayersGross;
        const bArr = h.teamBPlayersGross;
        if (Array.isArray(aArr) && aArr[0] != null && aArr[1] != null) {
          if (aArr[0] <= aArr[1]) teamABallsUsed[0]++;
          if (aArr[1] <= aArr[0]) teamABallsUsed[1]++;
          if (aArr[0] < aArr[1]) {
            teamABallsUsedSolo[0]++;
            if (holeResult === "teamA") teamABallsUsedSoloWonHole[0]++;
            if (holeResult === "AS") teamABallsUsedSoloPush[0]++;
            if (i === 18) {
              teamABallUsedOn18[0] = true;
              teamABallUsedOn18[1] = false;
            }
          } else if (aArr[1] < aArr[0]) {
            teamABallsUsedSolo[1]++;
            if (holeResult === "teamA") teamABallsUsedSoloWonHole[1]++;
            if (holeResult === "AS") teamABallsUsedSoloPush[1]++;
            if (i === 18) {
              teamABallUsedOn18[0] = false;
              teamABallUsedOn18[1] = true;
            }
          } else {
            teamABallsUsedShared[0]++;
            teamABallsUsedShared[1]++;
          }
        }

        if (Array.isArray(bArr) && bArr[0] != null && bArr[1] != null) {
          if (bArr[0] <= bArr[1]) teamBBallsUsed[0]++;
          if (bArr[1] <= bArr[0]) teamBBallsUsed[1]++;
          if (bArr[0] < bArr[1]) {
            teamBBallsUsedSolo[0]++;
            if (holeResult === "teamB") teamBBallsUsedSoloWonHole[0]++;
            if (holeResult === "AS") teamBBallsUsedSoloPush[0]++;
            if (i === 18) {
              teamBBallUsedOn18[0] = true;
              teamBBallUsedOn18[1] = false;
            }
          } else if (bArr[1] < bArr[0]) {
            teamBBallsUsedSolo[1]++;
            if (holeResult === "teamB") teamBBallsUsedSoloWonHole[1]++;
            if (holeResult === "AS") teamBBallsUsedSoloPush[1]++;
            if (i === 18) {
              teamBBallUsedOn18[0] = false;
              teamBBallUsedOn18[1] = true;
            }
          } else {
            teamBBallsUsedShared[0]++;
            teamBBallsUsedShared[1]++;
          }
        }
      }
    }

    if (format === "twoManScramble" || format === "twoManShamble") {
      const aDrive = h.teamADrive;
      const bDrive = h.teamBDrive;
      if (aDrive === 0) teamADrivesUsed[0]++;
      else if (aDrive === 1) teamADrivesUsed[1]++;
      if (bDrive === 0) teamBDrivesUsed[0]++;
      else if (bDrive === 1) teamBDrivesUsed[1]++;
    }

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

    let ballUsedOn18: boolean | null = null;
    if (format === "twoManBestBall" || format === "twoManShamble") {
      ballUsedOn18 = team === "teamA" ? teamABallUsedOn18[pIdx] : teamBBallUsedOn18[pIdx];
    }

    let drivesUsed: number | null = null;
    if (format === "twoManScramble" || format === "twoManShamble") {
      drivesUsed = team === "teamA" ? teamADrivesUsed[pIdx] : teamBDrivesUsed[pIdx];
    }

    let totalGross: number | null = null;
    let totalNet: number | null = null;
    let strokesVsParGross: number | null = null;
    let strokesVsParNet: number | null = null;
    let teamTotalGross: number | null = null;
    let teamStrokesVsParGross: number | null = null;

    if (format === "twoManBestBall" || format === "singles") {
      const playerGrossArr = team === "teamA" ? teamAPlayerGross : teamBPlayerGross;
      const playerNetArr = team === "teamA" ? teamAPlayerNet : teamBPlayerNet;
      totalGross = playerGrossArr[pIdx];
      totalNet = playerNetArr[pIdx];
      strokesVsParGross = totalGross - coursePar;
      strokesVsParNet = totalNet - coursePar;
    } else if (format === "twoManScramble" || format === "twoManShamble") {
      teamTotalGross = team === "teamA" ? teamATotalGross : teamBTotalGross;
      teamStrokesVsParGross = teamTotalGross - coursePar;
    }

    const myTier = playerTierLookup[p.playerId] || "Unknown";
    const myTeamId = team === "teamA" ? teamAId : teamBId;
    const oppTeamId = team === "teamA" ? teamBId : teamAId;

    const playerHandicap = playerHandicapLookup[p.playerId] ?? null;

    let decidedOn18 = false;
    let won18thHole: boolean | null = null;

    if (finalThru === 18 && winningHole === null && hole18Result !== null) {
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

    let opponentIds: string[] = [];
    let opponentTiers: string[] = [];
    let opponentHandicaps: (number | null)[] = [];

    if (Array.isArray(opponentPlayers)) {
      opponentPlayers.forEach((opp) => {
        if (opp && opp.playerId) {
          opponentIds.push(opp.playerId);
          opponentTiers.push(playerTierLookup[opp.playerId] || "Unknown");
          opponentHandicaps.push(playerHandicapLookup[opp.playerId] ?? null);
        }
      });
    }

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

    if (ballsUsed !== null) factData.ballsUsed = ballsUsed;
    if (ballsUsedSolo !== null) factData.ballsUsedSolo = ballsUsedSolo;
    if (ballsUsedShared !== null) factData.ballsUsedShared = ballsUsedShared;
    if (ballsUsedSoloWonHole !== null) factData.ballsUsedSoloWonHole = ballsUsedSoloWonHole;
    if (ballsUsedSoloPush !== null) factData.ballsUsedSoloPush = ballsUsedSoloPush;
    if (ballUsedOn18 !== null) factData.ballUsedOn18 = ballUsedOn18;
    if (drivesUsed !== null) factData.drivesUsed = drivesUsed;

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
