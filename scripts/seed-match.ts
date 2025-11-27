/**
 * Seed Match Script
 * 
 * Creates a match document in Firestore exactly as specified in JSON.
 * Run with: npx ts-node scripts/seed-match.ts --input data/match-singles-template.json
 * Add --force to overwrite existing match.
 * 
 * Input JSON format (single match object):
 * {
 *   "id": "2025-rowdycup-day1-match1",
 *   "roundId": "2025-rowdycup-day1",
 *   "tournamentId": "2025-rowdycup",
 *   "courseHandicaps": [9, 14, 7, 17],
 *   "teamAPlayers": [
 *     { "playerId": "pPlayer1", "strokesReceived": [0,1,0,...] }
 *   ],
 *   "teamBPlayers": [...],
 *   "holes": {},
 *   "status": { "leader": null, "margin": 0, "thru": 0, "dormie": false, "closed": false },
 *   "result": {}
 * }
 */

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, "../service-account.json");

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  admin.initializeApp();
}

const db = admin.firestore();

async function seedMatch(inputFile: string, force: boolean) {
  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const match = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  console.log(`📋 Seeding match: ${match.id}\n`);

  // Validate
  const errors: string[] = [];
  if (!match.id) errors.push("Missing 'id'");
  if (!match.roundId) errors.push("Missing 'roundId'");
  if (!match.tournamentId) errors.push("Missing 'tournamentId'");
  if (!Array.isArray(match.teamAPlayers) || match.teamAPlayers.length === 0) {
    errors.push("Missing or empty 'teamAPlayers'");
  }
  if (!Array.isArray(match.teamBPlayers) || match.teamBPlayers.length === 0) {
    errors.push("Missing or empty 'teamBPlayers'");
  }

  // Validate strokesReceived arrays
  const allPlayers = [...(match.teamAPlayers || []), ...(match.teamBPlayers || [])];
  for (const player of allPlayers) {
    if (!player.playerId) {
      errors.push("Player missing 'playerId'");
    }
    if (!Array.isArray(player.strokesReceived) || player.strokesReceived.length !== 18) {
      errors.push(`Player ${player.playerId}: 'strokesReceived' must be array of 18`);
    }
  }

  if (errors.length > 0) {
    console.error("❌ Validation failed:\n");
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  const docRef = db.collection("matches").doc(match.id);
  const existing = await docRef.get();

  if (existing.exists && !force) {
    console.log(`⏭️  Match '${match.id}' already exists. Use --force to overwrite.`);
    process.exit(0);
  }

  await docRef.set(match);
  console.log(`${existing.exists ? "🔄 Updated" : "✅ Created"} match: ${match.id}`);
  console.log(`\n⚡ Note: seedMatchBoilerplate Cloud Function will initialize the holes structure`);
}

// Parse args
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const force = args.includes("--force");

if (inputIndex === -1 || !args[inputIndex + 1]) {
  console.log("Usage: npx ts-node scripts/seed-match.ts --input data/match-singles-template.json [--force]");
  console.log("\nMatch templates available:");
  console.log("  - match-singles-template.json (1v1)");
  console.log("  - match-twoManBestBall-template.json (2v2 with strokes)");
  console.log("  - match-twoManShamble-template.json (2v2 gross)");
  console.log("  - match-twoManScramble-template.json (2v2 gross)");
  process.exit(1);
}

seedMatch(args[inputIndex + 1], force)
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
