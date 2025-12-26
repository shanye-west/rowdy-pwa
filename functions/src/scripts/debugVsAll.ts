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

// Output directory relative to project root
const OUTPUT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..', 'debug-csvs');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

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
  console.log(`\n${'='.repeat(60)}`);
  console.log(`DEBUG VSALL - Round: ${roundId}`);
  console.log(`${'='.repeat(60)}\n`);

  console.log(`Fetching data from Firestore (minimal reads)...`);
  const { round, course, playerMatchFacts, recap } = await fetchData(roundId);

  const slope = course.slopeRating || course.slope || 113;
  const rating = course.courseRating || course.rating || course.par || 72;
  const par = course.par || 72;

  console.log(`Course: ${course.name}`);
  console.log(`  Par: ${par} • Rating: ${rating} • Slope: ${slope}`);
  console.log(`  Format: ${round.format}`);
  console.log(`  PlayerMatchFacts: ${playerMatchFacts.length}`);
  console.log(`\nComputing vsAll locally...`);

  const players = playerMatchFacts.map(toPlayerFact);
  const computed = computeVsAllForRound(players, course.holes as CourseHoleInfo[], round.format, slope, rating, par);

  // Build detailed CSV (all matchups with full info)
  const detailedLines: string[] = [];
  const summaryMap = new Map<string, { playerId: string; playerName: string; hdcpIndex: number; courseHandicap: number; wins: number; losses: number; ties: number; teamKey?: string }>();

  if (round.format === 'singles') {
    // Singles: detailed CSV shows player-vs-player matchups
    detailedLines.push('playerA,playerB,hdcpIndexA,hdcpIndexB,courseHandicapA,courseHandicapB,adjustedA,adjustedB,strokesA,strokesB,winner,holesWonA,holesWonB');

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

        detailedLines.push([
          `"${a.playerName.replace(/"/g, '""')}"`,
          `"${b.playerName.replace(/"/g, '""')}"`,
          a.playerHandicap.toFixed(1),
          b.playerHandicap.toFixed(1),
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

      // Build summary
      const p = players[i];
      const ch = calculateCourseHandicap(p.playerHandicap, slope, rating, par);
      const rec = computed.find(c => c.playerId === p.playerId);
      if (rec) {
        summaryMap.set(p.playerId, {
          playerId: p.playerId,
          playerName: p.playerName,
          hdcpIndex: p.playerHandicap,
          courseHandicap: ch,
          wins: rec.wins,
          losses: rec.losses,
          ties: rec.ties,
        });
      }
    }
  } else {
    // Team format: detailed CSV shows team-vs-team matchups with member details
    detailedLines.push('teamA,teamB,teamAMembers,teamBMembers,teamACourseHandicaps,teamBCourseHandicaps,teamAAdjusted,teamBAdjusted,teamAStrokes,teamBStrokes,winner,holesWonA,holesWonB');

    const teams = new Map<string, PlayerFactForSim[]>();
    for (const pmf of playerMatchFacts) {
      const ids = [pmf.playerId, ...(pmf.partnerIds || [])].filter(Boolean).map(String);
      ids.sort();
      const teamKey = ids.join('_');
      if (!teams.has(teamKey)) teams.set(teamKey, []);
      teams.get(teamKey)!.push(toPlayerFact(pmf));
    }

    const teamKeys = Array.from(teams.keys());

    for (let i = 0; i < teamKeys.length; i++) {
      for (let j = i + 1; j < teamKeys.length; j++) {
        const keyA = teamKeys[i];
        const keyB = teamKeys[j];
        const membersA = teams.get(keyA)!;
        const membersB = teams.get(keyB)!;

        const allMembers = [...membersA, ...membersB];
        const chMap = new Map<string, number>();
        for (const m of allMembers) {
          const ch = calculateCourseHandicap(m.playerHandicap, slope, rating, par);
          chMap.set(m.playerId, ch);
        }

        const lowestCH = Math.min(...Array.from(chMap.values()));

        const teamANames = membersA.map(m => m.playerName).join(' / ');
        const teamBNames = membersB.map(m => m.playerName).join(' / ');
        const teamACHs = membersA.map(m => chMap.get(m.playerId)!).join('|');
        const teamBCHs = membersB.map(m => chMap.get(m.playerId)!).join('|');
        const teamAAdj = membersA.map(m => (chMap.get(m.playerId)! - lowestCH)).join('|');
        const teamBAdj = membersB.map(m => (chMap.get(m.playerId)! - lowestCH)).join('|');
        
        const teamAStrokesAll = membersA.map(m => {
          const adj = (chMap.get(m.playerId)! - lowestCH);
          return strokesToStr(calculateStrokesReceived(adj, course.holes as CourseHoleInfo[]));
        }).join('|');
        const teamBStrokesAll = membersB.map(m => {
          const adj = (chMap.get(m.playerId)! - lowestCH);
          return strokesToStr(calculateStrokesReceived(adj, course.holes as CourseHoleInfo[]));
        }).join('|');

        const holes = course.holes as CourseHoleInfo[];
        let holesWonA = 0, holesWonB = 0;
        
        for (let h = 0; h < holes.length; h++) {
          const aNets = membersA.map(m => {
            const perf = m.holePerformance.find(p => p.hole === holes[h].number);
            if (!perf || perf.gross == null) return null;
            const strokes = calculateStrokesReceived((chMap.get(m.playerId)! - lowestCH), holes)[h] || 0;
            return perf.gross - strokes;
          }).filter((v): v is number => v != null);
          
          const bNets = membersB.map(m => {
            const perf = m.holePerformance.find(p => p.hole === holes[h].number);
            if (!perf || perf.gross == null) return null;
            const strokes = calculateStrokesReceived((chMap.get(m.playerId)! - lowestCH), holes)[h] || 0;
            return perf.gross - strokes;
          }).filter((v): v is number => v != null);

          const aScore = aNets.length ? Math.min(...aNets) : null;
          const bScore = bNets.length ? Math.min(...bNets) : null;
          
          if (aScore != null && bScore != null) {
            if (aScore < bScore) holesWonA++;
            else if (bScore < aScore) holesWonB++;
          }
        }

        let winner: string;
        if (holesWonA > holesWonB) winner = 'A';
        else if (holesWonB > holesWonA) winner = 'B';
        else winner = 'tie';

        detailedLines.push([
          `"${teamANames}"`,
          `"${teamBNames}"`,
          `"${membersA.map(m => m.playerName).join(' | ')}"`,
          `"${membersB.map(m => m.playerName).join(' | ')}"`,
          `"${teamACHs}"`,
          `"${teamBCHs}"`,
          `"${teamAAdj}"`,
          `"${teamBAdj}"`,
          `"${teamAStrokesAll}"`,
          `"${teamBStrokesAll}"`,
          winner,
          holesWonA,
          holesWonB,
        ].join(','));
      }

      // Build team summary
      const key = teamKeys[i];
      const members = teams.get(key)!;
      const displayName = members.map(m => m.playerName).join(' / ');
      const membersCH = members.map(m => calculateCourseHandicap(m.playerHandicap, slope, rating, par));
      
      // Find any record with this teamKey
      const rec = computed.find(c => c.teamKey === key);
      if (rec) {
        for (const m of members) {
          summaryMap.set(m.playerId, {
            playerId: m.playerId,
            playerName: m.playerName,
            hdcpIndex: m.playerHandicap,
            courseHandicap: calculateCourseHandicap(m.playerHandicap, slope, rating, par),
            wins: rec.wins,
            losses: rec.losses,
            ties: rec.ties,
            teamKey: key,
          });
        }
      }
    }
  }

  // Write detailed CSV
  const detailedPath = path.join(OUTPUT_DIR, `${roundId}-detailed.csv`);
  fs.writeFileSync(detailedPath, detailedLines.join('\n'), 'utf8');
  console.log(`✓ Detailed CSV: ${detailedPath}`);

  // Write summary CSV
  const summaryLines = ['playerId,playerName,hdcpIndex,courseHandicap,wins,losses,ties,totalMatches,teamKey'];
  for (const [_, rec] of summaryMap.entries()) {
    summaryLines.push([
      `"${rec.playerId}"`,
      `"${rec.playerName.replace(/"/g, '""')}"`,
      rec.hdcpIndex.toFixed(1),
      rec.courseHandicap,
      rec.wins,
      rec.losses,
      rec.ties,
      rec.wins + rec.losses + rec.ties,
      rec.teamKey ? `"${rec.teamKey}"` : '',
    ].join(','));
  }
  const summaryPath = path.join(OUTPUT_DIR, `${roundId}-summary.csv`);
  fs.writeFileSync(summaryPath, summaryLines.join('\n'), 'utf8');
  console.log(`✓ Summary CSV: ${summaryPath}`);

  // Compare to stored recap
  console.log(`\nComparing to stored Round Recap...`);
  if (!recap || !Array.isArray(recap.vsAllRecords)) {
    console.log(`⚠️  No stored recap found in database`);
    return;
  }

  const recapMap = new Map<string, any>();
  for (const r of recap.vsAllRecords) {
    recapMap.set(r.playerId, r);
    if (r.teamKey) recapMap.set(r.teamKey, r);
  }

  const mismatches: Array<{ type: string; id: string; name: string; stored: any; computed: any }> = [];
  
  for (const c of computed) {
    const lookupKey = c.teamKey || c.playerId;
    const s = recapMap.get(lookupKey);
    
    if (!s) {
      mismatches.push({
        type: c.teamKey ? 'team' : 'player',
        id: lookupKey,
        name: c.playerName,
        stored: null,
        computed: { wins: c.wins, losses: c.losses, ties: c.ties },
      });
      continue;
    }
    
    if (s.wins !== c.wins || s.losses !== c.losses || s.ties !== c.ties) {
      mismatches.push({
        type: c.teamKey ? 'team' : 'player',
        id: lookupKey,
        name: c.playerName,
        stored: { wins: s.wins, losses: s.losses, ties: s.ties },
        computed: { wins: c.wins, losses: c.losses, ties: c.ties },
      });
    }
  }

  if (mismatches.length === 0) {
    console.log(`✓ All vsAll records match stored recap`);
  } else {
    console.log(`\n⚠️  MISMATCHES FOUND: ${mismatches.length}\n`);
    mismatches.forEach(m => {
      console.log(`${m.type.toUpperCase()}: ${m.name} (${m.id})`);
      if (m.stored) {
        console.log(`  Stored:   W:${m.stored.wins} L:${m.stored.losses} T:${m.stored.ties}`);
        console.log(`  Computed: W:${m.computed.wins} L:${m.computed.losses} T:${m.computed.ties}`);
      } else {
        console.log(`  Missing in recap`);
        console.log(`  Computed: W:${m.computed.wins} L:${m.computed.losses} T:${m.computed.ties}`);
      }
      console.log('');
    });

    // Write mismatches to JSON
    const mismatchPath = path.join(OUTPUT_DIR, `${roundId}-mismatches.json`);
    fs.writeFileSync(mismatchPath, JSON.stringify(mismatches, null, 2), 'utf8');
    console.log(`Mismatches details: ${mismatchPath}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Complete. Files written to: ${OUTPUT_DIR}`);
  console.log(`${'='.repeat(60)}\n`);
}

run(roundIdArg).catch(err => {
  console.error('Error running debug vsAll:', err);
  process.exitCode = 1;
});
