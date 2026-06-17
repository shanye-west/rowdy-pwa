#!/usr/bin/env node
/**
 * Import the REAL Rowdy Cup 2023 tournament into prod (tournaments/2023RowdyCup,
 * a roster-only shell with empty roundIds). Adds 2 courses + 4 rounds + 20 matches.
 *
 *  - R1/R2/R4 come from rowdy_cup_2023_scorecards_complete.csv (standard format).
 *  - R3 (Shamble) comes from "2023RC round 3 - Sheet1.csv" (per-player gross), as
 *    twoManShamble (best-ball). NOTE: 2023 R3 was actually tallied by SUMMED totals;
 *    best-ball keeps every winner but a few margins differ (e.g. Fabozzi/Bodmer
 *    reads 2 up vs the summed 3 up). R3 has only 5 of 6 matches here — Benko/Sloan
 *    vs Pierro/Euckert (would be R03M01) is omitted (no per-player data yet).
 *
 *  Team mapping (current/swapped orientation): 86ERS => teamA (blue/left),
 *  SHANKAHOLICS => teamB (red/right).
 *
 *  Decisions: R4 (4-Man Scramble) = twoManScramble @ 2 pts/match (24 total). R4 M2
 *  ("1&1") conceded -> halve H18. Courses We-Ko-Pa Cholla (par 72, R1/R4) + Saguaro
 *  (par 71, R2/R3) created from the CSV par/SI (no yardage/rating).
 *
 *  Usage: node import-rowdycup-2023.js [--commit]
 */

const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");

const PROJECT = "rowdy-pwa";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const COMMIT = process.argv.includes("--commit");
const TID = "2023RowdyCup";
const MAIN_CSV = path.join(__dirname, "data", "rowdy_cup_2023_scorecards_complete.csv");
const SHEETS_CSV = path.join(__dirname, "data", "2023RC round 3 - Sheet1.csv");
const SYNTH = { "4-2": [18] }; // R4 M2 "1&1" conceded -> halve H18

const NAME_TO_ID = {
  // 86ers (teamA)
  "Dan Barnes": "pDanBarnes", "Dave Mower": "pDavidMower", "Luke Davie": "pLukeDavie",
  "Todd Euckert": "pToddEuckert", "JP Saar": "pJPSaar", "Jason Dugan": "pJasonDugan",
  "Anthony Pierro": "pAnthonyPierro", "Todd Robinson": "pToddRobinson", "Jake Kushner": "pJakeKushner",
  "Adam Reinwasser": "pAdamReinwasser", "raymond Warner": "pRaymondWarner", "Raymond Warner": "pRaymondWarner",
  "Mike Mcdermaid": "pMikeMcDermaid",
  // Shankaholics (teamB)
  "Steve Sloan": "pSteveSloan", "Steve Bodmer": "pSteveBodmer", "Jared Lardeur": "pJaredLardeur",
  "Joe Houser": "pJoeHouser", "Phil Salazar": "pPhilSalazar", "Cody Pletcher": "pCodyPletcher",
  "Jacob Fabozzi": "pJakeFabozzi", "Dave Mulcahey": "pDaveMulcahey", "Ryan Benko": "pRyanBenko",
  "Sean Horan": "pSeanHoran", "Lou Mazzarese": "pLouMazzarese", "Ryan Herndon": "pRyanHerndon",
};
function pid(name) { const id = NAME_TO_ID[name.trim()]; if (!id) throw new Error(`Unknown player: "${name}"`); return id; }
function sideOf(team) { const t = team.trim().toUpperCase(); if (t === "86ERS") return "A"; if (t === "SHANKAHOLICS") return "B"; throw new Error(`Unknown team: "${team}"`); }

const ROUNDS = [
  { day: 1, format: "twoManScramble", courseId: "wekopa-Cholla",  pointsValue: 1, trackDrives: false },
  { day: 2, format: "twoManBestBall", courseId: "wekopa-Saguaro", pointsValue: 1, trackDrives: false },
  { day: 3, format: "twoManShamble",  courseId: "wekopa-Saguaro", pointsValue: 1, trackDrives: false },
  { day: 4, format: "twoManScramble", courseId: "wekopa-Cholla",  pointsValue: 2, trackDrives: false },
];
const roundIdFor = (r) => `${TID}-R0${r}`;
const matchIdFor = (r, n) => `${TID}-R0${r}M0${n}`;
const TEAM_NAME = { teamA: "86ers", teamB: "Shankaholics" };

// ---------------------------------------------------------------------------
// CSV parsing (standard ROW_TYPE format) — R1/R2/R4
// ---------------------------------------------------------------------------
const ROW_TYPES = new Set(["MATCH_HEADER", "PAR", "SI", "TEAM_SCORE", "PLAYER_HDCP", "PLAYER_SCORE", "PLAYER_STROKES"]);
const COL = { TYPE: 0, ROUND: 1, MATCH_NO: 3, COURSE: 4, TEAM: 5, PLAYER: 6, COURSE_HDCP: 8, MATCHPLAY: 11, WINNER: 12, SCORE: 13, HOLES: 14, H1: 16 };
function num(s) { if (s === undefined) return null; const t = String(s).trim(); if (t === "") return null; const v = Number(t); return Number.isFinite(v) ? v : null; }
function holes18(cells, h1) { const out = []; for (let i = 0; i < 18; i++) out.push(num(cells[h1 + i])); return out; }

function parseMain() {
  const rows = fs.readFileSync(MAIN_CSV, "utf8").split(/\r?\n/).map((l) => l.split(",")).filter((c) => ROW_TYPES.has((c[COL.TYPE] || "").trim()));
  const matches = []; let cur = null;
  for (const c of rows) {
    const type = c[COL.TYPE].trim();
    if (type === "MATCH_HEADER") {
      cur = { roundNo: parseInt(c[COL.ROUND].trim().match(/R(\d)/)[1], 10), matchNo: parseInt(c[COL.MATCH_NO].trim(), 10),
        winner: c[COL.WINNER].trim(), score: c[COL.SCORE].trim(), holesPlayed: num(c[COL.HOLES]),
        par: null, si: null, teams: { A: { pairing: null, teamGross: null }, B: { pairing: null, teamGross: null } }, hdcp: [], scores: [], aggShamble: false };
      matches.push(cur);
    } else if (type === "PAR") cur.par = holes18(c, COL.H1);
    else if (type === "SI") cur.si = holes18(c, COL.H1);
    else if (type === "TEAM_SCORE") { const s = sideOf(c[COL.TEAM]); cur.teams[s].pairing = c[COL.PLAYER].trim(); cur.teams[s].teamGross = holes18(c, COL.H1); }
    else if (type === "PLAYER_HDCP") cur.hdcp.push({ side: sideOf(c[COL.TEAM]), name: c[COL.PLAYER].trim(), courseHdcp: num(c[COL.COURSE_HDCP]), matchplay: num(c[COL.MATCHPLAY]) });
    else if (type === "PLAYER_SCORE") cur.scores.push({ side: sideOf(c[COL.TEAM]), name: c[COL.PLAYER].trim(), gross: holes18(c, COL.H1) });
  }
  return matches.filter((m) => m.roundNo !== 3); // R3 comes from the sheets export
}

// ---------------------------------------------------------------------------
// Sheets export parsing — R3 per-player gross
// ---------------------------------------------------------------------------
function splitCsv(s) { const out = []; let cur = "", q = false; for (let i = 0; i < s.length; i++) { const ch = s[i]; if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else { if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; } } out.push(cur); return out; }
function parseSheetLine(line) { let s = line; if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/""/g, '"'); return splitCsv(s); }

function parseSheetsR3(par, si) {
  const lines = fs.readFileSync(SHEETS_CSV, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  const SH1 = 5; // H1 column in the sheet
  const byMatch = new Map();
  for (const line of lines) {
    const c = parseSheetLine(line);
    const match = (c[0] || "").trim();
    if (!match.includes(" vs ")) continue; // skip header / Course Par/SI rows
    if (!byMatch.has(match)) byMatch.set(match, []);
    byMatch.get(match).push(c);
  }
  const out = []; let n = 0;
  for (const [match, rows] of byMatch) {
    n++; // matchNo = sheet order; Benko/Sloan is first -> R03M01
    const [pairShank, pair86] = match.split(" vs ").map((s) => s.trim());
    const sideOfPair = (p) => (p === pairShank ? "B" : "A");
    const m = { roundNo: 3, matchNo: n, par, si, winner: null, score: null, holesPlayed: null,
      teams: { A: { pairing: pair86, teamGross: null }, B: { pairing: pairShank, teamGross: null } },
      hdcp: [], scores: [], teamTotal: { A: null, B: null }, aggShamble: true };
    for (const c of rows) {
      const pairing = (c[3] || "").trim(), name = (c[4] || "").trim();
      const vals = holes18(c, SH1);
      if (name === "TEAM TOTAL") {
        const s = sideOfPair(pairing); m.teamTotal[s] = vals;
        const res = (c[26] || "").trim();
        if (res) { const mm = res.match(/^(.+?)\s+wins\s+(\d+)\s*up/i); if (mm) { m.winner = mm[1].trim(); m.score = `${mm[2]} UP`; } }
      } else if (name && name !== "Hole Winner") {
        const s = sideOfPair(pairing);
        m.scores.push({ side: s, name, gross: vals });
        m.hdcp.push({ side: s, name, courseHdcp: 0, matchplay: 0 });
      }
    }
    // team gross = best ball (min) per hole; holesPlayed = last hole anyone scored
    for (const s of ["A", "B"]) {
      const ps = m.scores.filter((x) => x.side === s);
      m.teams[s].teamGross = Array.from({ length: 18 }, (_, i) => {
        const v = ps.map((p) => p.gross[i]).filter((x) => x != null);
        return v.length ? Math.min(...v) : null;
      });
    }
    let hp = 0; for (let i = 0; i < 18; i++) if (m.teams.A.teamGross[i] != null && m.teams.B.teamGross[i] != null) hp = i + 1;
    m.holesPlayed = hp;
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build match docs (shared)
// ---------------------------------------------------------------------------
function strokesFromMatchplay(si, mp) { return si.map((s) => (mp > 0 && s <= mp ? 1 : 0)); }
function buildPlayersForSide(m, side) {
  return m.hdcp.filter((h) => h.side === side).map((h) => {
    const isBestBall = ROUNDS[m.roundNo - 1].format === "twoManBestBall";
    return { playerId: pid(h.name), name: h.name, strokesReceived: isBestBall ? strokesFromMatchplay(m.si, h.matchplay || 0) : new Array(18).fill(0), courseHdcp: h.courseHdcp };
  });
}
function grossArrFor(m, side, name) { const r = m.scores.find((s) => s.side === side && s.name === name); return r ? r.gross.slice() : null; }
function halvedInput(format, par) {
  if (format === "twoManScramble") return { teamAGross: par, teamBGross: par, teamADrive: null, teamBDrive: null };
  if (format === "twoManShamble") return { teamAPlayersGross: [par, par], teamBPlayersGross: [par, par], teamADrive: null, teamBDrive: null };
  return { teamAPlayersGross: [par, par], teamBPlayersGross: [par, par] };
}
function buildMatch(m) {
  const r = ROUNDS[m.roundNo - 1]; const format = r.format;
  const teamAPlayers = buildPlayersForSide(m, "A"), teamBPlayers = buildPlayersForSide(m, "B");
  const courseHandicaps = [...teamAPlayers, ...teamBPlayers].map((p) => Math.round(p.courseHdcp ?? 0));
  const notes = [];
  const holes = {};
  if (format === "twoManScramble") {
    for (let i = 0; i < 18; i++) holes[String(i + 1)] = { input: { teamAGross: m.teams.A.teamGross[i], teamBGross: m.teams.B.teamGross[i], teamADrive: null, teamBDrive: null } };
  } else {
    const gA = [grossArrFor(m, "A", teamAPlayers[0].name), grossArrFor(m, "A", teamAPlayers[1].name)];
    const gB = [grossArrFor(m, "B", teamBPlayers[0].name), grossArrFor(m, "B", teamBPlayers[1].name)];
    const fill = (g, side) => { for (let i = 0; i < 18; i++) { const p0 = g[0][i], p1 = g[1][i];
      if (p0 == null && p1 != null) { g[0][i] = m.par[i] + 2; notes.push(`${side} p1 H${i + 1} pickup->${g[0][i]}`); }
      else if (p1 == null && p0 != null) { g[1][i] = m.par[i] + 2; notes.push(`${side} p2 H${i + 1} pickup->${g[1][i]}`); } } };
    fill(gA, "A"); fill(gB, "B");
    for (let i = 0; i < 18; i++) { const input = { teamAPlayersGross: [gA[0][i], gA[1][i]], teamBPlayersGross: [gB[0][i], gB[1][i]] };
      if (format === "twoManShamble") { input.teamADrive = null; input.teamBDrive = null; } holes[String(i + 1)] = { input }; }
  }
  let synthNote = null;
  const synthHoles = SYNTH[`${m.roundNo}-${m.matchNo}`];
  if (synthHoles) { for (const hn of synthHoles) holes[String(hn)] = { input: halvedInput(format, m.par[hn - 1]) }; synthNote = `concession: halved H${synthHoles.join(",")} @ par`; }
  if (notes.length) synthNote = (synthNote ? synthNote + "; " : "") + notes.join(", ");
  const id = matchIdFor(m.roundNo, m.matchNo);
  const doc = { id, roundId: roundIdFor(m.roundNo), tournamentId: TID, matchNumber: m.matchNo, courseHandicaps,
    teamAPlayers: teamAPlayers.map((p) => ({ playerId: p.playerId, strokesReceived: p.strokesReceived })),
    teamBPlayers: teamBPlayers.map((p) => ({ playerId: p.playerId, strokesReceived: p.strokesReceived })),
    authorizedUids: [], holes, status: { leader: null, margin: 0, thru: 0, dormie: false, closed: false }, result: {},
    _importSource: m.aggShamble ? "2023RC round 3 - Sheet1.csv" : "rowdy_cup_2023_scorecards_complete.csv" };
  return { m, format, doc, teamAPlayers, teamBPlayers, synthNote };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const isG = (n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 30;
const c01 = (n) => (Number(n) === 1 ? 1 : 0);
function decideHole(format, i, doc) {
  const h = doc.holes[String(i)]?.input ?? {};
  if (format === "twoManScramble") { const a = h.teamAGross, b = h.teamBGross; if (!isG(a) || !isG(b)) return null; return a < b ? "teamA" : b < a ? "teamB" : "AS"; }
  if (format === "twoManShamble") { const a = h.teamAPlayersGross || [], b = h.teamBPlayersGross || []; if (![a[0], a[1], b[0], b[1]].every(isG)) return null; const aB = Math.min(a[0], a[1]), bB = Math.min(b[0], b[1]); return aB < bB ? "teamA" : bB < aB ? "teamB" : "AS"; }
  const a = h.teamAPlayersGross || [], b = h.teamBPlayersGross || []; if (![a[0], a[1], b[0], b[1]].every(isG)) return null;
  const net = (g, idx, arr) => g - c01(arr?.[idx]?.strokesReceived?.[i - 1]);
  const aB = Math.min(net(a[0], 0, doc.teamAPlayers), net(a[1], 1, doc.teamAPlayers)), bB = Math.min(net(b[0], 0, doc.teamBPlayers), net(b[1], 1, doc.teamBPlayers));
  return aB < bB ? "teamA" : bB < aB ? "teamB" : "AS";
}
function summarize(format, doc) {
  let a = 0, b = 0, thru = 0, rm = 0, decided = false;
  for (let i = 1; i <= 18; i++) { if (decided) break; const res = decideHole(format, i, doc); if (res === null) continue; thru = i; if (res === "teamA") { a++; rm++; } else if (res === "teamB") { b++; rm--; } if (Math.abs(rm) > 18 - i) decided = true; }
  const leader = a > b ? "teamA" : b > a ? "teamB" : null, margin = Math.abs(a - b), holesLeft = 18 - thru;
  return { thru, leader, margin, closed: (leader !== null && margin > holesLeft) || thru === 18, winner: thru === 18 && a === b ? "AS" : leader ?? "AS" };
}
function expectedFromCsv(m) {
  let side = "AS";
  if (m.winner && m.winner !== "HALVED") { if (m.teams.A.pairing === m.winner) side = "teamA"; else if (m.teams.B.pairing === m.winner) side = "teamB"; else side = "??(" + m.winner + ")"; }
  let margin = 0; if (/^\d+&\d+$/.test(m.score)) margin = Number(m.score.split("&")[0]); else if (/UP$/i.test(m.score)) margin = parseInt(m.score, 10);
  return { side, margin };
}
// per-hole integrity: scramble skip; bestBall best-net vs TEAM_SCORE; shamble(R3)
// verify per-player SUM == sheet TEAM TOTAL (catches transcription in per-player gross)
function teamScoreMismatches(b) {
  const { m, format, doc } = b; const out = [];
  if (format === "twoManScramble") return out;
  for (const side of ["A", "B"]) {
    const key = side === "A" ? "teamAPlayersGross" : "teamBPlayersGross";
    for (let i = 0; i < 18; i++) {
      const g = doc.holes[String(i + 1)].input[key]; if (!isG(g[0]) || !isG(g[1])) continue;
      if (m.aggShamble) { const tt = m.teamTotal[side]; if (!tt || tt[i] == null) continue; if (g[0] + g[1] !== tt[i]) out.push(`${side} H${i + 1}: sum ${g[0] + g[1]} vs sheet ${tt[i]}`); }
      else { const exp = m.teams[side].teamGross[i]; if (exp == null) continue; const players = side === "A" ? doc.teamAPlayers : doc.teamBPlayers;
        const best = format === "twoManBestBall" ? Math.min(g[0] - c01(players[0].strokesReceived[i]), g[1] - c01(players[1].strokesReceived[i])) : Math.min(g[0], g[1]);
        if (best !== exp) out.push(`${side} H${i + 1}: ${best} vs CSV ${exp}`); }
    }
  }
  return out;
}
function buildCourse(id, name, par, si) { return { id, name, tees: "", par: par.reduce((s, p) => s + p, 0), holes: par.map((p, i) => ({ number: i + 1, par: p, hcpIndex: si[i] })) }; }

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------
function httpJson(url, method, body, headers) { return new Promise((res, rej) => { const r = https.request(url, { method, headers: headers || {} }, (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => x.statusCode >= 400 ? rej(new Error(`HTTP ${x.statusCode} ${url}\n${d.slice(0, 600)}`)) : res(d ? JSON.parse(d) : {})); }); r.on("error", rej); if (body) r.write(body); r.end(); }); }
function mintToken() { const c = require(os.homedir() + "/.config/configstore/firebase-tools.json"); const body = new URLSearchParams({ client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com", client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi", refresh_token: c.tokens.refresh_token, grant_type: "refresh_token" }).toString(); return httpJson("https://oauth2.googleapis.com/token", "POST", body, { "Content-Type": "application/x-www-form-urlencoded" }).then((j) => { if (!j.access_token) throw new Error("token mint failed"); return j.access_token; }); }
function toValue(v) { if (v === null || v === undefined) return { nullValue: null }; if (typeof v === "boolean") return { booleanValue: v }; if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }; if (typeof v === "string") return { stringValue: v }; if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } }; if (typeof v === "object") { const f = {}; for (const k of Object.keys(v)) f[k] = toValue(v[k]); return { mapValue: { fields: f } }; } throw new Error("encode " + typeof v); }
async function writeDoc(token, p, obj, mask) { const f = {}; for (const k of Object.keys(obj)) f[k] = toValue(obj[k]); const q = mask ? "?" + mask.map((x) => `updateMask.fieldPaths=${encodeURIComponent(x)}`).join("&") : ""; await httpJson(`${BASE}/${p}${q}`, "PATCH", JSON.stringify({ fields: f }), { "Content-Type": "application/json", Authorization: "Bearer " + token }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
(async () => {
  const main = parseMain();
  const r2sample = main.find((m) => m.roundNo === 2);
  const r3 = parseSheetsR3(r2sample.par, r2sample.si); // R3 shares the Saguaro (R2) par/SI
  const parsed = [...main, ...r3];
  const built = parsed.map(buildMatch);

  const r1 = main.find((m) => m.roundNo === 1);
  const courses = [buildCourse("wekopa-Cholla", "We-Ko-Pa (Cholla)", r1.par, r1.si), buildCourse("wekopa-Saguaro", "We-Ko-Pa (Saguaro)", r2sample.par, r2sample.si)];

  const rounds = ROUNDS.map((r, idx) => { const rn = idx + 1; const matchIds = built.filter((b) => b.m.roundNo === rn).map((b) => b.doc.id);
    return { id: roundIdFor(rn), tournamentId: TID, day: r.day, format: r.format, courseId: r.courseId, pointsValue: r.pointsValue, skinsGrossPot: 0, skinsNetPot: 0, trackDrives: r.trackDrives, locked: false, matchIds }; });

  const fmtLabel = { twoManScramble: "Scramble", twoManBestBall: "Best Ball", twoManShamble: "Shamble" };
  let teamA = 0, teamB = 0, mismatches = 0, holeMismatches = 0;
  console.log(`\n=== Rowdy Cup 2023 import (tournaments/${TID}) ===`);
  console.log(`86ers => teamA (left)   Shankaholics => teamB (right)`);
  console.log(`Courses: ${courses.map((c) => c.id + " (par " + c.par + ")").join(", ")}`);
  console.log(`R3 = best-ball Shamble from per-player sheet\n`);

  for (let rn = 1; rn <= 4; rn++) {
    const r = ROUNDS[rn - 1];
    console.log(`--- R${rn} ${fmtLabel[r.format]} @ ${r.courseId} (${r.pointsValue} pt) ---`);
    for (const b of built.filter((x) => x.m.roundNo === rn).sort((x, y) => x.m.matchNo - y.m.matchNo)) {
      const sum = summarize(b.format, b.doc), exp = expectedFromCsv(b.m);
      const winOk = sum.winner === exp.side;
      const marginOk = b.m.aggShamble ? true : (sum.winner === "AS" ? true : sum.margin === exp.margin); // R3 best-ball margins differ from summed
      const ok = winOk && marginOk && sum.closed;
      if (!ok) mismatches++;
      const hm = teamScoreMismatches(b); holeMismatches += hm.length; if (hm.length) console.log(`     ! integrity: ${hm.join("; ")}`);
      const pts = r.pointsValue; if (sum.winner === "teamA") teamA += pts; else if (sum.winner === "teamB") teamB += pts; else { teamA += pts / 2; teamB += pts / 2; }
      const aN = b.teamAPlayers.map((p) => p.name.split(" ").slice(-1)[0]).join("/"), bN = b.teamBPlayers.map((p) => p.name.split(" ").slice(-1)[0]).join("/");
      const res = sum.winner === "AS" ? "HALVED AS" : `${sum.winner === "teamA" ? aN : bN} ${sum.margin}${sum.thru < 18 ? "&" + (18 - sum.thru) : " UP"}`;
      const aggNote = b.m.aggShamble && !marginOk ? "" : "";
      console.log(`  M${b.m.matchNo} ${b.doc.id}  A[${aN}] vs B[${bN}]  => ${res}  | CSV: ${b.m.winner} ${b.m.score}  ${ok ? "OK" : "*** MISMATCH ***"}${b.m.aggShamble ? "  [best-ball]" : ""}${b.synthNote ? "  (" + b.synthNote + ")" : ""}`);
    }
  }

  console.log(`\nFinal tally (R4 @ 2pts): ${TEAM_NAME.teamA}(A) ${teamA}  -  ${TEAM_NAME.teamB}(B) ${teamB}   [total ${teamA + teamB}]`);
  console.log(`Result validation:  ${mismatches === 0 ? "ALL MATCH (" + built.length + " matches)" : mismatches + " MISMATCH(ES)"}`);
  console.log(`Integrity checks:   ${holeMismatches === 0 ? "ALL MATCH" : holeMismatches + " MISMATCH(ES)"}`);
  if (mismatches > 0 || holeMismatches > 0) { console.error("\nAborting: fix mismatches before committing."); process.exit(1); }
  if (!COMMIT) { console.log("\nDRY RUN — no writes. Re-run with --commit.\n"); return; }

  const token = await mintToken();
  console.log("\nWriting courses..."); for (const co of courses) await writeDoc(token, `courses/${co.id}`, co);
  console.log("Writing rounds..."); for (const r of rounds) { await writeDoc(token, `rounds/${r.id}`, r); await sleep(200); }
  await sleep(3000);
  console.log("Writing matches (full docs)..."); for (const b of built) { await writeDoc(token, `matches/${b.doc.id}`, b.doc); await sleep(150); }
  await sleep(4000);
  console.log("Forcing recompute (masked)..."); for (const b of built) { await writeDoc(token, `matches/${b.doc.id}`, { _computeSig: "stale", _touch: Date.now() }, ["_computeSig", "_touch"]); await sleep(150); }
  await sleep(1500);
  console.log("Setting tournament.roundIds..."); await writeDoc(token, `tournaments/${TID}`, { roundIds: rounds.map((r) => r.id) }, ["roundIds"]);
  console.log("\nDone. Triggers compute status/result/facts/stats over ~30s.");
})().catch((e) => { console.error("\nERROR", e.message); process.exit(1); });
