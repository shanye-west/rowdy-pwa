#!/usr/bin/env node
/**
 * Expands _TestRowdyCup2026 to a full 12v12 roster and creates Firebase Auth
 * email/password accounts for every test player so you can log in as them.
 *
 * - Creates 16 new _Test* player docs (total 24 players, 12 per team)
 * - Creates Firebase Auth account for EACH test player: testname@rowdycup.com / Rowdy2026!
 * - Links authUid + email onto each player doc
 * - Updates the tournament teamA/teamB to the full 12-player roster (3 per tier)
 * - Sets openPublicEdits:true on the test tournament (lets any logged-in test user enter scores)
 *
 * Usage:
 *   node setup-test-auth-2026.js            # dry run
 *   node setup-test-auth-2026.js --commit   # write to prod
 */

const https = require("https");
const os = require("os");

const PROJECT = "rowdy-pwa";
const API_KEY = "AIzaSyAt561vHNjQZKEAbQbLYTbg15EfODb3o4k"; // web API key (public)
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH_BASE = "https://identitytoolkit.googleapis.com/v1";
const COMMIT = process.argv.includes("--commit");
const TID = "_TestRowdyCup2026";
const PASSWORD = "Rowdy2026!";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function httpJson(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: headers || {} }, (res) => {
      let d = "";
      res.on("data", (x) => (d += x));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve({ _raw: d }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function mintToken() {
  const c = require(os.homedir() + "/.config/configstore/firebase-tools.json");
  return httpJson(
    "https://oauth2.googleapis.com/token",
    "POST",
    new URLSearchParams({
      client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
      client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
      refresh_token: c.tokens.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
    { "Content-Type": "application/x-www-form-urlencoded" }
  ).then((j) => {
    if (!j.access_token) throw new Error("token mint failed: " + JSON.stringify(j).slice(0, 200));
    return j.access_token;
  });
}

// ---------------------------------------------------------------------------
// Firestore REST helpers
// ---------------------------------------------------------------------------
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === "object") {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = toValue(v[k]);
    return { mapValue: { fields } };
  }
  throw new Error("cannot encode " + typeof v);
}

async function patchDoc(token, path, obj, maskFields) {
  const fields = {};
  for (const k of Object.keys(obj)) fields[k] = toValue(obj[k]);
  const qs = maskFields ? "?" + maskFields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&") : "";
  const res = await httpJson(`${BASE}/${path}${qs}`, "PATCH", JSON.stringify({ fields }), {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
  });
  if (res.error) throw new Error(`patchDoc ${path}: ${JSON.stringify(res.error)}`);
  return res;
}

// ---------------------------------------------------------------------------
// Firebase Auth helpers (Identity Toolkit v1 - web SDK REST)
// ---------------------------------------------------------------------------
async function createAuthUser(email) {
  const res = await httpJson(
    `${AUTH_BASE}/accounts:signUp?key=${API_KEY}`,
    "POST",
    { email, password: PASSWORD, returnSecureToken: true },
    { "Content-Type": "application/json" }
  );
  if (res.error) {
    if (res.error.message === "EMAIL_EXISTS") return { exists: true, email };
    throw new Error(`createAuthUser ${email}: ${JSON.stringify(res.error)}`);
  }
  return { uid: res.localId, email: res.email };
}

async function lookupAuthByEmail(email) {
  const res = await httpJson(
    `${AUTH_BASE}/accounts:lookup?key=${API_KEY}`,
    "POST",
    { email: [email] },
    { "Content-Type": "application/json" }
  );
  if (res.error || !res.users || res.users.length === 0) return null;
  return res.users[0].localId;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Player roster  (all 24 test players)
// ---------------------------------------------------------------------------
// Tiers: A=3, B=3, C=3, D=3 per team
// Email pattern: test{id-lowercased}@rowdycup.com  (strip underscores and "Test")
function emailFor(id) {
  // "_TestJPSaar" -> "testjpsaar@rowdycup.com"
  return "test" + id.replace(/^_Test/, "").toLowerCase() + "@rowdycup.com";
}

const HANDICAPS = {
  // existing
  _TestJPSaar: 3.2, _TestShanePeterson: 6.3, _TestLouMazzarese: 7.8, _TestJasonDugan: 11.3,
  _TestSteveSloan: 10.2, _TestJakeFabozzi: 8.1, _TestRyanBenko: 14.1, _TestRyanHerndon: 14.7,
  // new team A
  _TestAlexAce: 2.1, _TestBobLinks: 4.8, _TestCarlaFair: 6.9, _TestDanaBogey: 9.4,
  _TestEdEagle: 8.5, _TestFranBirdie: 12.0, _TestGlenPar: 13.6, _TestHeidichip: 16.2,
  // new team B
  _TestIanDrive: 1.9, _TestJuliaGreen: 5.5, _TestKevinHook: 7.2, _TestLisaPutt: 10.8,
  _TestMikeSand: 9.1, _TestNormaRough: 11.5, _TestOscarFlag: 15.0, _TestPeggyWater: 17.3,
};

// new players to create (existing 8 are already in DB)
const NEW_PLAYERS = [
  { id: "_TestAlexAce", displayName: "Alex AceTest" },
  { id: "_TestBobLinks", displayName: "Bob LinksTest" },
  { id: "_TestCarlaFair", displayName: "Carla FairTest" },
  { id: "_TestDanaBogey", displayName: "Dana BogeyTest" },
  { id: "_TestEdEagle", displayName: "Ed EagleTest" },
  { id: "_TestFranBirdie", displayName: "Fran BirdieTest" },
  { id: "_TestGlenPar", displayName: "Glen ParTest" },
  { id: "_TestHeidichip", displayName: "Heidi ChipTest" },
  { id: "_TestIanDrive", displayName: "Ian DriveTest" },
  { id: "_TestJuliaGreen", displayName: "Julia GreenTest" },
  { id: "_TestKevinHook", displayName: "Kevin HookTest" },
  { id: "_TestLisaPutt", displayName: "Lisa PuttTest" },
  { id: "_TestMikeSand", displayName: "Mike SandTest" },
  { id: "_TestNormaRough", displayName: "Norma RoughTest" },
  { id: "_TestOscarFlag", displayName: "Oscar FlagTest" },
  { id: "_TestPeggyWater", displayName: "Peggy WaterTest" },
];

const ALL_PLAYERS = [
  // existing
  { id: "_TestJPSaar", displayName: "JP SaarTest" },
  { id: "_TestShanePeterson", displayName: "Shane PetersonTest" },
  { id: "_TestLouMazzarese", displayName: "Lou MazzareseTest" },
  { id: "_TestJasonDugan", displayName: "Jason DuganTest" },
  { id: "_TestSteveSloan", displayName: "Steve SloanTest" },
  { id: "_TestJakeFabozzi", displayName: "Jake FabozziTest" },
  { id: "_TestRyanBenko", displayName: "Ryan BenkoTest" },
  { id: "_TestRyanHerndon", displayName: "Ryan HerndonTest" },
  ...NEW_PLAYERS,
];

// 12-player rosters by tier (A=3, B=3, C=3, D=3)
const ROSTER_A = {
  A: ["_TestJPSaar", "_TestAlexAce", "_TestIanDrive"].slice(0, 0).concat(["_TestJPSaar", "_TestAlexAce", "_TestBobLinks"]).slice(0, 3),
  B: ["_TestShanePeterson", "_TestCarlaFair", "_TestDanaBogey"],
  C: ["_TestLouMazzarese", "_TestEdEagle", "_TestFranBirdie"],
  D: ["_TestJasonDugan", "_TestGlenPar", "_TestHeidichip"],
};
const ROSTER_B = {
  A: ["_TestRyanBenko", "_TestIanDrive", "_TestJuliaGreen"],
  B: ["_TestJakeFabozzi", "_TestKevinHook", "_TestLisaPutt"],
  C: ["_TestSteveSloan", "_TestMikeSand", "_TestNormaRough"],
  D: ["_TestRyanHerndon", "_TestOscarFlag", "_TestPeggyWater"],
};

function hbp(rosterByTier) {
  const o = {};
  for (const ids of Object.values(rosterByTier)) for (const id of ids) o[id] = HANDICAPS[id];
  return o;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const token = await mintToken();

  // ---- 1. Print roster summary
  console.log(`\n=== Test tournament: ${TID} ===`);
  console.log(`Password for ALL test accounts: ${PASSWORD}\n`);
  console.log("TEAM A — Test Aces (12 players):");
  for (const [tier, ids] of Object.entries(ROSTER_A)) {
    for (const id of ids) console.log(`  [${tier}] ${id.padEnd(22)} ${emailFor(id)}`);
  }
  console.log("\nTEAM B — Test Birdies (12 players):");
  for (const [tier, ids] of Object.entries(ROSTER_B)) {
    for (const id of ids) console.log(`  [${tier}] ${id.padEnd(22)} ${emailFor(id)}`);
  }

  if (!COMMIT) {
    console.log("\nDRY RUN — no writes. Re-run with --commit to apply.\n");
    return;
  }

  // ---- 2. Create new player docs
  console.log("\n[1/4] Creating new player docs...");
  for (const p of NEW_PLAYERS) {
    await patchDoc(token, `players/${p.id}`, { id: p.id, displayName: p.displayName, _testSeed: true });
    console.log(`  ✅ created ${p.id}`);
    await sleep(50);
  }

  // ---- 3. Create / resolve Auth accounts + link to player docs
  console.log("\n[2/4] Creating Firebase Auth accounts and linking to player docs...");
  for (const p of ALL_PLAYERS) {
    const email = emailFor(p.id);
    let uid;
    const created = await createAuthUser(email);
    if (created.exists) {
      uid = await lookupAuthByEmail(email);
      if (!uid) { console.log(`  ⚠️  ${email} exists but lookup failed — skipping`); continue; }
      console.log(`  ↩️  ${email} already exists (uid ${uid})`);
    } else {
      uid = created.uid;
      console.log(`  ✅ created ${email} (uid ${uid})`);
    }
    await patchDoc(token, `players/${p.id}`, { authUid: uid, email }, ["authUid", "email"]);
    await sleep(100);
  }

  // ---- 4. Update tournament roster + openPublicEdits
  console.log("\n[3/4] Updating tournament roster to 12v12...");
  const tournamentPatch = {
    totalPointsAvailable: 10,
    openPublicEdits: true, // any logged-in test user can enter scores
    teamA: {
      id: "teamA", name: "Test Aces", logo: "", color: "#1e3a5f",
      captainId: "_TestShanePeterson", coCaptainId: "_TestJPSaar",
      rosterByTier: ROSTER_A,
      handicapByPlayer: hbp(ROSTER_A),
    },
    teamB: {
      id: "teamB", name: "Test Birdies", logo: "", color: "#8b0000",
      captainId: "_TestSteveSloan", coCaptainId: "_TestRyanBenko",
      rosterByTier: ROSTER_B,
      handicapByPlayer: hbp(ROSTER_B),
    },
  };
  await patchDoc(token, `tournaments/${TID}`, tournamentPatch, [
    "totalPointsAvailable", "openPublicEdits", "teamA", "teamB",
  ]);
  console.log("  ✅ tournament updated (openPublicEdits:true, 12v12 roster)");

  // ---- 5. Summary
  console.log("\n[4/4] Done!\n");
  console.log("Login credentials (email / password):");
  console.log(`  Password: ${PASSWORD}`);
  console.log("  Emails:");
  for (const p of ALL_PLAYERS) console.log(`    ${emailFor(p.id)}`);
  console.log(`\nOpen test tournament in Admin UI via id: ${TID}`);
  console.log("(active:false, test:true — not shown on public home page)\n");
})().catch((e) => { console.error("\n❌", e.message); process.exit(1); });
