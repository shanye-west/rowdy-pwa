import * as admin from "firebase-admin";
import * as path from "path";
import * as fs from "fs";

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, "..", "service-account.json");
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

type PlayerEmail = {
  email: string;
  playerId: string;
};

/**
 * Keep the `playerId` custom claim in step with authUid (see
 * functions/src/helpers/adminAuth.ts): the callables trust that claim instead
 * of querying players by authUid, so a relink must move it, or the previously
 * linked account would keep acting as this player.
 */
async function movePlayerIdClaim(newUid: string, playerId: string, previousUid: unknown) {
  const setClaim = async (uid: string, value: string | null) => {
    const user = await auth.getUser(uid);
    const claims: Record<string, unknown> = { ...(user.customClaims ?? {}) };
    if (value) claims.playerId = value;
    else delete claims.playerId;
    await auth.setCustomUserClaims(uid, Object.keys(claims).length > 0 ? claims : null);
  };
  await setClaim(newUid, playerId);
  if (typeof previousUid === "string" && previousUid && previousUid !== newUid) {
    await setClaim(previousUid, null).catch(() => { /* account may be gone */ });
  }
}

async function bulkLinkAuth() {
  // Get input file from args
  const args = process.argv.slice(2);
  const inputArg = args.find(a => a.startsWith("--input="));
  
  if (!inputArg) {
    console.log("Usage: npx ts-node bulk-link-auth.ts --input=data/player-emails.json");
    console.log("\nThis links Firebase Auth users to player docs in bulk.");
    console.log("\nJSON format:");
    console.log('[');
    console.log('  { "email": "player@email.com", "playerId": "pPlayerId" },');
    console.log('  ...');
    console.log(']');
    return;
  }
  
  const inputPath = inputArg.split("=")[1];
  const fullPath = path.join(__dirname, inputPath);
  
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    return;
  }
  
  const players: PlayerEmail[] = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  
  console.log(`Processing ${players.length} players...\n`);
  
  let success = 0;
  let failed = 0;
  let skipped = 0;
  
  for (const { email, playerId } of players) {
    // Skip placeholder emails
    if (email.includes("@email.com") || !email.includes("@")) {
      console.log(`⏭ Skipped ${playerId} - placeholder email`);
      skipped++;
      continue;
    }
    
    try {
      // Get the auth user by email
      const authUser = await auth.getUserByEmail(email);
      
      // Check if player doc exists
      const playerRef = db.collection("players").doc(playerId);
      const playerDoc = await playerRef.get();
      
      if (!playerDoc.exists) {
        console.log(`✗ ${playerId} - player doc not found`);
        failed++;
        continue;
      }
      
      // Keep email private and remove any legacy public copy atomically.
      // Merge the profile so existing scouting notes are preserved.
      const batch = db.batch();
      batch.update(playerRef, {
        authUid: authUser.uid,
        email: admin.firestore.FieldValue.delete(),
      });
      batch.set(playerRef.collection("private").doc("profile"), {
        email: authUser.email ?? email,
      }, { merge: true });
      await batch.commit();
      await movePlayerIdClaim(authUser.uid, playerId, playerDoc.data()?.authUid);
      
      console.log(`✓ ${playerId} → ${authUser.uid}`);
      success++;
    } catch (e: any) {
      if (e.code === "auth/user-not-found") {
        console.log(`✗ ${playerId} - no auth user for ${email}`);
      } else {
        console.log(`✗ ${playerId} - ${e.message}`);
      }
      failed++;
    }
  }
  
  console.log(`\n========================================`);
  console.log(`Done! Success: ${success}, Failed: ${failed}, Skipped: ${skipped}`);
  
  if (failed > 0) {
    console.log(`\nNote: Failed entries may need auth accounts created first.`);
    console.log(`Go to Firebase Console → Authentication → Add user`);
  }
}

bulkLinkAuth().catch(console.error);
