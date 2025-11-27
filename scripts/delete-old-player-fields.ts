import * as admin from "firebase-admin";
import * as path from "path";

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, "..", "service-account.json");
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function deleteOldFields() {
  const playersRef = db.collection("players");
  const snapshot = await playersRef.get();
  
  if (snapshot.empty) {
    console.log("No players found.");
    return;
  }
  
  let updated = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates: Record<string, admin.firestore.FieldValue> = {};
    
    if ("username" in data) {
      updates.username = admin.firestore.FieldValue.delete();
    }
    if ("tempPassword" in data) {
      updates.tempPassword = admin.firestore.FieldValue.delete();
    }
    
    if (Object.keys(updates).length > 0) {
      await doc.ref.update(updates);
      console.log(`✓ Cleaned ${doc.id}`);
      updated++;
    }
  }
  
  console.log(`\nDone! Updated ${updated} player docs.`);
}

deleteOldFields().catch(console.error);
