#!/usr/bin/env node
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import {
  simulateHeadToHead,
  computeVsAllForRound,
  type PlayerFactForSim,
  type CourseHoleInfo,
} from "../helpers/vsAllSimulation.js";
import { calculateCourseHandicap, calculateStrokesReceived } from "../ghin.js";

const roundIdArg = process.argv[2] || "2025CC-R01-twoManBestBall";

if (!roundIdArg) {
  console.error("Usage: node lib/scripts/debugVsAll.js <ROUND_ID>");
  process.exit(1);
}

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (e) {
    // ignore
  }
}

const db = admin.firestore();

async function fetchData(roundId: string) {
  const roundDoc = await db.collection("rounds").doc(roundId).get();
  if (!roundDoc.exists) throw new Error(`Round not found: ${roundId}`);
  const round = roundDoc.data() as any;

  const courseDoc = await db.collection("courses").doc(round.courseId).get();
  if (!courseDoc.exists) throw new Error(`Course not found: ${round.courseId}`);
  const course = courseDoc.data() as any;

  const pmfSnap = await db.collection("playerMatchFacts").where("roundId", "==", roundId).get();
  const playerMatchFacts = pmfSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  const recapDoc = await db.collection("roundRecaps").doc(roundId).get();
  const recap = recapDoc.exists ? (recapDoc.data() as any) : null;

  return { round, course, playerMatchFacts, recap };
}

function toPlayerFact(pmf: any): PlayerFactForSim {
  const holePerformance = Array.isArray(pmf.holePerformance)
    ? pmf.holePerformance
    : (pmf.holePerformanceMap ? Object.values(pmf.holePerformanceMap) : []);

  return {
    playerId: pmf.playerId || pmf.id || pmf.player?.id,
    playerName: pmf.playerName || pmf.playerNameDisplay || pmf.player?.name || pmf.player?.displayName || pmf.playerId || pmf.id,
    playerHandicap: typeof pmf.playerHandicap === 'number' ? pmf.playerHandicap : (pmf.playerHandicap || 0),
    team: pmf.team || "teamA",
    partnerIds: pmf.partnerIds || [],
    holePerformance: holePerformance.map((h: any) => ({
      hole: h.hole ?? h.holeNumber ?? h.index,
      gross: typeof h.gross === 'number' ? h.gross : (typeof h.teamGross === 'number' ? h.teamGross : null),
      net: h.net ?? null,
      par: h.par ?? null,
    })),
  };
}

function strokesToStr(arr: number[]) { return arr.map(n => (n ? '1' : '0')).join(''); }

async function run(roundId: string) {
  console.log(`Fetching data for round ${roundId} (single-shot reads)...`);
  const { round, course, playerMatchFacts, recap } = await fetchData(roundId);

  const slope = course.slopeRating || course.slope || 113;
  const rating = course.courseRating || course.rating || course.par || 72;
  const par = course.par || 72;

  console.log(`Course: ${course.name} • par ${par} • rating ${rating} • slope ${slope}`);
  console.log(`PlayerMatchFacts fetched: ${playerMatchFacts.length}`);

  const players = playerMatchFacts.map(toPlayerFact);

  const computed = computeVsAllForRound(players, course.holes as CourseHoleInfo[], round.format, slope, rating, par);

  const csvLines: string[] = [
    'playerA,playerB,chA,chB,adjA,adjB,strokesA,strokesB,winner,holesWonA,holesWonB',
  ];

  for (let i = 0; i < players.length; i++) {
    for (let j = 0; j < players.length; j++) {
      if (i === j) continue;
      const a = players[i];
      const b = players[j];

      const chA = calculateCourseHandicap(a.playerHandicap, slope, rating, par);
      const chB = calculateCourseHandicap(b.playerHandicap, slope, rating, par);
      const lowest = Math.min(chA, chB);
      const adjA = chA - lowest;
      const adjB = chB - lowest;
      const strokesA = calculateStrokesReceived(adjA, course.holes as CourseHoleInfo[]);
      const strokesB = calculateStrokesReceived(adjB, course.holes as CourseHoleInfo[]);

      const sim = simulateHeadToHead(a, b, course.holes as CourseHoleInfo[], round.format, slope, rating, par);

      csvLines.push([
        `"${a.playerName.replace(/"/g, '""')}"`,
        `"${b.playerName.replace(/"/g, '""')}"`,
        chA,
        chB,
        adjA,
        adjB,
        `"${strokesToStr(strokesA)}"`,
        `"${strokesToStr(strokesB)}"`,
        sim.winner,
        sim.holesWonA,
        sim.holesWonB,
      ].join(','));
    }
  }

  const outPath = path.join('/tmp', `vsall-${roundId}.csv`);
  fs.writeFileSync(outPath, csvLines.join('\n'), 'utf8');
  console.log('CSV written to', outPath);

  if (recap && Array.isArray(recap.vsAllRecords)) {
    console.log('Comparing computed vsAll to stored recap...');
    const recapMap = new Map(recap.vsAllRecords.map((r: any) => [r.playerId, r]));
    const diffs: any[] = [];
    for (const c of computed) {
      const s: any = recapMap.get(c.playerId) || recapMap.get(c.teamKey || '');
      if (!s) {
        diffs.push({ playerId: c.playerId, reason: 'missing in recap', computed: c });
        continue;
      }
      if (s.wins !== c.wins || s.losses !== c.losses || s.ties !== c.ties) {
        diffs.push({ playerId: c.playerId, stored: s, computed: c });
      }
    }

    if (diffs.length === 0) console.log('No mismatches found between computed vsAll and stored recap.');
    else {
      console.log('Mismatches found:', diffs.length);
      diffs.slice(0, 20).forEach(d => console.log(JSON.stringify(d, null, 2)));
      const diffPath = path.join('/tmp', `vsall-${roundId}-diffs.json`);
      fs.writeFileSync(diffPath, JSON.stringify(diffs, null, 2), 'utf8');
      console.log('Detailed diffs written to', diffPath);
    }
  } else {
    console.log('No stored recap available to compare.');
  }

  // If team format, produce a team-vs-team CSV and summary
  if (round.format && round.format !== 'singles') {
    console.log('Generating team-level vsAll CSV for team format', round.format);
    const teams = new Map<string, PlayerFactForSim[]>();
    for (const pmf of playerMatchFacts) {
      const ids = [pmf.playerId, ...(pmf.partnerIds || [])].filter(Boolean).map(String);
      ids.sort();
      const teamKey = ids.join('_');
      if (!teams.has(teamKey)) teams.set(teamKey, []);
      teams.get(teamKey)!.push(toPlayerFact(pmf));
    }

    const teamKeys = Array.from(teams.keys());
    const teamCsv: string[] = ['teamA,teamB,winner,holesWonA,holesWonB'];
    const teamSummary = new Map<string, { wins:number; losses:number; ties:number; displayName:string }>();

    // initialize summary
    for (const key of teamKeys) {
      const members = teams.get(key)!;
      const display = members.map(m => m.playerName).join(' / ');
      teamSummary.set(key, { wins:0, losses:0, ties:0, displayName: display });
    }

    for (let i = 0; i < teamKeys.length; i++) {
      for (let j = i+1; j < teamKeys.length; j++) {
        const keyA = teamKeys[i];
        const keyB = teamKeys[j];
        const membersA = teams.get(keyA)!;
        const membersB = teams.get(keyB)!;

        // compute course handicaps for all members
        const allMembers = [...membersA, ...membersB];
        const chMap = new Map<string, number>();
        for (const m of allMembers) {
          const ch = calculateCourseHandicap(m.playerHandicap, slope, rating, par);
          chMap.set(m.playerId, ch);
        }

        const lowestCH = Math.min(...Array.from(chMap.values()));

        // build per-member detail objects
        const detailFor = (m: PlayerFactForSim) => {
          const ch = chMap.get(m.playerId) ?? 0;
          const adj = ch - lowestCH;
          const strokes = calculateStrokesReceived(adj, course.holes as CourseHoleInfo[]);
          return {
            playerId: m.playerId,
            playerName: m.playerName,
            courseHandicap: ch,
            adjustedHandicap: adj,
            strokes: strokes.map(s => (s ? 1 : 0)),
          };
        };

        const detailsA = membersA.map(detailFor);
        const detailsB = membersB.map(detailFor);

        // compute team hole scores using best net (gross - strokes)
        const holes = course.holes as CourseHoleInfo[];
        const teamAHoleScores: (number | null)[] = holes.map((h, idx) => {
          const nets = membersA.map((m, mi) => {
            const perf = m.holePerformance.find(p => p.hole === h.number);
            if (!perf || perf.gross == null) return null;
            const strokes = calculateStrokesReceived((chMap.get(m.playerId) ?? 0) - lowestCH, holes)[idx] || 0;
            return perf.gross - strokes;
          }).filter((v): v is number => v != null);
          return nets.length ? Math.min(...nets) : null;
        });

        const teamBHoleScores: (number | null)[] = holes.map((h, idx) => {
          const nets = membersB.map((m, mi) => {
            const perf = m.holePerformance.find(p => p.hole === h.number);
            if (!perf || perf.gross == null) return null;
            const strokes = calculateStrokesReceived((chMap.get(m.playerId) ?? 0) - lowestCH, holes)[idx] || 0;
            return perf.gross - strokes;
          }).filter((v): v is number => v != null);
          return nets.length ? Math.min(...nets) : null;
        });

        // tally holes
        let holesWonA = 0, holesWonB = 0;
        for (let h = 0; h < holes.length; h++) {
          const aScore = teamAHoleScores[h];
          const bScore = teamBHoleScores[h];
          if (aScore == null || bScore == null) continue;
          if (aScore < bScore) holesWonA++;
          else if (bScore < aScore) holesWonB++;
        }

        let computedWinner: string;
        if (holesWonA > holesWonB) computedWinner = 'A';
        else if (holesWonB > holesWonA) computedWinner = 'B';
        else computedWinner = 'tie';

        // also keep legacy sim result (rep-based)
        const repA = membersA[0];
        const repB = membersB[0];
        const sim = simulateHeadToHead(repA, repB, course.holes as CourseHoleInfo[], round.format, slope, rating, par);

        teamCsv.push([
          `"${teamSummary.get(keyA)!.displayName}"`,
          `"${teamSummary.get(keyB)!.displayName}"`,
          `"${JSON.stringify(detailsA)}"`,
          `"${JSON.stringify(detailsB)}"`,
          computedWinner,
          sim.winner,
          holesWonA,
          holesWonB
        ].join(','));

        // update summaries based on computedWinner
        const a = teamSummary.get(keyA)!;
        const b = teamSummary.get(keyB)!;
        if (computedWinner === 'A') { a.wins++; b.losses++; }
        else if (computedWinner === 'B') { b.wins++; a.losses++; }
        else { a.ties++; b.ties++; }
      }
    }

    const teamOutPath = path.join('/tmp', `team-vsall-${roundId}.csv`);
    fs.writeFileSync(teamOutPath, teamCsv.join('\n'), 'utf8');
    console.log('Team CSV written to', teamOutPath);

    // Write a simple summary file
    const summaryLines: string[] = ['teamKey,displayName,wins,losses,ties'];
    for (const [k, v] of teamSummary.entries()) {
      summaryLines.push([k, `"${v.displayName}"`, v.wins, v.losses, v.ties].join(','));
    }
    const summaryPath = path.join('/tmp', `team-vsall-${roundId}-summary.csv`);
    fs.writeFileSync(summaryPath, summaryLines.join('\n'), 'utf8');
    console.log('Team summary written to', summaryPath);

    // Compare to stored recap if present: recap.vsAllRecords contains per-player rows with teamKey
    if (recap && Array.isArray(recap.vsAllRecords)) {
      const recapByTeam = new Map<string, { wins:number; losses:number; ties:number }>();
      for (const r of recap.vsAllRecords) {
        if (!r.teamKey) continue;
        recapByTeam.set(r.teamKey, { wins: r.wins, losses: r.losses, ties: r.ties });
      }

      const teamDiffs: any[] = [];
      for (const [k, v] of teamSummary.entries()) {
        const stored = recapByTeam.get(k);
        if (!stored) { teamDiffs.push({ teamKey: k, reason: 'missing in recap', computed: v }); continue; }
        if (stored.wins !== v.wins || stored.losses !== v.losses || stored.ties !== v.ties) {
          teamDiffs.push({ teamKey: k, stored, computed: v });
        }
      }

      if (teamDiffs.length === 0) console.log('No team-level mismatches vs stored recap.');
      else {
        console.log('Team-level mismatches found:', teamDiffs.length);
        const teamDiffPath = path.join('/tmp', `team-vsall-${roundId}-diffs.json`);
        fs.writeFileSync(teamDiffPath, JSON.stringify(teamDiffs, null, 2), 'utf8');
        console.log('Team diffs written to', teamDiffPath);
      }
    }
  }
}

run(roundIdArg).catch(err => {
  console.error('Error running debug vsAll:', err);
  process.exitCode = 1;
});
