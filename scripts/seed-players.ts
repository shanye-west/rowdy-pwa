/**
 * Seed Players Script
 * 
 * Creates player documents in Firestore with usernames and temp passwords.
 * Run with: npx ts-node scripts/seed-players.ts --input players.json
 * 
 * Input JSON format:
 * [
 *   { "displayName": "Shane Peterson" },
 *   { "displayName": "John Smith" }
 * ]
 * 
 * Output: Creates players/{id} docs with:
 * - displayName: "Shane Peterson"
 * - username: "shanepeterson"
 * - tempPassword: "1234"
 */

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

// Initialize Firebase Admin (uses default credentials from GOOGLE_APPLICATION_CREDENTIALS env var)
// Or you can specify a service account key file
const serviceAccountPath = path.join(__dirname, "../service-account.json");

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  // Use default credentials (works in Cloud Functions or with gcloud auth)
  admin.initializeApp();
}

const db = admin.firestore();

type PlayerInput = {
  displayName: string;
};

type PlayerDoc = {
  displayName: string;
  username: string;
  tempPassword: string;
};

/**
 * Generate username from display name
 * "Shane Peterson" -> "shanepeterson"
 * Handles duplicates by appending numbers: "johnsmith", "johnsmith2", "johnsmith3"
 */
async function generateUsername(displayName: string, existingUsernames: Set<string>): Promise<string> {
  // Normalize: lowercase, remove non-alphanumeric, no spaces
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  
  // Check for duplicates
  let username = base;
  let counter = 2;
  
  while (existingUsernames.has(username)) {
    username = `${base}${counter}`;
    counter++;
  }
  
  existingUsernames.add(username);
  return username;
}

/**
 * Generate a unique document ID
 * Uses lowercase displayName with underscores: "shane_peterson"
 */
function generateDocId(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, ""); // Remove leading/trailing underscores
}

async function seedPlayers(inputFile: string) {
  // Read input file
  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const players: PlayerInput[] = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  console.log(`📋 Found ${players.length} players to seed`);

  // Get existing usernames to check for duplicates
  const existingUsernames = new Set<string>();
  const existingSnap = await db.collection("players").get();
  existingSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (data.username) {
      existingUsernames.add(data.username);
    }
  });
  console.log(`📊 Found ${existingUsernames.size} existing usernames`);

  // Track created players for output
  const createdPlayers: { displayName: string; username: string; docId: string }[] = [];
  const skippedPlayers: string[] = [];

  // Create batch write
  const batch = db.batch();

  for (const player of players) {
    const docId = generateDocId(player.displayName);
    const docRef = db.collection("players").doc(docId);

    // Check if player already exists
    const existingDoc = await docRef.get();
    if (existingDoc.exists) {
      console.log(`⏭️  Skipping ${player.displayName} (already exists as ${docId})`);
      skippedPlayers.push(player.displayName);
      continue;
    }

    const username = await generateUsername(player.displayName, existingUsernames);
    
    const playerDoc: PlayerDoc = {
      displayName: player.displayName,
      username,
      tempPassword: "1234",
    };

    batch.set(docRef, playerDoc);
    createdPlayers.push({ displayName: player.displayName, username, docId });
    console.log(`✅ ${player.displayName} -> username: ${username}, id: ${docId}`);
  }

  // Commit batch
  if (createdPlayers.length > 0) {
    await batch.commit();
    console.log(`\n🎉 Created ${createdPlayers.length} players`);
  }

  if (skippedPlayers.length > 0) {
    console.log(`\n⏭️  Skipped ${skippedPlayers.length} existing players`);
  }

  // Output summary
  console.log("\n" + "=".repeat(50));
  console.log("PLAYER CREDENTIALS (share with players)");
  console.log("=".repeat(50));
  console.log("\nAll players use password: 1234\n");
  
  for (const p of createdPlayers) {
    console.log(`${p.displayName}`);
    console.log(`  Username: ${p.username}`);
    console.log("");
  }

  // Write credentials to file
  const outputPath = path.join(path.dirname(inputPath), "credentials.txt");
  let output = "PLAYER LOGIN CREDENTIALS\n";
  output += "========================\n\n";
  output += "All players use password: 1234\n\n";
  output += "After logging in with your username, you'll be prompted to set up your email and permanent password.\n\n";
  output += "-".repeat(40) + "\n\n";
  
  for (const p of createdPlayers) {
    output += `${p.displayName}\n`;
    output += `  Username: ${p.username}\n\n`;
  }

  fs.writeFileSync(outputPath, output);
  console.log(`\n📄 Credentials saved to: ${outputPath}`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");

if (inputIndex === -1 || !args[inputIndex + 1]) {
  console.log("Usage: npx ts-node scripts/seed-players.ts --input players.json");
  console.log("\nExample players.json:");
  console.log('[');
  console.log('  { "displayName": "Shane Peterson" },');
  console.log('  { "displayName": "John Smith" }');
  console.log(']');
  process.exit(1);
}

const inputFile = args[inputIndex + 1];

seedPlayers(inputFile)
  .then(() => {
    console.log("\n✅ Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
