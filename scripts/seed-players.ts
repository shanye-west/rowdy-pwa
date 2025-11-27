/**
 * Seed Players Script
 * 
 * Creates player documents in Firestore exactly as specified in JSON.
 * Run with: npx ts-node scripts/seed-players.ts --input data/players-template.json
 * Add --force to overwrite existing players.
 * 
 * Input JSON format (array of players):
 * [
 *   {
 *     "id": "pShanePeterson",
 *     "displayName": "Shane Peterson",
 *     "username": "shanepeterson",
 *     "tempPassword": "1234"
 *   }
 * ]
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

type PlayerInput = {
  id: string;
  displayName: string;
  username: string;
  tempPassword: string;
};

async function seedPlayers(inputFile: string, force: boolean) {
  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const players: PlayerInput[] = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  console.log(`📋 Found ${players.length} players to seed\n`);

  // Validate
  const errors: string[] = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p.id) errors.push(`Player ${i}: missing 'id'`);
    if (!p.displayName) errors.push(`Player ${i}: missing 'displayName'`);
    if (!p.username) errors.push(`Player ${i}: missing 'username'`);
    if (!p.tempPassword) errors.push(`Player ${i}: missing 'tempPassword'`);
  }

  if (errors.length > 0) {
    console.error("❌ Validation failed:\n");
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  const batch = db.batch();
  let created = 0, updated = 0, skipped = 0;

  for (const player of players) {
    const docRef = db.collection("players").doc(player.id);
    const existing = await docRef.get();

    if (existing.exists && !force) {
      console.log(`⏭️  Skipping ${player.displayName} (exists)`);
      skipped++;
      continue;
    }

    batch.set(docRef, {
      id: player.id,
      displayName: player.displayName,
      username: player.username,
      tempPassword: player.tempPassword,
    });

    if (existing.exists) {
      console.log(`🔄 Updating ${player.displayName}`);
      updated++;
    } else {
      console.log(`✅ Creating ${player.displayName}`);
      created++;
    }
  }

  if (created > 0 || updated > 0) {
    await batch.commit();
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Created: ${created} | Updated: ${updated} | Skipped: ${skipped}`);
}

// Parse args
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const force = args.includes("--force");

if (inputIndex === -1 || !args[inputIndex + 1]) {
  console.log("Usage: npx ts-node scripts/seed-players.ts --input data/players-template.json [--force]");
  process.exit(1);
}

seedPlayers(args[inputIndex + 1], force)
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
