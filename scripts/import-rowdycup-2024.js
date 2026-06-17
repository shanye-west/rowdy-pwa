#!/usr/bin/env node
/**
 * Import the REAL Rowdy Cup 2024 tournament from the scorecard CSV into prod.
 * Mirrors scripts/import-rowdycup-2025.js. Target `tournaments/2024RowdyCup`
 * already exists (roster-only shell + 5 EMPTY placeholder rounds, which this
 * script deletes). Adds 4 rounds + 21 matches; triggers compute the rest.
 *
 *  Team mapping (matches the current swapped orientation: blue team = teamA = left):
 *    CSV DEGENERATES -> teamA      CSV SWINGERS -> teamB
 *
 *  Decisions:
 *    - R4 "4-Man Scramble" stored as `twoManScramble` (2/side team-gross), 2 pts/
 *      match -> 24 total (matches tournament.totalPointsAvailable). Final 13.5–10.5
 *      Swingers.
 *    - 2024 best ball was scratch (CSV PLAYER_STROKES all 0 / blank MATCHPLAY) ->
 *      strokesReceived all zeros; best ball = best gross.
 *    - Concession fills (halve the unplayed holes so the app can close the match,
 *      same idea as 2025 R1M3): R4 M2 ("1&4", conceded 1-up after 14) halves
 *      H15–18; R4 M3 ("AS" through 17) halves H18.
 *    - Courses circlingRaven-Blue + cdaResort-GoldBlue already exist.
 *
 *  Usage:
 *    node import-rowdycup-2024.js            # dry run
 *    node import-rowdycup-2024.js --commit   # write to prod
 */

const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");

const PROJECT = "rowdy-pwa";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const COMMIT = process.argv.includes("--commit");
const TID = "2024RowdyCup";
// Merged source: R2 best ball NET (from the hdcps file), R3 shamble GROSS (from
// the original file — the hdcps file's R3 handicaps were added in error), R1/R4
// identical in both. Rebuilt by the merge step; see notes in the chat/commit.
const CSV_PATH = path.join(__dirname, "data", "rowdy_cup_2024_scorecards_merged.csv");
const OLD_PLACEHOLDER_ROUNDS = ["2024RC-R01-twoManBestBall", "2024RC-R01-twoManScramble", "2024RC-R02-twoManBestBall", "2024RC-R03-twoManShamble", "2024RC-R04-fourManScramble"];

// roundNo-matchNo -> holes (1-indexed) to halve at par so a conceded match closes
const SYNTH = { "4-2": [15, 16, 17, 18], "4-3": [18] };

// ---------------------------------------------------------------------------
// Player name -> player doc id (2024 roster)
// ---------------------------------------------------------------------------
const NAME_TO_ID = {
  // Degenerates (teamA)
  "Dan Barnes": "pDanBarnes", "Joe Houser": "pJoeHouser", "Dan Cassady": "pDanCassady",
  "Lou Mazzarese": "pLouMazzarese", "Sean Smiley": "pSeanSmiley", "Jason Dugan": "pJasonDugan",
  "raymond Warner": "pRaymondWarner", "Adam Reinwasser": "pAdamReinwasser", "Jacob Fabozzi": "pJakeFabozzi",
  "Kevin Mulqueen": "pKevinMulqueen", "JP Saar": "pJPSaar", "Luke Davie": "pLukeDavie",
  // Swingers (teamB)
  "Jake Kushner": "pJakeKushner", "Ryan Herndon": "pRyanHerndon", "Steve Sloan": "pSteveSloan",
  "Jared Lardeur": "pJaredLardeur", "Mike Mcdermaid": "pMikeMcDermaid", "Todd Euckert": "pToddEuckert",
  "Shane Peterson": "pShanePeterson", "Dave Mulcahey": "pDaveMulcahey", "Phil Salazar": "pPhilSalazar",
  "Sean Horan": "pSeanHoran", "Ryan Benko": "pRyanBenko", "Dave Mower": "pDavidMower",
};
function pid(name) { const id = NAME_TO_ID[name.trim()]; if (!id) throw new Error(`Unknown player name: "${name}"`); return id; }
function sideOf(team) {
  const t = team.trim().toUpperCase();
  if (t === "DEGENERATES") return "A";
  if (t === "SWINGERS") return "B";
  throw new Error(`Unknown team: "${team}"`);
}

const ROUNDS = [
  { day: 1, format: "twoManScramble", courseId: "circlingRaven-Blue", pointsValue: 1, trackDrives: false },
  { day: 2, format: "twoManBestBall", courseId: "cdaResort-GoldBlue", pointsValue: 1, trackDrives: false },
  { day: 3, format: "twoManShamble",  courseId: "circlingRaven-Blue", pointsValue: 1, trackDrives: false },
  { day: 4, format: "twoManScramble", courseId: "circlingRaven-Blue", pointsValue: 2, trackDrives: false },
];
const roundIdFor = (r) => `${TID}-R0${r}`;
const matchIdFor = (r, n) => `${TID}-R0${r}M0${n}`;
const TEAM_NAME = { teamA: "Degenerates", teamB: "Swingers" };

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------
const ROW_TYPES = new Set(["MATCH_HEADER", "PAR", "SI", "TEAM_SCORE", "PLAYER_HDCP", "PLAYER_SCORE", "PLAYER_STROKES"]);
const COL = { TYPE: 0, ROUND: 1, FORMAT: 2, MATCH_NO: 3, COURSE: 4, TEAM: 5, PLAYER: 6, COURSE_HDCP: 8, MATCHPLAY: 11, WINNER: 12, SCORE: 13, HOLES: 14, H1: 16 };
function num(s) { if (s === undefined) return null; const t = String(s).trim(); if (t === "") return null; const v = Number(t); return Number.isFinite(v) ? v : null; }
function holes18(cells) { const out = []; for (let i = 0; i < 18; i++) out.push(num(cells[COL.H1 + i])); return out; }

function parseMatches() {
  const rows = fs.readFileSync(CSV_PATH, "utf8").split(/\r?\n/).map((l) => l.split(",")).filter((c) => ROW_TYPES.has((c[COL.TYPE] || "").trim()));
  const matches = []; let cur = null;
  for (const c of rows) {
    const type = c[COL.TYPE].trim();
    if (type === "MATCH_HEADER") {
      cur = { roundNo: parseInt(c[COL.ROUND].trim().match(/R(\d)/)[1], 10), matchNo: parseInt(c[COL.MATCH_NO].trim(), 10),
        course: c[COL.COURSE].trim(), winner: c[COL.WINNER].trim(), score: c[COL.SCORE].trim(), holesPlayed: num(c[COL.HOLES]),
        par: null, si: null, teams: { A: { pairing: null, teamGross: null }, B: { pairing: null, teamGross: null } }, hdcp: [], scores: [], strokes: [] };
      matches.push(cur);
    } else if (type === "PAR") cur.par = holes18(c);
    else if (type === "SI") cur.si = holes18(c);
    else if (type === "TEAM_SCORE") { const s = sideOf(c[COL.TEAM]); cur.teams[s].pairing = c[COL.PLAYER].trim(); cur.teams[s].teamGross = holes18(c); }
    else if (type === "PLAYER_HDCP") cur.hdcp.push({ side: sideOf(c[COL.TEAM]), name: c[COL.PLAYER].trim(), courseHdcp: num(c[COL.COURSE_HDCP]), matchplay: num(c[COL.MATCHPLAY]) });
    else if (type === "PLAYER_SCORE") cur.scores.push({ side: sideOf(c[COL.TEAM]), name: c[COL.PLAYER].trim(), gross: holes18(c) });
    else if (type === "PLAYER_STROKES") cur.strokes.push({ side: sideOf(c[COL.TEAM]), name: c[COL.PLAYER].trim(), strokes: holes18(c) });
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Build match docs
// ---------------------------------------------------------------------------
function strokesFromMatchplay(si, matchplay) { return si.map((s) => (matchplay > 0 && s <= matchplay ? 1 : 0)); }
function buildPlayersForSide(m, side) {
  return m.hdcp.filter((h) => h.side === side).map((h) => {
    const isBestBall = ROUNDS[m.roundNo - 1].format === "twoManBestBall";
    return { playerId: pid(h.name), name: h.name, strokesReceived: isBestBall ? strokesFromMatchplay(m.si, h.matchplay || 0) : new Array(18).fill(0), courseHdcp: h.courseHdcp };
  });
}
function grossArrFor(m, side, name) { const row = m.scores.find((s) => s.side === side && s.name === name); return row ? row.gross.slice() : null; }
function halvedInput(format, par) {
  if (format === "twoManScramble") return { teamAGross: par, teamBGross: par, teamADrive: null, teamBDrive: null };
  if (format === "twoManShamble") return { teamAPlayersGross: [par, par], teamBPlayersGross: [par, par], teamADrive: null, teamBDrive: null };
  return { teamAPlayersGross: [par, par], teamBPlayersGross: [par, par] };
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
    for (let i = 0; i < 18; i++) holes[String(i + 1)] = { input: { teamAGross: m.teams.A.teamGross[i], teamBGross: m.teams.B.teamGross[i], teamADrive: null, teamBDrive: null } };
  } else {
    const gA = [grossArrFor(m, "A", teamAPlayers[0].name), grossArrFor(m, "A", teamAPlayers[1].name)];
    const gB = [grossArrFor(m, "B", teamBPlayers[0].name), grossArrFor(m, "B", teamBPlayers[1].name)];
    const fill = (g, side) => { for (let i = 0; i < 18; i++) {
      const p0 = g[0][i], p1 = g[1][i];
      if (p0 == null && p1 != null) { g[0][i] = m.par[i] + 2; notes.push(`${side} p1 H${i + 1} pickup->${g[0][i]}`); }
      else if (p1 == null && p0 != null) { g[1][i] = m.par[i] + 2; notes.push(`${side} p2 H${i + 1} pickup->${g[1][i]}`); }
    } };
    fill(gA, "A"); fill(gB, "B");
    for (let i = 0; i < 18; i++) {
      const input = { teamAPlayersGross: [gA[0][i], gA[1][i]], teamBPlayersGross: [gB[0][i], gB[1][i]] };
      if (format === "twoManShamble") { input.teamADrive = null; input.teamBDrive = null; }
      holes[String(i + 1)] = { input };
    }
  }

  // concession fills: halve listed holes at par so the conceded match closes
  let synthNote = null;
  const synthHoles = SYNTH[`${m.roundNo}-${m.matchNo}`];
  if (synthHoles) {
    for (const hn of synthHoles) holes[String(hn)] = { input: halvedInput(format, m.par[hn - 1]) };
    synthNote = `concession: halved H${synthHoles.join(",")} @ par`;
  }
  if (notes.length) synthNote = (synthNote ? synthNote + "; " : "") + notes.join(", ");

  const id = matchIdFor(m.roundNo, m.matchNo);
  const doc = {
    id, roundId: roundIdFor(m.roundNo), tournamentId: TID, matchNumber: m.matchNo, courseHandicaps,
    teamAPlayers: teamAPlayers.map((p) => ({ playerId: p.playerId, strokesReceived: p.strokesReceived })),
    teamBPlayers: teamBPlayers.map((p) => ({ playerId: p.playerId, strokesReceived: p.strokesReceived })),
    authorizedUids: [], holes, status: { leader: null, margin: 0, thru: 0, dormie: false, closed: false }, result: {},
    _importSource: "rowdy_cup_2024_scorecards_complete.csv",
  };
  return { m, format, doc, teamAPlayers, teamBPlayers, synthNote };
}

// ---------------------------------------------------------------------------
// Validation (mirrors functions/src/scoring/matchScoring.ts)
// ---------------------------------------------------------------------------
const isG = (n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 30;
const c01 = (n) => (Number(n) === 1 ? 1 : 0);
function decideHole(format, i, doc) {
  const h = doc.holes[String(i)]?.input ?? {};
  if (format === "twoManScramble") { const a = h.teamAGross, b = h.teamBGross; if (!isG(a) || !isG(b)) return null; return a < b ? "teamA" : b < a ? "teamB" : "AS"; }
  if (format === "twoManShamble") { const a = h.teamAPlayersGross || [], b = h.teamBPlayersGross || []; if (![a[0], a[1], b[0], b[1]].every(isG)) return null; const aB = Math.min(a[0], a[1]), bB = Math.min(b[0], b[1]); return aB < bB ? "teamA" : bB < aB ? "teamB" : "AS"; }
  const a = h.teamAPlayersGross || [], b = h.teamBPlayersGross || [];
  if (![a[0], a[1], b[0], b[1]].every(isG)) return null;
  const net = (g, idx, arr) => g - c01(arr?.[idx]?.strokesReceived?.[i - 1]);
  const aB = Math.min(net(a[0], 0, doc.teamAPlayers), net(a[1], 1, doc.teamAPlayers)), bB = Math.min(net(b[0], 0, doc.teamBPlayers), net(b[1], 1, doc.teamBPlayers));
  return aB < bB ? "teamA" : bB < aB ? "teamB" : "AS";
}
function summarize(format, doc) {
  let a = 0, b = 0, thru = 0, rm = 0, decided = false;
  for (let i = 1; i <= 18; i++) { if (decided) break; const res = decideHole(format, i, doc); if (res === null) continue; thru = i; if (res === "teamA") { a++; rm++; } else if (res === "teamB") { b++; rm--; } if (Math.abs(rm) > 18 - i) decided = true; }
  const leader = a > b ? "teamA" : b > a ? "teamB" : null, margin = Math.abs(a - b), holesLeft = 18 - thru;
  const closed = (leader !== null && margin > holesLeft) || thru === 18, winner = thru === 18 && a === b ? "AS" : leader ?? "AS";
  return { a, b, thru, leader, margin, closed, winner };
}
// In the 2024 CSV the bestBall TEAM_SCORE row is the best NET per hole (handicaps
// were applied); shamble is best gross (no strokes). Compare accordingly.
function teamScoreMismatches(b) {
  const { m, format, doc } = b; if (format === "twoManScramble") return []; const out = [];
  for (const side of ["A", "B"]) {
    const key = side === "A" ? "teamAPlayersGross" : "teamBPlayersGross";
    const players = side === "A" ? doc.teamAPlayers : doc.teamBPlayers;
    for (let i = 0; i < 18; i++) { const expected = m.teams[side].teamGross[i]; if (expected == null) continue;
      const g = doc.holes[String(i + 1)].input[key]; if (!isG(g[0]) || !isG(g[1])) continue;
      const best = format === "twoManBestBall"
        ? Math.min(g[0] - c01(players[0].strokesReceived[i]), g[1] - c01(players[1].strokesReceived[i]))
        : Math.min(g[0], g[1]);
      if (best !== expected) out.push(`${side} H${i + 1}: computed ${best} vs CSV ${expected}`); } }
  return out;
}
function expectedFromCsv(m) {
  let side = "AS";
  if (m.winner !== "HALVED") { if (m.teams.A.pairing === m.winner) side = "teamA"; else if (m.teams.B.pairing === m.winner) side = "teamB"; else side = "??(" + m.winner + ")"; }
  let margin = 0;
  if (/^\d+&\d+$/.test(m.score)) margin = Number(m.score.split("&")[0]);
  else if (/UP$/i.test(m.score)) margin = parseInt(m.score, 10);
  return { side, margin };
}

// ---------------------------------------------------------------------------
// Firestore REST helpers
// ---------------------------------------------------------------------------
function httpJson(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: headers || {} }, (res) => { let d = ""; res.on("data", (x) => (d += x));
      res.on("end", () => res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode} ${url}\n${d.slice(0, 600)}`)) : resolve(d ? JSON.parse(d) : {})); });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}
function mintToken() {
  const c = require(os.homedir() + "/.config/configstore/firebase-tools.json");
  const body = new URLSearchParams({ client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com", client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi", refresh_token: c.tokens.refresh_token, grant_type: "refresh_token" }).toString();
  return httpJson("https://oauth2.googleapis.com/token", "POST", body, { "Content-Type": "application/x-www-form-urlencoded" }).then((j) => { if (!j.access_token) throw new Error("token mint failed"); return j.access_token; });
}
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === "object") { const fields = {}; for (const k of Object.keys(v)) fields[k] = toValue(v[k]); return { mapValue: { fields } }; }
  throw new Error("cannot encode " + typeof v);
}
async function writeDoc(token, p, obj, maskFields) {
  const fields = {}; for (const k of Object.keys(obj)) fields[k] = toValue(obj[k]);
  const mask = maskFields ? "?" + maskFields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&") : "";
  await httpJson(`${BASE}/${p}${mask}`, "PATCH", JSON.stringify({ fields }), { "Content-Type": "application/json", Authorization: "Bearer " + token });
}
async function deleteDoc(token, p) { await httpJson(`${BASE}/${p}`, "DELETE", null, { Authorization: "Bearer " + token }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
(async () => {
  const parsed = parseMatches();
  if (parsed.length !== 21) throw new Error(`expected 21 matches, parsed ${parsed.length}`);
  const built = parsed.map(buildMatch);

  const rounds = ROUNDS.map((r, idx) => {
    const rn = idx + 1;
    const matchIds = built.filter((b) => b.m.roundNo === rn).map((b) => b.doc.id);
    return { id: roundIdFor(rn), tournamentId: TID, day: r.day, format: r.format, courseId: r.courseId, pointsValue: r.pointsValue, skinsGrossPot: 0, skinsNetPot: 0, trackDrives: r.trackDrives, locked: false, matchIds };
  });

  const fmtLabel = { twoManScramble: "Scramble", twoManBestBall: "Best Ball", twoManShamble: "Shamble" };
  let teamA = 0, teamB = 0, mismatches = 0, holeMismatches = 0;
  console.log(`\n=== Rowdy Cup 2024 import (target tournaments/${TID}) ===`);
  console.log(`Degenerates => teamA (left)   Swingers => teamB (right)`);
  console.log(`Will DELETE ${OLD_PLACEHOLDER_ROUNDS.length} empty placeholder rounds and set roundIds to R01–R04.\n`);

  for (let rn = 1; rn <= 4; rn++) {
    const r = ROUNDS[rn - 1];
    console.log(`--- R${rn} ${fmtLabel[r.format]} @ ${r.courseId}  (${r.pointsValue} pt/match) ---`);
    for (const b of built.filter((x) => x.m.roundNo === rn)) {
      const sum = summarize(b.format, b.doc);
      const exp = expectedFromCsv(b.m);
      const winOk = sum.winner === exp.side;
      const marginOk = sum.winner === "AS" ? true : sum.margin === exp.margin;
      const ok = winOk && marginOk && sum.closed;
      if (!ok) mismatches++;
      const hm = teamScoreMismatches(b);
      holeMismatches += hm.length;
      if (hm.length) console.log(`     ! TEAM_SCORE check: ${hm.join("; ")}`);
      const pts = r.pointsValue;
      if (sum.winner === "teamA") teamA += pts; else if (sum.winner === "teamB") teamB += pts; else { teamA += pts / 2; teamB += pts / 2; }
      const aN = b.teamAPlayers.map((p) => p.name.split(" ").slice(-1)[0]).join("/");
      const bN = b.teamBPlayers.map((p) => p.name.split(" ").slice(-1)[0]).join("/");
      const res = sum.winner === "AS" ? "HALVED AS" : `${sum.winner === "teamA" ? aN : bN} ${sum.margin}${sum.thru < 18 ? "&" + (18 - sum.thru) : " UP"}`;
      console.log(`  M${b.m.matchNo} ${b.doc.id}  A[${aN}] vs B[${bN}]  => ${res}  | CSV: ${b.m.winner} ${b.m.score}  ${ok ? "OK" : "*** MISMATCH ***"}${b.synthNote ? "  (" + b.synthNote + ")" : ""}`);
    }
  }

  console.log(`\nFinal tally (R4 @ 2pts): ${TEAM_NAME.teamA}(teamA) ${teamA}  -  ${TEAM_NAME.teamB}(teamB) ${teamB}   [total ${teamA + teamB}]`);
  console.log(`Result validation:     ${mismatches === 0 ? "ALL 21 MATCH" : mismatches + " MISMATCH(ES)"}`);
  console.log(`Per-hole TEAM_SCORE:   ${holeMismatches === 0 ? "ALL MATCH" : holeMismatches + " MISMATCH(ES)"}`);
  if (mismatches > 0 || holeMismatches > 0) { console.error("\nAborting: fix mismatches before committing."); process.exit(1); }

  if (!COMMIT) { console.log("\nDRY RUN — no writes. Re-run with --commit to write to prod.\n"); return; }

  const token = await mintToken();
  console.log("\nWriting rounds...");
  for (const r of rounds) { await writeDoc(token, `rounds/${r.id}`, r); await sleep(200); }
  await sleep(3000); // let seedRoundDefaults / linkRoundToTournament settle
  console.log("Writing matches (full docs)...");
  for (const b of built) { await writeDoc(token, `matches/${b.doc.id}`, b.doc); await sleep(150); }
  await sleep(4000);
  console.log("Forcing recompute (_computeSig:stale + _touch, masked)...");
  for (const b of built) { await writeDoc(token, `matches/${b.doc.id}`, { _computeSig: "stale", _touch: Date.now() }, ["_computeSig", "_touch"]); await sleep(150); }
  console.log("Deleting empty placeholder rounds...");
  for (const id of OLD_PLACEHOLDER_ROUNDS) { try { await deleteDoc(token, `rounds/${id}`); } catch (e) { console.log(`  (skip ${id}: ${e.message.split("\n")[0]})`); } await sleep(150); }
  await sleep(1500);
  console.log("Setting tournament.roundIds to R01–R04...");
  await writeDoc(token, `tournaments/${TID}`, { roundIds: rounds.map((r) => r.id) }, ["roundIds"]);
  console.log("\nDone. Triggers compute status/result/facts/stats over ~30s.");
})().catch((e) => { console.error("\nERROR", e.message); process.exit(1); });
