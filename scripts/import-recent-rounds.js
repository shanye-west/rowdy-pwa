#!/usr/bin/env node
/**
 * Import each draft-pool golfer's last ~20 posted GHIN rounds into prod as a
 * data-only `playerRecentRounds/{playerId}` collection.
 *
 *  Purpose: back the read-only MCP server so players' AI (and captains doing
 *  draft analysis) can see each golfer's CURRENT off-course form — score
 *  differentials, consistency, recent trend — which is distinct from Rowdy Cup
 *  match results. This data is intentionally NOT surfaced in the app UI; it is
 *  public-read only so the unauthenticated MCP Web SDK can read it.
 *
 *  Source CSV (repo root): players_last_20_rounds.csv
 *    columns: golfer_name,low_handicap_index,round_number,score,
 *             score_differential,date_played,course_rating,slope
 *
 *  Score strings encode GHIN annotations, e.g. "* 64(16)C":
 *    - leading "* "  -> the round currently counts toward the handicap index
 *    - 64            -> adjusted gross score
 *    - (16)          -> holes actually played when fewer than the full round
 *    - C             -> posting type (H=home, A=away, N=nine-hole, C=combined/comp)
 *
 *  Target: playerRecentRounds/{playerId} — one doc per golfer holding the parsed
 *  rounds plus a small form summary. A full (unmasked) PATCH overwrites the doc
 *  each run, so re-running simply refreshes the snapshot.
 *
 *  Writes via the Firestore REST API using the firebase-tools CLI refresh token
 *  (same identity/pattern as the import-rowdycup-* scripts).
 *
 *  Usage:
 *    node import-recent-rounds.js            # dry run: parse, build, validate
 *    node import-recent-rounds.js --commit   # actually write to prod
 */

const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");

const PROJECT = "rowdy-pwa";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const COMMIT = process.argv.includes("--commit");
const CSV_PATH = path.join(__dirname, "..", "players_last_20_rounds.csv");
const SOURCE = "ghin-last-20";

// ---------------------------------------------------------------------------
// CSV golfer name -> player doc id. Several CSV names differ from the app's
// canonical display name (Daniel->Dan, Jacob->Jake, Jp->JP, Phillip->Phil), so
// this mapping is explicit rather than auto-resolved. These 24 are exactly the
// 2026 draft pool.
// ---------------------------------------------------------------------------
const NAME_TO_ID = {
  "Daniel Barnes": "pDanBarnes",
  "Ryan Benko": "pRyanBenko",
  "David Bodendorf": "pDavidBodendorf",
  "Austin Brady": "pAustinBrady",
  "Dan Cassady": "pDanCassady",
  "PJ Connell": "pPJConnell",
  "Luke Davie": "pLukeDavie",
  "Todd Euckert": "pToddEuckert",
  "Jacob Fabozzi": "pJakeFabozzi",
  "Ryan Herndon": "pRyanHerndon",
  "Sean Horan": "pSeanHoran",
  "Jake Kushner": "pJakeKushner",
  "Jared Lardeur": "pJaredLardeur",
  "Alex Macksoud": "pAlexMacksoud",
  "Lou Mazzarese": "pLouMazzarese",
  "David Mower": "pDavidMower",
  "Dave Mulcahey": "pDaveMulcahey",
  "Garrick Oliver": "pGarrickOliver",
  "Adam Reinwasser": "pAdamReinwasser",
  "Jp Saar": "pJPSaar",
  "Phillip Salazar": "pPhilSalazar",
  "Steve Sloan": "pSteveSloan",
  "Gary Trock": "pGaryTrock",
  "Shane Peterson": "pShanePeterson",
};

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------
function num(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** "+1.2" -> -1.2 (plus handicaps are negative); "9.8" -> 9.8. */
function parseLowHi(raw) {
  const s = String(raw || "").trim();
  if (s === "") return null;
  if (s[0] === "+") {
    const v = parseFloat(s.slice(1));
    return Number.isFinite(v) ? -v : null;
  }
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

/** Parse a GHIN score string like "* 64(16)C" / "94A" / "* 34N". */
function parseScore(raw) {
  const s = String(raw || "").trim();
  const usedInHandicap = s[0] === "*";
  const rest = s.replace(/^\*\s*/, "").trim();
  const m = rest.match(/^(\d+)(?:\((\d+)\))?([A-Za-z]*)$/);
  if (!m) {
    return { usedInHandicap, score: null, holesPlayed: null, scoreType: null, scoreRaw: rest };
  }
  return {
    usedInHandicap,
    score: parseInt(m[1], 10),
    holesPlayed: m[2] ? parseInt(m[2], 10) : null,
    scoreType: m[3] ? m[3].toUpperCase() : null,
    scoreRaw: rest,
  };
}

const r1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
function mean(arr) {
  const xs = arr.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ---------------------------------------------------------------------------
// Read + group the CSV into per-player docs
// ---------------------------------------------------------------------------
function buildDocs() {
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines.shift().split(",").map((h) => h.trim());
  const EXPECTED = [
    "golfer_name", "low_handicap_index", "round_number", "score",
    "score_differential", "date_played", "course_rating", "slope",
  ];
  if (header.join(",") !== EXPECTED.join(",")) {
    throw new Error(`Unexpected CSV header:\n  got:      ${header.join(",")}\n  expected: ${EXPECTED.join(",")}`);
  }

  const byName = new Map();
  lines.forEach((line, idx) => {
    const c = line.split(",");
    if (c.length !== 8) throw new Error(`Row ${idx + 2}: expected 8 columns, got ${c.length}: ${line}`);
    const name = c[0].trim();
    const ps = parseScore(c[3]);
    const courseRating = num(c[6]);
    const round = {
      roundNumber: num(c[2]),
      score: ps.score,
      scoreRaw: ps.scoreRaw,
      scoreDifferential: num(c[4]),
      datePlayed: c[5].trim(),
      courseRating,
      slope: num(c[7]),
      scoreType: ps.scoreType,
      holesPlayed: ps.holesPlayed,
      nineHole: ps.scoreType === "N" || (courseRating != null && courseRating < 50),
      usedInHandicap: ps.usedInHandicap,
    };
    if (!byName.has(name)) byName.set(name, { name, lowHi: parseLowHi(c[1]), lowHiRaw: c[1].trim(), rounds: [] });
    byName.get(name).rounds.push(round);
  });

  const updatedAt = new Date().toISOString();
  const docs = [];
  for (const [name, g] of byName) {
    const playerId = NAME_TO_ID[name];
    if (!playerId) throw new Error(`No player-id mapping for CSV golfer "${name}". Add it to NAME_TO_ID.`);
    g.rounds.sort((a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0));
    const diffs = g.rounds.map((r) => r.scoreDifferential);
    const last5 = g.rounds.filter((r) => (r.roundNumber ?? 99) <= 5).map((r) => r.scoreDifferential);
    const counting = g.rounds.filter((r) => r.usedInHandicap).map((r) => r.scoreDifferential);
    docs.push({
      playerId,
      golferName: name,
      lowHandicapIndex: g.lowHi,
      lowHandicapIndexDisplay: g.lowHiRaw,
      source: SOURCE,
      updatedAt,
      roundCount: g.rounds.length,
      summary: {
        rounds: g.rounds.length,
        nineHoleRounds: g.rounds.filter((r) => r.nineHole).length,
        countingRounds: counting.length,
        avgDifferential: r1(mean(diffs)),
        bestDifferential: r1(diffs.length ? Math.min(...diffs.filter((n) => n != null)) : null),
        worstDifferential: r1(diffs.length ? Math.max(...diffs.filter((n) => n != null)) : null),
        last5AvgDifferential: r1(mean(last5)),
        countingAvgDifferential: r1(mean(counting)),
      },
      rounds: g.rounds,
    });
  }
  docs.sort((a, b) => (a.lowHandicapIndex ?? 99) - (b.lowHandicapIndex ?? 99));
  return docs;
}

// ---------------------------------------------------------------------------
// Firestore REST helpers (auth + Value encoding) — same pattern as the
// import-rowdycup-* scripts.
// ---------------------------------------------------------------------------
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
    if (!j.access_token) throw new Error("token mint failed");
    return j.access_token;
  });
}
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
// Full (unmasked) PATCH replaces the whole doc — exactly what we want here
// (each run is a fresh snapshot keyed by playerId).
async function writeDoc(token, p, obj) {
  const fields = {};
  for (const k of Object.keys(obj)) fields[k] = toValue(obj[k]);
  await httpJson(`${BASE}/${p}`, "PATCH", JSON.stringify({ fields }), {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
(async () => {
  const docs = buildDocs();

  // Validation: every mapped golfer present, no duplicates, 20 rounds each.
  const csvNames = new Set(docs.map((d) => d.golferName));
  const missing = Object.keys(NAME_TO_ID).filter((n) => !csvNames.has(n));
  if (missing.length) {
    console.error(`WARNING: NAME_TO_ID has names not in the CSV: ${missing.join(", ")}`);
  }

  console.log(`\n=== Recent-rounds import (target playerRecentRounds/*) ===`);
  console.log(`Source: ${path.relative(process.cwd(), CSV_PATH)}`);
  console.log(`Golfers: ${docs.length}\n`);
  console.log(`${"player".padEnd(18)} ${"id".padEnd(18)} lowHI  n  9h  avgDiff  last5  best  counting`);
  let oddCounts = 0;
  for (const d of docs) {
    if (d.roundCount !== 20) oddCounts++;
    const s = d.summary;
    console.log(
      `${d.golferName.padEnd(18)} ${d.playerId.padEnd(18)} ` +
      `${String(d.lowHandicapIndexDisplay).padStart(5)}  ${String(d.roundCount).padStart(2)}  ` +
      `${String(s.nineHoleRounds).padStart(2)}  ${String(s.avgDifferential).padStart(6)}  ` +
      `${String(s.last5AvgDifferential).padStart(5)}  ${String(s.bestDifferential).padStart(4)}  ` +
      `${String(s.countingAvgDifferential).padStart(7)} (${s.countingRounds})`
    );
  }
  if (oddCounts) console.log(`\nNote: ${oddCounts} golfer(s) do not have exactly 20 rounds.`);

  if (!COMMIT) {
    console.log("\nDRY RUN — no writes. Re-run with --commit to write to prod.\n");
    return;
  }

  const token = await mintToken();
  console.log("\nWriting playerRecentRounds docs...");
  for (const d of docs) {
    await writeDoc(token, `playerRecentRounds/${d.playerId}`, d);
    console.log(`  wrote playerRecentRounds/${d.playerId} (${d.roundCount} rounds)`);
    await sleep(120);
  }
  console.log(`\nDone. Wrote ${docs.length} docs. (Public-read; consumed by the MCP server, not the UI.)`);
})().catch((e) => {
  console.error("\nERROR", e.message);
  process.exit(1);
});
