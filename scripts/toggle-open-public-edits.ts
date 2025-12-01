/**
 * Toggle `openPublicEdits` on a tournament document.
 *
 * Usage:
 *   npx ts-node scripts/toggle-open-public-edits.ts <tournamentId> <true|false>
 *
 * Requires `service-account.json` in the repo root (same as other seed scripts).
 */

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

const args = process.argv.slice(2);
const tournamentId = args[0];
const value = args[1];

if (!tournamentId || (value !== "true" && value !== "false")) {
  console.error("Usage: npx ts-node scripts/toggle-open-public-edits.ts <tournamentId> <true|false>");
  process.exit(1);
}

const serviceAccountPath = path.join(__dirname, "../service-account.json");
if (fs.existsSync(serviceAccountPath)) {
  const svc = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(svc as any) });
} else {
  // fallback to ADC
  admin.initializeApp();
}

const db = admin.firestore();

async function main() {
  const flag = value === "true";
  const ref = db.collection("tournaments").doc(tournamentId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error("Tournament not found:", tournamentId);
    process.exit(1);
  }
  await ref.update({ openPublicEdits: flag });
  console.log(`Set tournaments/${tournamentId}.openPublicEdits = ${flag}`);
}

main().catch(err => { console.error(err); process.exit(1); });
