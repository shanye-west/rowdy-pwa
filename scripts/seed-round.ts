/**
 * Seed Round Script
 * 
 * Creates a round document in Firestore exactly as specified in JSON.
 * Run with: npx ts-node scripts/seed-round.ts --input data/round-template.json
 * Add --force to overwrite existing round.
 * 
 * Input JSON format (single round object):
 * {
 *   "id": "2025-rowdycup-day1",
 *   "tournamentId": "2025-rowdycup",
 *   "day": 1,
 *   "format": "twoManBestBall",
 *   "courseId": "courseName",
 *   "pointsValue": 1,
 *   "trackDrives": false,
 *   "locked": false,
 *   "matchIds": []
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

const VALID_FORMATS = ["twoManBestBall", "twoManShamble", "twoManScramble", "singles", null];

async function seedRound(inputFile: string, force: boolean) {
  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const round = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  console.log(`📋 Seeding round: ${round.id}\n`);

  // Validate
  const errors: string[] = [];
  if (!round.id) errors.push("Missing 'id'");
  if (!round.tournamentId) errors.push("Missing 'tournamentId'");
  if (round.format !== null && round.format !== undefined && !VALID_FORMATS.includes(round.format)) {
    errors.push(`Invalid 'format': ${round.format}. Valid: ${VALID_FORMATS.join(", ")}`);
  }

  if (errors.length > 0) {
    console.error("❌ Validation failed:\n");
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  const docRef = db.collection("rounds").doc(round.id);
  const existing = await docRef.get();

  if (existing.exists && !force) {
    console.log(`⏭️  Round '${round.id}' already exists. Use --force to overwrite.`);
    process.exit(0);
  }

  await docRef.set(round);
  console.log(`${existing.exists ? "🔄 Updated" : "✅ Created"} round: ${round.id}`);
  console.log(`\n⚡ Note: linkRoundToTournament Cloud Function will add this to tournament.roundIds`);
}

// Parse args
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const force = args.includes("--force");

if (inputIndex === -1 || !args[inputIndex + 1]) {
  console.log("Usage: npx ts-node scripts/seed-round.ts --input data/round-template.json [--force]");
  process.exit(1);
}

seedRound(args[inputIndex + 1], force)
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
