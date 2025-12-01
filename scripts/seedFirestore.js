/**
 * seedFirestore.js
 * 
 * Seeds Firestore from a JSON snapshot file.
 * 
 * SAFETY: This script will ONLY run if the target Firestore database is COMPLETELY EMPTY.
 * If any documents exist in any collection, the script will exit with an error.
 * You must manually delete all data in the Firebase Console before running this.
 * 
 * Usage:
 *   1. Manually switch your serviceAccountKey.json to point to your DEV project
 *   2. Manually delete all data in the dev Firestore (Firebase Console)
 *   3. Run: npm run seed (from the scripts folder)
 *   4. Input: scripts/data/firestore-snapshot.json
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// === CONFIGURATION ===
// The seed script MUST use the dev service account at the repository root:
// `dev-service-account.json`. This prevents accidentally seeding a prod DB.
const DEV_SERVICE_ACCOUNT = join(__dirname, '..', 'dev-service-account.json');
const SNAPSHOT_PATH = join(__dirname, 'data', 'firestore-snapshot.json');

// Only accept the root dev key for seeding. Fail explicitly otherwise.
let SERVICE_ACCOUNT_PATH = null;
if (existsSync(DEV_SERVICE_ACCOUNT)) {
  SERVICE_ACCOUNT_PATH = DEV_SERVICE_ACCOUNT;
}

// === HELPERS ===

/**
 * Recursively converts serialized Timestamps back to Firestore Timestamps.
 */
function deserializeValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  
  // Handle serialized Timestamp
  if (typeof value === 'object' && value.__type === 'Timestamp' && value.value) {
    return Timestamp.fromDate(new Date(value.value));
  }
  
  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }
  
  // Handle plain objects
  if (typeof value === 'object') {
    const deserialized = {};
    for (const [k, v] of Object.entries(value)) {
      deserialized[k] = deserializeValue(v);
    }
    return deserialized;
  }
  
  // Primitives pass through
  return value;
}

// === MAIN ===

async function main() {
  console.log('=== Firestore Seed Script ===\n');

  // Check for service account key — must be the dev key at repo root
  if (!SERVICE_ACCOUNT_PATH) {
    console.error('❌ Dev service account key not found.');
    console.error('\nThis seed script ONLY accepts the dev key at the repository root:');
    console.error('   dev-service-account.json');
    console.error('\nPlace your DEV service account key at that path and re-run the script.');
    process.exit(1);
  }

  // Check for snapshot file
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(`❌ Snapshot file not found at:\n   ${SNAPSHOT_PATH}`);
    console.error('\nRun the export script first: npm run export');
    process.exit(1);
  }

  // Initialize Firebase Admin
  let serviceAccount;
  try {
    const raw = readFileSync(SERVICE_ACCOUNT_PATH, 'utf8');
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Failed to read or parse dev service account at: ${SERVICE_ACCOUNT_PATH}`);
    console.error('Make sure the file contains the JSON key you downloaded from the Firebase Console.');
    process.exit(1);
  }
  console.log(`Using service account key: ${SERVICE_ACCOUNT_PATH}`);
  
  initializeApp({
    credential: cert(serviceAccount),
  });

  const db = getFirestore();
  const projectId = serviceAccount.project_id;
  
  console.log(`📦 Connected to project: ${projectId}\n`);
  
  // === SAFETY CHECK: Ensure database is EMPTY ===
  console.log('🔒 Running safety check...');
  
  const existingCollections = await db.listCollections();
  
  for (const collection of existingCollections) {
    const snapshot = await collection.limit(1).get();
    if (!snapshot.empty) {
      console.error(`\n❌ SAFETY CHECK FAILED!`);
      console.error(`   Found existing data in collection: "${collection.id}"`);
      console.error(`\n   This script only runs on an EMPTY database to prevent accidents.`);
      console.error(`   Please manually delete all data in the Firebase Console first.`);
      console.error(`\n   Target project: ${projectId}`);
      console.error(`   Console URL: https://console.firebase.google.com/project/${projectId}/firestore`);
      process.exit(1);
    }
  }
  
  console.log('   ✓ Database is empty, safe to proceed.\n');

  // Load snapshot
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const collectionNames = Object.keys(snapshot);
  
  if (collectionNames.length === 0) {
    console.log('⚠️  Snapshot file is empty, nothing to seed.');
    process.exit(0);
  }

  console.log(`📂 Seeding ${collectionNames.length} collections: ${collectionNames.join(', ')}\n`);

  // Seed each collection
  let totalDocs = 0;

  for (const collectionName of collectionNames) {
    const collectionData = snapshot[collectionName];
    const docIds = Object.keys(collectionData);
    
    for (const docId of docIds) {
      const docData = deserializeValue(collectionData[docId]);
      await db.collection(collectionName).doc(docId).set(docData);
      totalDocs++;
    }
    
    console.log(`   ✓ ${collectionName}: ${docIds.length} documents`);
  }

  console.log(`\n✅ Seed complete!`);
  console.log(`   Total: ${totalDocs} documents across ${collectionNames.length} collections`);
  console.log(`   Target project: ${projectId}`);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
