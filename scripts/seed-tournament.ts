/**
 * Seed Tournament Script
 * 
 * Creates a tournament document in Firestore exactly as specified in JSON.
 * Run with: npx ts-node scripts/seed-tournament.ts --input data/tournament-template.json
 * Add --force to overwrite existing tournament.
 * 
 * Input JSON format (single tournament object):
 * {
 *   "id": "2025-rowdycup",
 *   "year": 2025,
 *   "name": "Rowdy Cup 2025",
 *   "series": "rowdyCup",
 *   "active": true,
 *   "teamA": { "id": "teamA", "name": "...", "rosterByTier": {...}, "handicapByPlayer": {...} },
 *   "teamB": { ... }
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

async function seedTournament(inputFile: string, force: boolean) {
  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const tournament = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  console.log(`📋 Seeding tournament: ${tournament.name || tournament.id}\n`);

  // Validate
  const errors: string[] = [];
  if (!tournament.id) errors.push("Missing 'id'");
  if (!tournament.name) errors.push("Missing 'name'");
  if (typeof tournament.year !== "number") errors.push("Missing or invalid 'year'");
  if (!tournament.series) errors.push("Missing 'series'");
  if (typeof tournament.active !== "boolean") errors.push("Missing or invalid 'active'");
  if (!tournament.teamA?.id) errors.push("Missing 'teamA.id'");
  if (!tournament.teamA?.name) errors.push("Missing 'teamA.name'");
  if (!tournament.teamA?.captainId) errors.push("Missing 'teamA.captainId'");
  if (!tournament.teamA?.coCaptainId) errors.push("Missing 'teamA.coCaptainId'");
  if (!tournament.teamB?.id) errors.push("Missing 'teamB.id'");
  if (!tournament.teamB?.name) errors.push("Missing 'teamB.name'");
  if (!tournament.teamB?.captainId) errors.push("Missing 'teamB.captainId'");
  if (!tournament.teamB?.coCaptainId) errors.push("Missing 'teamB.coCaptainId'");

  if (errors.length > 0) {
    console.error("❌ Validation failed:\n");
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  const docRef = db.collection("tournaments").doc(tournament.id);
  const existing = await docRef.get();

  if (existing.exists && !force) {
    console.log(`⏭️  Tournament '${tournament.id}' already exists. Use --force to overwrite.`);
    process.exit(0);
  }

  await docRef.set(tournament);
  console.log(`${existing.exists ? "🔄 Updated" : "✅ Created"} tournament: ${tournament.id}`);
}

// Parse args
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const force = args.includes("--force");

if (inputIndex === -1 || !args[inputIndex + 1]) {
  console.log("Usage: npx ts-node scripts/seed-tournament.ts --input data/tournament-template.json [--force]");
  process.exit(1);
}

seedTournament(args[inputIndex + 1], force)
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
