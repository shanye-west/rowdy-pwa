#!/usr/bin/env node
/**
 * Seed a TEST tournament (_TestRowdyCup2026) with dummy data for app testing.
 *
 *  - Uses only the existing "_Test*" player docs (no real players).
 *  - Uses real course docs for hole data (par + handicap index).
 *  - Tournament is test:true / active:false so it stays hidden from the public
 *    home page + History, but is fully openable via the Admin UI.
 *  - Writes via the Firestore REST API using the firebase-tools CLI refresh
 *    token (same identity as `firebase`). Cloud Function triggers then compute
 *    status / result / playerMatchFacts / playerStats automatically.
 *
 * Usage:
 *   node seed-test-tournament-2026.js            # dry run (prints summary)
 *   node seed-test-tournament-2026.js --commit   # actually write to prod
 */

const https = require("https");
const os = require("os");

const PROJECT = "rowdy-pwa";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const COMMIT = process.argv.includes("--commit");

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------
function mintToken() {
  const c = require(os.homedir() + "/.config/configstore/firebase-tools.json");
  const body = new URLSearchParams({
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: c.tokens.refresh_token,
    grant_type: "refresh_token",
  }).toString();
  return httpJson("https://oauth2.googleapis.com/token", "POST", body, {
    "Content-Type": "application/x-www-form-urlencoded",
  }).then((j) => {
    if (!j.access_token) throw new Error("token mint failed: " + JSON.stringify(j).slice(0, 300));
    return j.access_token;
  });
}

function httpJson(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: headers || {} }, (res) => {
      let d = "";
      res.on("data", (x) => (d += x));
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} ${url}\n${d.slice(0, 600)}`));
        resolve(d ? JSON.parse(d) : {});
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Firestore Value <-> JS
// ---------------------------------------------------------------------------
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
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
function fromValue(val) {
  if (!val) return null;
  if ("nullValue" in val) return null;
  if ("booleanValue" in val) return val.booleanValue;
  if ("integerValue" in val) return parseInt(val.integerValue, 10);
  if ("doubleValue" in val) return val.doubleValue;
  if ("stringValue" in val) return val.stringValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("arrayValue" in val) return (val.arrayValue.values || []).map(fromValue);
  if ("mapValue" in val) {
    const o = {};
    for (const k of Object.keys(val.mapValue.fields || {})) o[k] = fromValue(val.mapValue.fields[k]);
    return o;
  }
  return null;
}

async function writeDoc(token, path, obj) {
  const fields = {};
  for (const k of Object.keys(obj)) fields[k] = toValue(obj[k]);
  await httpJson(`${BASE}/${path}`, "PATCH", JSON.stringify({ fields }), {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
  });
}
async function getCourse(token, id) {
  const doc = await httpJson(`${BASE}/courses/${id}`, "GET", null, { Authorization: "Bearer " + token });
  const f = doc.fields;
  return { id, par: fromValue(f.par), holes: fromValue(f.holes) };
}

// ---------------------------------------------------------------------------
// deterministic PRNG
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// rough normal via two uniforms
function gauss(rng, mean, sd) {
  const u = Math.max(1e-9, rng()), v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// gross score for one player on one hole, skill scaled by course handicap
function grossFor(rng, par, courseHcp) {
  const mean = courseHcp / 18; // avg strokes over par per hole
  let delta = Math.round(gauss(rng, mean - 0.15, 1.05));
  if (delta < -2) delta = -2;
  if (delta > 4) delta = 4;
  if (par === 3 && delta < -1) delta = -1; // no eagle on a par 3
  let g = par + delta;
  if (g < 1) g = 1;
  return g;
}

// ---------------------------------------------------------------------------
// roster / config
// ---------------------------------------------------------------------------
const IDX = {
  _TestShanePeterson: 6.3, _TestJPSaar: 3.2, _TestLouMazzarese: 7.8, _TestJasonDugan: 11.3,
  _TestSteveSloan: 10.2, _TestJakeFabozzi: 8.1, _TestRyanBenko: 14.1, _TestRyanHerndon: 14.7,
};
const CH = {}; // course handicap (rounded index) — simple model for test data
for (const k of Object.keys(IDX)) CH[k] = Math.round(IDX[k]);

const TID = "_TestRowdyCup2026";
const teamA = { ids: ["_TestJPSaar", "_TestShanePeterson", "_TestLouMazzarese", "_TestJasonDugan"] };
const teamB = { ids: ["_TestRyanBenko", "_TestJakeFabozzi", "_TestSteveSloan", "_TestRyanHerndon"] };

const ROUNDS = [
  { id: `${TID}-R01-bestBall`, day: 1, format: "twoManBestBall", courseId: "circlingRaven-Blue", trackDrives: false },
  { id: `${TID}-R02-scramble`, day: 2, format: "twoManScramble", courseId: "redhawk-Blue", trackDrives: true },
  { id: `${TID}-R03-shamble`, day: 3, format: "twoManShamble", courseId: "journeyAtPechanga-Black", trackDrives: true },
  { id: `${TID}-R04-singles`, day: 4, format: "singles", courseId: "TCI-OaksCreek-Black", trackDrives: false },
];

// pairings (player ids); fill = how many holes to score (18 = completed, 0 = empty)
const MATCHES = [
  // R01 best ball — both completed
  { round: 0, n: 1, a: ["_TestJPSaar", "_TestShanePeterson"], b: ["_TestRyanBenko", "_TestJakeFabozzi"], fill: 18 },
  { round: 0, n: 2, a: ["_TestLouMazzarese", "_TestJasonDugan"], b: ["_TestSteveSloan", "_TestRyanHerndon"], fill: 18 },
  // R02 scramble — one completed, one in progress
  { round: 1, n: 1, a: ["_TestJPSaar", "_TestShanePeterson"], b: ["_TestRyanBenko", "_TestJakeFabozzi"], fill: 18 },
  { round: 1, n: 2, a: ["_TestLouMazzarese", "_TestJasonDugan"], b: ["_TestSteveSloan", "_TestRyanHerndon"], fill: 6 },
  // R03 shamble — one in progress, one empty
  { round: 2, n: 1, a: ["_TestJPSaar", "_TestShanePeterson"], b: ["_TestRyanBenko", "_TestJakeFabozzi"], fill: 9 },
  { round: 2, n: 2, a: ["_TestLouMazzarese", "_TestJasonDugan"], b: ["_TestSteveSloan", "_TestRyanHerndon"], fill: 0 },
  // R04 singles — completed, in progress, two empty
  { round: 3, n: 1, a: ["_TestShanePeterson"], b: ["_TestSteveSloan"], fill: 18 },
  { round: 3, n: 2, a: ["_TestJPSaar"], b: ["_TestRyanBenko"], fill: 12 },
  { round: 3, n: 3, a: ["_TestLouMazzarese"], b: ["_TestJakeFabozzi"], fill: 0 },
  { round: 3, n: 4, a: ["_TestJasonDugan"], b: ["_TestRyanHerndon"], fill: 0 },
];

const LOGO = "https://firebasestorage.googleapis.com/v0/b/rowdy-pwa.firebasestorage.app/o/rowdycup-logo.svg?alt=media&token=b9048305-f81a-45a8-b26d-208497eb893a";

function strokesArray(strokes, course) {
  // allocate `strokes` shots to hardest holes by hcpIndex
  return course.holes.map((h) => (strokes > 0 && h.hcpIndex <= strokes ? 1 : 0));
}

function buildMatch(m, course, rng) {
  const r = ROUNDS[m.round];
  const players = [...m.a, ...m.b];
  const minCH = Math.min(...players.map((p) => CH[p]));
  const isNet = r.format === "twoManBestBall" || r.format === "singles";

  const mk = (ids, isTeamA) =>
    ids.map((pid) => ({
      playerId: pid,
      strokesReceived: isNet ? strokesArray(CH[pid] - minCH, course) : new Array(18).fill(0),
    }));

  const teamAPlayers = mk(m.a, true);
  const teamBPlayers = mk(m.b, false);
  const courseHandicaps = players.map((p) => CH[p]);

  // gross per player per hole (precompute 18, slice by fill)
  const grossA = m.a.map((pid) => course.holes.map((h) => grossFor(rng, h.par, CH[pid])));
  const grossB = m.b.map((pid) => course.holes.map((h) => grossFor(rng, h.par, CH[pid])));

  const holes = {};
  for (let i = 0; i < 18; i++) {
    const k = String(i + 1);
    const filled = i < m.fill;
    if (r.format === "singles") {
      holes[k] = { input: { teamAPlayerGross: filled ? grossA[0][i] : null, teamBPlayerGross: filled ? grossB[0][i] : null } };
    } else if (r.format === "twoManBestBall") {
      holes[k] = {
        input: {
          teamAPlayersGross: [filled ? grossA[0][i] : null, filled ? grossA[1][i] : null],
          teamBPlayersGross: [filled ? grossB[0][i] : null, filled ? grossB[1][i] : null],
        },
      };
    } else if (r.format === "twoManShamble") {
      holes[k] = {
        input: {
          teamAPlayersGross: [filled ? grossA[0][i] : null, filled ? grossA[1][i] : null],
          teamBPlayersGross: [filled ? grossB[0][i] : null, filled ? grossB[1][i] : null],
          teamADrive: filled ? i % 2 : null,
          teamBDrive: filled ? (i + 1) % 2 : null,
        },
      };
    } else {
      // twoManScramble — single team gross (best of the pair) + drive
      const teamAGross = filled ? Math.min(grossA[0][i], grossA[1][i]) : null;
      const teamBGross = filled ? Math.min(grossB[0][i], grossB[1][i]) : null;
      holes[k] = {
        input: { teamAGross, teamBGross, teamADrive: filled ? i % 2 : null, teamBDrive: filled ? (i + 1) % 2 : null },
      };
    }
  }

  return {
    id: `${TID}-R0${m.round + 1}M0${m.n}-${r.format}`,
    doc: {
      id: `${TID}-R0${m.round + 1}M0${m.n}-${r.format}`,
      roundId: r.id,
      tournamentId: TID,
      matchNumber: m.n,
      courseHandicaps,
      teamAPlayers,
      teamBPlayers,
      authorizedUids: [],
      holes,
      status: { leader: null, margin: 0, thru: 0, dormie: false, closed: false },
      result: {},
      _testSeed: true,
    },
  };
}

function buildTournament(roundIds) {
  const hbp = (ids) => { const o = {}; for (const id of ids) o[id] = IDX[id]; return o; };
  return {
    id: TID,
    name: "TEST — Rowdy Cup 2026 (All Formats)",
    series: "rowdyCup",
    year: 2026,
    active: false,
    test: true,
    archived: false,
    openPublicEdits: false,
    totalPointsAvailable: 10,
    tournamentLogo: LOGO,
    roundIds,
    _testSeed: true,
    teamA: {
      id: "teamA", name: "Test Aces", logo: "", color: "#1e3a5f",
      captainId: "_TestShanePeterson", coCaptainId: "",
      rosterByTier: { A: ["_TestJPSaar"], B: ["_TestShanePeterson"], C: ["_TestLouMazzarese"], D: ["_TestJasonDugan"] },
      handicapByPlayer: hbp(teamA.ids),
    },
    teamB: {
      id: "teamB", name: "Test Birdies", logo: "", color: "#8b0000",
      captainId: "_TestSteveSloan", coCaptainId: "",
      rosterByTier: { A: ["_TestRyanBenko"], B: ["_TestJakeFabozzi"], C: ["_TestSteveSloan"], D: ["_TestRyanHerndon"] },
      handicapByPlayer: hbp(teamB.ids),
    },
  };
}

function buildRound(r, matchIds) {
  return {
    id: r.id, tournamentId: TID, day: r.day, format: r.format, courseId: r.courseId,
    pointsValue: 1, skinsGrossPot: 0, skinsNetPot: 0, trackDrives: r.trackDrives,
    locked: false, matchIds, _testSeed: true,
  };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

(async () => {
  const token = await mintToken();
  const courseIds = [...new Set(ROUNDS.map((r) => r.courseId))];
  const courses = {};
  for (const id of courseIds) courses[id] = await getCourse(token, id);

  // build matches
  const built = MATCHES.map((m) => buildMatch(m, courses[ROUNDS[m.round].courseId], mulberry32(1000 + m.round * 10 + m.n)));
  const matchIdsByRound = ROUNDS.map((_, ri) => built.filter((_, bi) => MATCHES[bi].round === ri).map((b) => b.id));
  const rounds = ROUNDS.map((r, ri) => buildRound(r, matchIdsByRound[ri]));
  const tournament = buildTournament(ROUNDS.map((r) => r.id));

  // summary
  console.log(`\n=== TEST tournament: ${TID} (active:false, test:true) ===`);
  console.log(`Teams: ${tournament.teamA.name} vs ${tournament.teamB.name}  (4v4, _Test players only)`);
  for (let ri = 0; ri < ROUNDS.length; ri++) {
    const r = ROUNDS[ri];
    console.log(`\nRound ${r.day} — ${r.format} @ ${r.courseId}`);
    built.filter((_, bi) => MATCHES[bi].round === ri).forEach((b, k) => {
      const m = MATCHES.filter((x) => x.round === ri)[k];
      const state = m.fill === 18 ? "COMPLETED" : m.fill === 0 ? "empty" : `in-progress (thru ${m.fill})`;
      console.log(`  M${m.n}: [${m.a.join("+")}] vs [${m.b.join("+")}] — ${state}`);
    });
  }
  console.log(`\nTotal: 1 tournament, ${rounds.length} rounds, ${built.length} matches.`);

  if (!COMMIT) {
    console.log("\nDRY RUN — no writes. Re-run with --commit to write to prod.\n");
    return;
  }

  console.log("\nWriting tournament...");
  await writeDoc(token, `tournaments/${TID}`, tournament);
  console.log("Writing rounds...");
  for (const r of rounds) await writeDoc(token, `rounds/${r.id}`, r);
  // let seedRoundDefaults / linkRoundToTournament settle so seedMatchBoilerplate finds round.format
  await sleep(2500);
  console.log("Writing matches...");
  for (const b of built) { await writeDoc(token, `matches/${b.id}`, b.doc); await sleep(150); }
  console.log("\n✅ Done. Cloud Function triggers will compute status/result/stats over the next few seconds.");
  console.log(`Open in Admin UI by tournament id: ${TID}`);
})().catch((e) => { console.error("\n❌", e.message); process.exit(1); });
