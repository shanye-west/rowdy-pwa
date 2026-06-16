#!/usr/bin/env node
/**
 * Import the REAL Rowdy Cup 2025 tournament from the scorecard CSV into prod.
 *
 *  - Target tournament doc `tournaments/2025RowdyCup` ALREADY EXISTS (rosters +
 *    handicaps); this script only adds the missing course, 4 rounds, and 21
 *    matches, then lets the Cloud Function triggers compute
 *    status/result/playerMatchFacts/playerStats.
 *
 *  Team mapping (verified by reproducing CSV results against the scoring engine):
 *    CSV PRODUCERS -> teamA      CSV AVIATORS -> teamB
 *
 *  Decisions (confirmed with the owner):
 *    - R4 "4-Man Scramble" is stored as `twoManScramble` (2 players/side, team
 *      gross; the engine has no working fourManScramble scoring branch) and is
 *      worth 2 points per match -> 24 total -> final 12-12.
 *    - R1 M3 (Saar/Macksoud "1&1", 17 holes, conceded on 18) gets a halved 18th
 *      (equal team gross at par) so the app closes it as a final Producers 1-up.
 *    - The Idaho Club course is created from the CSV par/SI (no yardage/rating/
 *      slope available in the data).
 *
 *  Writes via the Firestore REST API using the firebase-tools CLI refresh token
 *  (same identity as `firebase`).
 *
 *  Usage:
 *    node import-rowdycup-2025.js            # dry run: parse, build, validate
 *    node import-rowdycup-2025.js --commit   # actually write to prod
 */

const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");

const PROJECT = "rowdy-pwa";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const COMMIT = process.argv.includes("--commit");
const TID = "2025RowdyCup";
const CSV_PATH = path.join(__dirname, "data", "rowdy_cup_2025_scorecards_complete.csv");

// ---------------------------------------------------------------------------
// Player name -> player doc id (from the existing tournament roster)
// ---------------------------------------------------------------------------
const NAME_TO_ID = {
  // Producers (teamA)
  "JP Saar": "pJPSaar",
  "Phil Salazar": "pPhilSalazar",
  "Jared Lardeur": "pJaredLardeur",
  "Steve Sloan": "pSteveSloan",
  "Shane Peterson": "pShanePeterson",
  "Dan Barnes": "pDanBarnes",
  "Garrick Oliver": "pGarrickOliver",
  "Jason Dugan": "pJasonDugan",
  "Adam Reinwasser": "pAdamReinwasser",
  "Ryan Herndon": "pRyanHerndon",
  "Luke Davie": "pLukeDavie",
  "Alex Macksoud": "pAlexMacksoud",
  // Aviators (teamB)
  "Jake Kushner": "pJakeKushner",
  "Ryan Benko": "pRyanBenko",
  "Dan Cassady": "pDanCassady",
  "Jacob Fabozzi": "pJakeFabozzi",
  "Pj Connell": "pPJConnell",
  "Steve Bodmer": "pSteveBodmer",
  "Todd Euckert": "pToddEuckert",
  "Dennis Furden": "pDennisFurden",
  "Lou Mazzarese": "pLouMazzarese",
  "Dave Mulcahey": "pDaveMulcahey",
  "Sean Horan": "pSeanHoran",
  "Dave Mower": "pDavidMower",
};

function pid(name) {
  const id = NAME_TO_ID[name.trim()];
  if (!id) throw new Error(`Unknown player name: "${name}"`);
  return id;
}
function sideOf(team) {
  const t = team.trim().toUpperCase();
  if (t === "PRODUCERS") return "A";
  if (t === "AVIATORS") return "B";
  throw new Error(`Unknown team: "${team}"`);
}

// ---------------------------------------------------------------------------
// Round config (course ids verified to exist except idahoClub which we create)
// ---------------------------------------------------------------------------
const ROUNDS = [
  { day: 1, format: "twoManScramble",  courseId: "idahoClub",          pointsValue: 1, trackDrives: false },
  { day: 2, format: "twoManBestBall",  courseId: "circlingRaven-Blue", pointsValue: 1, trackDrives: false },
  { day: 3, format: "twoManShamble",   courseId: "cdaResort-GoldBlue", pointsValue: 1, trackDrives: false },
  { day: 4, format: "twoManScramble",  courseId: "circlingRaven-Blue", pointsValue: 2, trackDrives: false },
];
const roundIdFor = (r) => `${TID}-R0${r}`;          // R = 1..4
const matchIdFor = (r, n) => `${TID}-R0${r}M0${n}`;

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------
const ROW_TYPES = new Set(["MATCH_HEADER", "PAR", "SI", "TEAM_SCORE", "PLAYER_HDCP", "PLAYER_SCORE", "PLAYER_STROKES"]);
const COL = { TYPE: 0, ROUND: 1, FORMAT: 2, MATCH_NO: 3, COURSE: 4, TEAM: 5, PLAYER: 6, COURSE_HDCP: 8, MATCHPLAY: 11, WINNER: 12, SCORE: 13, HOLES: 14, H1: 16 };

function num(s) {
  if (s === undefined) return null;
  const t = String(s).trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
function holes18(cells) {
  const out = [];
  for (let i = 0; i < 18; i++) out.push(num(cells[COL.H1 + i]));
  return out;
}

function parseMatches() {
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const lines = text.split(/\r?\n/);
  const rows = lines
    .map((l) => l.split(","))
    .filter((c) => ROW_TYPES.has((c[COL.TYPE] || "").trim()));

  const matches = [];
  let cur = null;
  for (const c of rows) {
    const type = c[COL.TYPE].trim();
    if (type === "MATCH_HEADER") {
      cur = {
        roundNo: parseInt(c[COL.ROUND].trim().match(/R(\d)/)[1], 10),
        matchNo: parseInt(c[COL.MATCH_NO].trim(), 10),
        course: c[COL.COURSE].trim(),
        winner: c[COL.WINNER].trim(),
        score: c[COL.SCORE].trim(),
        holesPlayed: num(c[COL.HOLES]),
        par: null, si: null,
        teams: { A: { pairing: null, teamGross: null, players: [] }, B: { pairing: null, teamGross: null, players: [] } },
        // player rows collected then matched up by name
        hdcp: [], scores: [], strokes: [],
      };
      matches.push(cur);
    } else if (type === "PAR") {
      cur.par = holes18(c);
    } else if (type === "SI") {
      cur.si = holes18(c);
    } else if (type === "TEAM_SCORE") {
      const s = sideOf(c[COL.TEAM]);
      cur.teams[s].pairing = c[COL.PLAYER].trim();
      cur.teams[s].teamGross = holes18(c);
    } else if (type === "PLAYER_HDCP") {
      cur.hdcp.push({ side: sideOf(c[COL.TEAM]), name: c[COL.PLAYER].trim(), courseHdcp: num(c[COL.COURSE_HDCP]), matchplay: num(c[COL.MATCHPLAY]) });
    } else if (type === "PLAYER_SCORE") {
      cur.scores.push({ side: sideOf(c[COL.TEAM]), name: c[COL.PLAYER].trim(), gross: holes18(c) });
    } else if (type === "PLAYER_STROKES") {
      cur.strokes.push({ side: sideOf(c[COL.TEAM]), name: c[COL.PLAYER].trim(), strokes: holes18(c) });
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Build match docs
// ---------------------------------------------------------------------------
function strokesFromMatchplay(si, matchplay) {
  // 1 stroke on holes whose SI <= matchplay shots received (max 1/hole here)
  return si.map((s) => (matchplay > 0 && s <= matchplay ? 1 : 0));
}

function buildPlayersForSide(m, side) {
  // order players by their PLAYER_HDCP appearance for that side
  const rows = m.hdcp.filter((h) => h.side === side);
  return rows.map((h) => {
    const isBestBall = ROUNDS[m.roundNo - 1].format === "twoManBestBall";
    const strokesReceived = isBestBall
      ? strokesFromMatchplay(m.si, h.matchplay || 0)
      : new Array(18).fill(0);
    return { playerId: pid(h.name), name: h.name, strokesReceived, courseHdcp: h.courseHdcp };
  });
}

function grossArrFor(m, side, name) {
  const row = m.scores.find((s) => s.side === side && s.name === name);
  return row ? row.gross.slice() : null;
}

function buildMatch(m) {
  const r = ROUNDS[m.roundNo - 1];
  const format = r.format;
  const teamAPlayers = buildPlayersForSide(m, "A");
  const teamBPlayers = buildPlayersForSide(m, "B");
  const courseHandicaps = [...teamAPlayers, ...teamBPlayers].map((p) => Math.round(p.courseHdcp ?? 0));
  const notes = [];

  const holes = {};
  if (format === "twoManScramble") {
    for (let i = 0; i < 18; i++) {
      holes[String(i + 1)] = { input: { teamAGross: m.teams.A.teamGross[i], teamBGross: m.teams.B.teamGross[i], teamADrive: null, teamBDrive: null } };
    }
  } else {
    // 4-player formats (best ball / shamble): per-player gross + pickup-fill.
    const gA = [grossArrFor(m, "A", teamAPlayers[0].name), grossArrFor(m, "A", teamAPlayers[1].name)];
    const gB = [grossArrFor(m, "B", teamBPlayers[0].name), grossArrFor(m, "B", teamBPlayers[1].name)];
    // A player who picked up shows a blank mid-round while their partner scored.
    // The engine drops a hole if EITHER partner is blank, so fill the pickup with
    // a net-double (par+2) gross that can't beat the partner's counting ball.
    const fill = (g, side) => {
      for (let i = 0; i < 18; i++) {
        const p0 = g[0][i], p1 = g[1][i];
        if (p0 == null && p1 != null) { g[0][i] = m.par[i] + 2; notes.push(`${side} p1 H${i + 1} pickup->${g[0][i]}`); }
        else if (p1 == null && p0 != null) { g[1][i] = m.par[i] + 2; notes.push(`${side} p2 H${i + 1} pickup->${g[1][i]}`); }
      }
    };
    fill(gA, "A"); fill(gB, "B");
    for (let i = 0; i < 18; i++) {
      const k = String(i + 1);
      const input = { teamAPlayersGross: [gA[0][i], gA[1][i]], teamBPlayersGross: [gB[0][i], gB[1][i]] };
      if (format === "twoManShamble") { input.teamADrive = null; input.teamBDrive = null; }
      holes[k] = { input };
    }
  }

  // R1 M3: conceded on 18 -> halve the 18th at par so the match closes 1-up.
  let synthNote = null;
  if (m.roundNo === 1 && m.matchNo === 3) {
    const par18 = m.par[17];
    holes["18"] = { input: { teamAGross: par18, teamBGross: par18, teamADrive: null, teamBDrive: null } };
    synthNote = `halved 18th @ par ${par18}`;
  }
  if (notes.length) synthNote = (synthNote ? synthNote + "; " : "") + notes.join(", ");

  const id = matchIdFor(m.roundNo, m.matchNo);
  const doc = {
    id,
    roundId: roundIdFor(m.roundNo),
    tournamentId: TID,
    matchNumber: m.matchNo,
    courseHandicaps,
    teamAPlayers: teamAPlayers.map((p) => ({ playerId: p.playerId, strokesReceived: p.strokesReceived })),
    teamBPlayers: teamBPlayers.map((p) => ({ playerId: p.playerId, strokesReceived: p.strokesReceived })),
    authorizedUids: [],
    holes,
    status: { leader: null, margin: 0, thru: 0, dormie: false, closed: false },
    result: {},
    _importSource: "rowdy_cup_2025_scorecards_complete.csv",
  };
  return { m, format, doc, teamAPlayers, teamBPlayers, synthNote };
}

// ---------------------------------------------------------------------------
// Validation: re-implement the scoring engine and compare to the CSV result
// (mirrors functions/src/scoring/matchScoring.ts)
// ---------------------------------------------------------------------------
const isG = (n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 30;
const c01 = (n) => (Number(n) === 1 ? 1 : 0);

function decideHole(format, i, doc) {
  const h = doc.holes[String(i)]?.input ?? {};
  if (format === "twoManScramble") {
    const a = h.teamAGross, b = h.teamBGross;
    if (!isG(a) || !isG(b)) return null;
    return a < b ? "teamA" : b < a ? "teamB" : "AS";
  }
  if (format === "twoManShamble") {
    const a = h.teamAPlayersGross || [], b = h.teamBPlayersGross || [];
    if (![a[0], a[1], b[0], b[1]].every(isG)) return null;
    const aB = Math.min(a[0], a[1]), bB = Math.min(b[0], b[1]);
    return aB < bB ? "teamA" : bB < aB ? "teamB" : "AS";
  }
  // best ball (net)
  const a = h.teamAPlayersGross || [], b = h.teamBPlayersGross || [];
  if (![a[0], a[1], b[0], b[1]].every(isG)) return null;
  const net = (g, idx, arr) => g - c01(arr?.[idx]?.strokesReceived?.[i - 1]);
  const aB = Math.min(net(a[0], 0, doc.teamAPlayers), net(a[1], 1, doc.teamAPlayers));
  const bB = Math.min(net(b[0], 0, doc.teamBPlayers), net(b[1], 1, doc.teamBPlayers));
  return aB < bB ? "teamA" : bB < aB ? "teamB" : "AS";
}

function summarize(format, doc) {
  let a = 0, b = 0, thru = 0, rm = 0, decided = false;
  for (let i = 1; i <= 18; i++) {
    if (decided) break;
    const res = decideHole(format, i, doc);
    if (res === null) continue;
    thru = i;
    if (res === "teamA") { a++; rm++; } else if (res === "teamB") { b++; rm--; }
    if (Math.abs(rm) > 18 - i) decided = true;
  }
  const leader = a > b ? "teamA" : b > a ? "teamB" : null;
  const margin = Math.abs(a - b);
  const holesLeft = 18 - thru;
  const closed = (leader !== null && margin > holesLeft) || thru === 18;
  const winner = thru === 18 && a === b ? "AS" : leader ?? "AS";
  return { a, b, thru, leader, margin, closed, winner };
}

// Independent per-hole integrity check: the team's best GROSS (per the README,
// the bestBall/shamble TEAM_SCORE row is "lower of the two scores") computed from
// our built per-player grosses must equal the CSV TEAM_SCORE row for every hole
// both partners scored. Catches silent gross transcription errors. Pickup-filled
// holes are skipped (the filled value is synthetic, not from the CSV).
function teamScoreMismatches(b) {
  const { m, format, doc } = b;
  if (format === "twoManScramble") return []; // team gross IS the input
  const out = [];
  for (const side of ["A", "B"]) {
    const key = side === "A" ? "teamAPlayersGross" : "teamBPlayersGross";
    for (let i = 0; i < 18; i++) {
      const expected = m.teams[side].teamGross[i];
      if (expected == null) continue;
      const g = doc.holes[String(i + 1)].input[key];
      if (!isG(g[0]) || !isG(g[1])) continue;
      const best = Math.min(g[0], g[1]);
      if (best !== expected) out.push(`${side} H${i + 1}: computed ${best} vs CSV ${expected}`);
    }
  }
  return out;
}

function expectedFromCsv(m) {
  // expected winning side + margin/holesLeft from RESULT_WINNER / RESULT_SCORE
  let side = "AS";
  if (m.winner !== "HALVED") {
    if (m.teams.A.pairing === m.winner) side = "teamA";
    else if (m.teams.B.pairing === m.winner) side = "teamB";
    else side = "??(" + m.winner + ")";
  }
  let margin = 0, holesLeft = 0;
  if (/^\d+&\d+$/.test(m.score)) {
    const [mg, hl] = m.score.split("&").map(Number);
    margin = mg; holesLeft = hl;
  } else if (/UP$/i.test(m.score)) {
    margin = parseInt(m.score, 10); holesLeft = 0;
  } else if (m.score.toUpperCase() === "AS") {
    margin = 0; holesLeft = 0;
  }
  return { side, margin, holesLeft };
}

// ---------------------------------------------------------------------------
// Idaho Club course (R1) from CSV par/SI
// ---------------------------------------------------------------------------
function buildIdahoClub(sampleMatch) {
  const par = sampleMatch.par, si = sampleMatch.si;
  return {
    id: "idahoClub",
    name: "The Idaho Club",
    tees: "",
    par: par.reduce((s, p) => s + p, 0),
    holes: par.map((p, i) => ({ number: i + 1, par: p, hcpIndex: si[i] })),
  };
}

// ---------------------------------------------------------------------------
// Firestore REST helpers (auth + Value encoding) — same pattern as seed-test
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
  return httpJson("https://oauth2.googleapis.com/token", "POST", body, { "Content-Type": "application/x-www-form-urlencoded" })
    .then((j) => { if (!j.access_token) throw new Error("token mint failed"); return j.access_token; });
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
async function writeDoc(token, p, obj, maskFields) {
  const fields = {};
  for (const k of Object.keys(obj)) fields[k] = toValue(obj[k]);
  // A PATCH WITHOUT updateMask REPLACES the whole document. For partial/merge
  // writes you MUST pass an updateMask listing exactly the fields to touch.
  const mask = maskFields ? "?" + maskFields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&") : "";
  await httpJson(`${BASE}/${p}${mask}`, "PATCH", JSON.stringify({ fields }), { "Content-Type": "application/json", Authorization: "Bearer " + token });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
(async () => {
  const parsed = parseMatches();
  if (parsed.length !== 21) throw new Error(`expected 21 matches, parsed ${parsed.length}`);
  const built = parsed.map(buildMatch);
  const idahoClub = buildIdahoClub(parsed[0]);

  // rounds with matchIds populated directly
  const rounds = ROUNDS.map((r, idx) => {
    const rn = idx + 1;
    const matchIds = built.filter((b) => b.m.roundNo === rn).map((b) => b.doc.id);
    return { id: roundIdFor(rn), tournamentId: TID, day: r.day, format: r.format, courseId: r.courseId,
      pointsValue: r.pointsValue, skinsGrossPot: 0, skinsNetPot: 0, trackDrives: r.trackDrives, locked: false, matchIds };
  });

  // ---- validation + summary ----
  const fmtLabel = { twoManScramble: "Scramble", twoManBestBall: "Best Ball", twoManShamble: "Shamble" };
  let teamA = 0, teamB = 0, mismatches = 0, holeMismatches = 0;
  console.log(`\n=== Rowdy Cup 2025 import (target tournaments/${TID}) ===`);
  console.log(`Course to create: ${idahoClub.name} (id=${idahoClub.id}, par ${idahoClub.par})`);
  console.log(`Producers => teamA   Aviators => teamB\n`);

  for (let rn = 1; rn <= 4; rn++) {
    const r = ROUNDS[rn - 1];
    console.log(`--- R${rn} ${fmtLabel[r.format]} @ ${r.courseId}  (${r.pointsValue} pt/match) ---`);
    for (const b of built.filter((x) => x.m.roundNo === rn)) {
      const sum = summarize(b.format, b.doc);
      const exp = expectedFromCsv(b.m);
      // win/margin check (thru intentionally differs for post-match data + the R1M3 synth halve)
      const winOk = sum.winner === exp.side;
      const isSynth = !!b.synthNote;
      const marginOk = isSynth ? sum.margin === exp.margin : sum.winner === "AS" ? true : sum.margin === exp.margin;
      const ok = winOk && marginOk && sum.closed;
      if (!ok) mismatches++;

      const hm = teamScoreMismatches(b);
      holeMismatches += hm.length;
      if (hm.length) console.log(`     ! TEAM_SCORE check: ${hm.join("; ")}`);

      const pts = r.pointsValue;
      if (sum.winner === "teamA") teamA += pts;
      else if (sum.winner === "teamB") teamB += pts;
      else { teamA += pts / 2; teamB += pts / 2; }

      const aNames = b.teamAPlayers.map((p) => p.name.split(" ").slice(-1)[0]).join("/");
      const bNames = b.teamBPlayers.map((p) => p.name.split(" ").slice(-1)[0]).join("/");
      const res = sum.winner === "AS" ? "HALVED AS" : `${sum.winner === "teamA" ? aNames : bNames} ${sum.margin}${sum.thru < 18 ? "&" + (18 - sum.thru) : " UP"}`;
      console.log(
        `  M${b.m.matchNo} ${b.doc.id}  A[${aNames}] vs B[${bNames}]  ` +
        `=> ${res}  | CSV: ${b.m.winner} ${b.m.score}  ${ok ? "OK" : "*** MISMATCH ***"}${b.synthNote ? "  (" + b.synthNote + ")" : ""}`
      );
    }
  }

  console.log(`\nFinal tally (R4 @ 2pts): Producers(teamA) ${teamA}  -  Aviators(teamB) ${teamB}   [total ${teamA + teamB}]`);
  console.log(`Result validation:     ${mismatches === 0 ? "ALL 21 MATCH" : mismatches + " MISMATCH(ES)"}`);
  console.log(`Per-hole TEAM_SCORE:   ${holeMismatches === 0 ? "ALL MATCH" : holeMismatches + " MISMATCH(ES)"}`);
  if (mismatches > 0 || holeMismatches > 0) { console.error("\nAborting: fix mismatches before committing."); process.exit(1); }
  if (Math.abs(teamA + teamB - 24) > 1e-9 || teamA !== 12 || teamB !== 12) {
    console.error(`\nWARNING: expected 12-12 / 24 total, got ${teamA}-${teamB}.`);
  }

  if (!COMMIT) {
    console.log("\nDRY RUN — no writes. Re-run with --commit to write to prod.\n");
    return;
  }

  const token = await mintToken();
  const matchesOnly = process.argv.includes("--matches-only");
  if (!matchesOnly) {
    console.log("\nWriting course (idahoClub)...");
    await writeDoc(token, `courses/${idahoClub.id}`, idahoClub);
    console.log("Writing rounds...");
    for (const r of rounds) { await writeDoc(token, `rounds/${r.id}`, r); await sleep(200); }
    // let seedRoundDefaults / linkRoundToTournament settle so round.format exists for seedMatchBoilerplate
    await sleep(3000);
  }
  console.log("Writing matches (full docs)...");
  for (const b of built) { await writeDoc(token, `matches/${b.doc.id}`, b.doc); await sleep(150); }
  // Force a clean recompute pass to defeat the seedMatchBoilerplate/computeMatchOnWrite
  // create-race. MUST be a masked (merge) write so it doesn't replace the whole doc.
  await sleep(4000);
  console.log("Forcing recompute (_computeSig:stale + _touch, masked)...");
  for (const b of built) { await writeDoc(token, `matches/${b.doc.id}`, { _computeSig: "stale", _touch: Date.now() }, ["_computeSig", "_touch"]); await sleep(150); }
  console.log("\nDone. Triggers will finish computing status/result/facts/stats over the next ~30s.");
  console.log(`Open in Admin UI: tournament ${TID}`);
})().catch((e) => { console.error("\nERROR", e.message); process.exit(1); });
