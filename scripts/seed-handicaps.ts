/**
 * Seed Handicaps Script
 *
 * Updates `teamA.handicapByPlayer` / `teamB.handicapByPlayer` for a tournament
 * based on the provided JSON file.
 *
 * Run with: npx ts-node scripts/seed-handicaps.ts --input data/update-handicaps.json [--tournament <tournamentId>]
 *
 * Input JSON accepted formats:
 * 1) Object map: { "playerId": 12.3, ... }
 * 2) Array: [ { "playerId": "p1", "handicap": 12.3 }, ... ]
 * 3) Object with tournamentId: { "tournamentId": "2025-rowdycup", "handicapByPlayer": { ... } }
 */

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

// Initialize Firebase Admin (use service-account.json if present)
const serviceAccountPath = path.join(__dirname, "../service-account.json");

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount as any) });
} else {
  admin.initializeApp();
}

const db = admin.firestore();

async function seedHandicaps(inputFile: string, tournamentFlag?: string) {
  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.error("❌ Failed to parse JSON input:", err.message || err);
    process.exit(1);
  }

  // Determine tournamentId
  let tournamentId: string | undefined = undefined;
  if (payload && typeof payload === "object" && payload.tournamentId) {
    tournamentId = payload.tournamentId;
  }
  if (!tournamentId && tournamentFlag) {
    tournamentId = tournamentFlag;
  }
  if (!tournamentId) {
    console.error("❌ Missing tournamentId. Provide it in the JSON as 'tournamentId' or pass --tournament <id>");
    process.exit(1);
  }

  // Normalize entries to array of { playerId, handicap }
  let entries: Array<{ playerId: string; handicap: number }> = [];

  if (Array.isArray(payload)) {
    entries = payload.map((it: any) => ({ playerId: it.playerId || it.id, handicap: Number(it.handicap) }));
  } else if (payload && typeof payload === "object") {
    if (payload.handicapByPlayer && typeof payload.handicapByPlayer === "object") {
      entries = Object.keys(payload.handicapByPlayer).map(pid => ({ playerId: pid, handicap: Number(payload.handicapByPlayer[pid]) }));
    } else {
      // treat top-level object as map of playerId -> handicap (ignore tournamentId if present)
      const map = Object.assign({}, payload);
      delete map.tournamentId;
      entries = Object.keys(map).map(pid => ({ playerId: pid, handicap: Number(map[pid]) }));
    }
  }

  if (!entries.length) {
    console.error("❌ No handicap entries found in input");
    process.exit(1);
  }

  console.log(`📋 Applying handicaps for tournament: ${tournamentId} (${entries.length} entries)`);

  const tRef = db.collection("tournaments").doc(tournamentId);
  const tSnap = await tRef.get();
  if (!tSnap.exists) {
    console.error(`❌ Tournament not found: ${tournamentId}`);
    process.exit(1);
  }
  const tournament = tSnap.data() || {};

  const flattenRoster = (rosterByTier: any) => {
    if (!rosterByTier) return [] as string[];
    return Object.values(rosterByTier).flat();
  };

  const teamAIds = flattenRoster(tournament.teamA?.rosterByTier);
  const teamBIds = flattenRoster(tournament.teamB?.rosterByTier);

  const updates: Record<string, any> = {};
  const applied: Array<{ playerId: string; team: string; handicap: number }> = [];
  const skipped: string[] = [];

  for (const e of entries) {
    const pid = e.playerId;
    const h = Number(e.handicap);
    if (!pid) {
      console.warn("Skipping entry with missing playerId");
      continue;
    }
    if (!Number.isFinite(h)) {
      console.warn(`Skipping invalid handicap for ${pid}: ${e.handicap}`);
      skipped.push(pid);
      continue;
    }

    if (teamAIds.includes(pid)) {
      updates[`teamA.handicapByPlayer.${pid}`] = h;
      applied.push({ playerId: pid, team: "A", handicap: h });
    } else if (teamBIds.includes(pid)) {
      updates[`teamB.handicapByPlayer.${pid}`] = h;
      applied.push({ playerId: pid, team: "B", handicap: h });
    } else {
      console.warn(`Player ${pid} not found on either team for tournament ${tournamentId}; skipping`);
      skipped.push(pid);
    }
  }

  if (!Object.keys(updates).length) {
    console.log("No valid updates to apply. Exiting.");
    process.exit(0);
  }

  // Apply updates atomically
  await tRef.update(updates);
  console.log(`✅ Applied ${applied.length} handicap updates`);
  if (skipped.length) console.log(`Skipped ${skipped.length} entries: ${skipped.join(", ")}`);
}

// Parse args in the same style as other seed scripts
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const tournamentIndex = args.indexOf("--tournament");

if (inputIndex === -1 || !args[inputIndex + 1]) {
  console.log("Usage: npx ts-node scripts/seed-handicaps.ts --input data/update-handicaps.json [--tournament <tournamentId>]");
  process.exit(1);
}

const inputFile = args[inputIndex + 1];
const tournamentFlag = tournamentIndex !== -1 && args[tournamentIndex + 1] ? args[tournamentIndex + 1] : undefined;

seedHandicaps(inputFile, tournamentFlag)
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
