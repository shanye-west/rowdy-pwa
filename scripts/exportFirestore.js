/**
 * exportFirestore.js
 * 
 * Exports ALL collections from Firestore to a JSON snapshot file.
 * 
 * Usage:
 *   1. Place your service account key at: scripts/serviceAccountKey.json
 *   2. Run: npm run export (from the scripts folder)
 *   3. Output: scripts/data/firestore-snapshot.json
 * 
 * The script automatically discovers all top-level collections and exports
 * all documents within each. Firestore Timestamps are converted to ISO strings.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// === CONFIGURATION ===
// The export script MUST use the production service account at the repository root:
// `service-account.json`. This prevents accidentally exporting from a non-prod project.
const ROOT_SERVICE_ACCOUNT = join(__dirname, '..', 'service-account.json');
const OUTPUT_PATH = join(__dirname, 'data', 'firestore-snapshot.json');

// Only accept the root prod key for export. Fail explicitly otherwise.
let SERVICE_ACCOUNT_PATH = null;
if (existsSync(ROOT_SERVICE_ACCOUNT)) {
  SERVICE_ACCOUNT_PATH = ROOT_SERVICE_ACCOUNT;
}

// === HELPERS ===

/**
 * Recursively converts Firestore Timestamps to ISO strings for JSON serialization.
 */
function serializeValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  
  // Handle Firestore Timestamp
  if (value instanceof Timestamp) {
    return { __type: 'Timestamp', value: value.toDate().toISOString() };
  }
  
  // Handle Date objects
  if (value instanceof Date) {
    return { __type: 'Timestamp', value: value.toISOString() };
  }
  
  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  
  // Handle plain objects
  if (typeof value === 'object') {
    const serialized = {};
    for (const [k, v] of Object.entries(value)) {
      serialized[k] = serializeValue(v);
    }
    return serialized;
  }
  
  // Primitives pass through
  return value;
}

// === MAIN ===

async function main() {
  console.log('=== Firestore Export Script ===\n');

  // Check for service account key — must be the production key at repo root
  if (!SERVICE_ACCOUNT_PATH) {
    console.error('❌ Production service account key not found.');
    console.error('\nThis export script ONLY accepts the production key at the repository root:');
    console.error('   service-account.json');
    console.error('\nPlace your PROD service account key at that path and re-run the script.');
    process.exit(1);
  }

  // Initialize Firebase Admin
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  console.log(`Using service account key: ${SERVICE_ACCOUNT_PATH}`);
  
  initializeApp({
    credential: cert(serviceAccount),
  });

  const db = getFirestore();
  
  console.log(`📦 Connected to project: ${serviceAccount.project_id}\n`);

  // Discover all top-level collections
  const collections = await db.listCollections();
  const collectionNames = collections.map(c => c.id);
  
  if (collectionNames.length === 0) {
    console.log('⚠️  No collections found in this Firestore database.');
    process.exit(0);
  }

  console.log(`📂 Found ${collectionNames.length} collections: ${collectionNames.join(', ')}\n`);

  // Export each collection
  const snapshot = {};
  let totalDocs = 0;

  for (const collectionName of collectionNames) {
    const collectionRef = db.collection(collectionName);
    const docs = await collectionRef.get();
    
    snapshot[collectionName] = {};
    
    for (const doc of docs.docs) {
      snapshot[collectionName][doc.id] = serializeValue(doc.data());
      totalDocs++;
    }
    
    console.log(`   ✓ ${collectionName}: ${docs.size} documents`);
  }

  // Write to file
  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2));
  
  console.log(`\n✅ Export complete!`);
  console.log(`   Total: ${totalDocs} documents across ${collectionNames.length} collections`);
  console.log(`   Output: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('❌ Export failed:', err);
  process.exit(1);
});
