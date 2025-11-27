/**
 * Seed Course Script
 * 
 * Creates a course document in Firestore exactly as specified in JSON.
 * Run with: npx ts-node scripts/seed-course.ts --input data/course-template.json
 * Add --force to overwrite existing course.
 * 
 * Input JSON format (single course object):
 * {
 *   "id": "courseName",
 *   "name": "Course Name",
 *   "tees": "Blue",
 *   "rating": 71.5,
 *   "slope": 131,
 *   "par": 72,
 *   "holes": [ { "number": 1, "par": 4, "hcpIndex": 7, "yards": 380 }, ... ]
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

async function seedCourse(inputFile: string, force: boolean) {
  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const course = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  console.log(`📋 Seeding course: ${course.name || course.id}\n`);

  // Validate
  const errors: string[] = [];
  if (!course.id) errors.push("Missing 'id'");
  if (!course.name) errors.push("Missing 'name'");
  if (typeof course.rating !== "number") errors.push("Missing or invalid 'rating'");
  if (typeof course.slope !== "number") errors.push("Missing or invalid 'slope'");
  if (typeof course.par !== "number") errors.push("Missing or invalid 'par'");
  if (!Array.isArray(course.holes) || course.holes.length !== 18) {
    errors.push("'holes' must be an array of 18 holes");
  }

  if (errors.length > 0) {
    console.error("❌ Validation failed:\n");
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  const docRef = db.collection("courses").doc(course.id);
  const existing = await docRef.get();

  if (existing.exists && !force) {
    console.log(`⏭️  Course '${course.id}' already exists. Use --force to overwrite.`);
    process.exit(0);
  }

  await docRef.set(course);
  console.log(`${existing.exists ? "🔄 Updated" : "✅ Created"} course: ${course.id}`);
}

// Parse args
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const force = args.includes("--force");

if (inputIndex === -1 || !args[inputIndex + 1]) {
  console.log("Usage: npx ts-node scripts/seed-course.ts --input data/course-template.json [--force]");
  process.exit(1);
}

seedCourse(args[inputIndex + 1], force)
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
