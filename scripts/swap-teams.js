#!/usr/bin/env node
/**
 * Swap teamA <-> teamB for one or more tournaments so the other team renders on
 * the LEFT (the app hardcodes teamA=left, teamB=right). Resets both team colors
 * to "" so they fall back to the series defaults (rowdyCup: teamA #132448 blue,
 * teamB #bf203c red) => blue-left / red-right, matching the 2026 setup.
 *
 * Swaps, per tournament:
 *   - tournament.teamA <-> teamB (whole objects: name/logo/roster/handicaps/
 *     captains), color reset to "", inner id reset to its slot.
 *   - every match: teamAPlayers<->teamBPlayers, courseHandicaps halves, and each
 *     hole input's per-team field pairs. Then forces a recompute so
 *     status/result/facts/stats flip to the new orientation.
 *
 * All writes are MASKED (merge) — never a full-doc replace.
 *
 * Usage:
 *   node swap-teams.js                       # dry run, default 3 historical RCs
 *   node swap-teams.js --commit
 *   node swap-teams.js 2025RowdyCup --commit # specific tournament(s)
 */

const https = require("https");
const os = require("os");

const PROJECT = "rowdy-pwa";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const COMMIT = process.argv.includes("--commit");
const ARG_TIDS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const TIDS = ARG_TIDS.length ? ARG_TIDS : ["2025RowdyCup", "2024RowdyCup", "2023RowdyCup"];

// ---- REST helpers --------------------------------------------------------
function httpJson(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: headers || {} }, (res) => {
      let d = ""; res.on("data", (x) => (d += x));
      res.on("end", () => res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode} ${url}\n${d.slice(0, 500)}`)) : resolve(d ? JSON.parse(d) : {}));
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}
function mintToken() {
  const c = require(os.homedir() + "/.config/configstore/firebase-tools.json");
  const body = new URLSearchParams({
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi", refresh_token: c.tokens.refresh_token, grant_type: "refresh_token",
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
  if (typeof v === "object") { const fields = {}; for (const k of Object.keys(v)) fields[k] = toValue(v[k]); return { mapValue: { fields } }; }
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
  if ("mapValue" in val) { const o = {}; for (const k of Object.keys(val.mapValue.fields || {})) o[k] = fromValue(val.mapValue.fields[k]); return o; }
  return null;
}
async function patchMasked(token, path, obj, maskFields) {
  const fields = {}; for (const k of Object.keys(obj)) fields[k] = toValue(obj[k]);
  const mask = "?" + maskFields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
  await httpJson(`${BASE}/${path}${mask}`, "PATCH", JSON.stringify({ fields }), { "Content-Type": "application/json", Authorization: "Bearer " + token });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- swap logic ----------------------------------------------------------
const HOLE_PAIRS = [["teamAGross", "teamBGross"], ["teamADrive", "teamBDrive"], ["teamAPlayerGross", "teamBPlayerGross"], ["teamAPlayersGross", "teamBPlayersGross"]];
function swapInput(inp) {
  const o = { ...inp };
  for (const [a, b] of HOLE_PAIRS) {
    const hasA = a in o, hasB = b in o; if (!hasA && !hasB) continue;
    const av = o[a], bv = o[b];
    if (hasB) o[a] = bv; else delete o[a];
    if (hasA) o[b] = av; else delete o[b];
  }
  return o;
}
function swapHoles(holes) {
  const out = {};
  for (const k of Object.keys(holes || {})) out[k] = { ...holes[k], input: swapInput(holes[k]?.input || {}) };
  return out;
}

// ---- validation: infer format from input shape & recompute ---------------
const isG = (n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 30;
const c01 = (n) => (Number(n) === 1 ? 1 : 0);
function inferFormat(holes) {
  for (const k of Object.keys(holes || {})) {
    const i = holes[k]?.input || {};
    if ("teamAGross" in i) return "scramble";
    if ("teamAPlayerGross" in i) return "singles";
    if ("teamAPlayersGross" in i) return "teamADrive" in i ? "shamble" : "bestBall";
  }
  return "bestBall";
}
function decideHole(fmt, i, holes, teamAPlayers, teamBPlayers) {
  const h = holes[String(i)]?.input ?? {};
  if (fmt === "scramble") { const a = h.teamAGross, b = h.teamBGross; if (!isG(a) || !isG(b)) return null; return a < b ? "A" : b < a ? "B" : "AS"; }
  if (fmt === "singles") {
    const a = h.teamAPlayerGross, b = h.teamBPlayerGross; if (!isG(a) || !isG(b)) return null;
    const an = a - c01(teamAPlayers?.[0]?.strokesReceived?.[i - 1]), bn = b - c01(teamBPlayers?.[0]?.strokesReceived?.[i - 1]);
    return an < bn ? "A" : bn < an ? "B" : "AS";
  }
  const a = h.teamAPlayersGross || [], b = h.teamBPlayersGross || [];
  if (![a[0], a[1], b[0], b[1]].every(isG)) return null;
  if (fmt === "shamble") { const ab = Math.min(a[0], a[1]), bb = Math.min(b[0], b[1]); return ab < bb ? "A" : bb < ab ? "B" : "AS"; }
  const net = (g, idx, arr) => g - c01(arr?.[idx]?.strokesReceived?.[i - 1]);
  const ab = Math.min(net(a[0], 0, teamAPlayers), net(a[1], 1, teamAPlayers)), bb = Math.min(net(b[0], 0, teamBPlayers), net(b[1], 1, teamBPlayers));
  return ab < bb ? "A" : bb < ab ? "B" : "AS";
}
function summarize(holes, teamAPlayers, teamBPlayers) {
  const fmt = inferFormat(holes);
  let a = 0, b = 0, thru = 0, rm = 0, decided = false;
  for (let i = 1; i <= 18; i++) {
    if (decided) break;
    const r = decideHole(fmt, i, holes, teamAPlayers, teamBPlayers); if (r === null) continue;
    thru = i; if (r === "A") { a++; rm++; } else if (r === "B") { b++; rm--; }
    if (Math.abs(rm) > 18 - i) decided = true;
  }
  const leader = a > b ? "A" : b > a ? "B" : null, margin = Math.abs(a - b);
  const winner = thru === 18 && a === b ? "AS" : leader ?? "AS";
  return { winner, margin, thru };
}

// ---- main ----------------------------------------------------------------
(async () => {
  const token = await mintToken();
  const g = (p) => httpJson(`${BASE}/${p}`, "GET", null, { Authorization: "Bearer " + token });

  const RETRIGGER = process.argv.includes("--retrigger-facts");
  if (RETRIGGER) {
    // Touch every closed match so updateMatchFacts re-runs on the now-consistent
    // doc (correct players + result), fixing facts left stale by the swap-write
    // race (players changed before computeMatchOnWrite updated result).
    for (const tid of TIDS) {
      const q = { structuredQuery: { from: [{ collectionId: "matches" }], where: { fieldFilter: { field: { fieldPath: "tournamentId" }, op: "EQUAL", value: { stringValue: tid } } } } };
      const rows = await httpJson(`${BASE}:runQuery`, "POST", JSON.stringify(q), { "Content-Type": "application/json", Authorization: "Bearer " + token });
      const ids = rows.filter((r) => r.document).map((r) => r.document.name.split("/").pop());
      console.log(`${tid}: re-triggering facts for ${ids.length} matches...`);
      if (COMMIT) for (const id of ids) { await patchMasked(token, `matches/${id}`, { _touch: Date.now() }, ["_touch"]); await sleep(200); }
    }
    console.log(COMMIT ? "\nDone. updateMatchFacts + aggregatePlayerStats re-run over ~30s." : "\nDRY RUN — re-run with --commit.");
    return;
  }

  for (const tid of TIDS) {
    const tdoc = await g(`tournaments/${tid}`);
    const oldA = fromValue(tdoc.fields.teamA), oldB = fromValue(tdoc.fields.teamB);
    const newA = { ...oldB, id: "teamA", color: "" };
    const newB = { ...oldA, id: "teamB", color: "" };

    // matches via runQuery
    const q = { structuredQuery: { from: [{ collectionId: "matches" }], where: { fieldFilter: { field: { fieldPath: "tournamentId" }, op: "EQUAL", value: { stringValue: tid } } } } };
    const rows = await httpJson(`${BASE}:runQuery`, "POST", JSON.stringify(q), { "Content-Type": "application/json", Authorization: "Bearer " + token });
    const matches = rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split("/").pop(), f: r.document.fields }));

    console.log(`\n=== ${tid} ===`);
    console.log(`  LEFT (teamA): "${oldA.name}" -> "${newA.name}"   RIGHT (teamB): "${oldB.name}" -> "${newB.name}"`);
    console.log(`  colors reset to defaults (teamA blue, teamB red);  matches: ${matches.length}`);

    let flips = 0, bad = 0;
    for (const m of matches) {
      const holes = fromValue({ mapValue: { fields: m.f.holes?.mapValue?.fields || {} } }) || {};
      const tA = fromValue(m.f.teamAPlayers) || [], tB = fromValue(m.f.teamBPlayers) || [];
      const before = summarize(holes, tA, tB);
      const sHoles = swapHoles(holes);
      const after = summarize(sHoles, tB, tA);
      const expWinner = before.winner === "AS" ? "AS" : before.winner === "A" ? "B" : "A";
      const okFlip = after.winner === expWinner && after.margin === before.margin && after.thru === before.thru;
      if (before.winner !== "AS") flips++;
      if (!okFlip) { bad++; console.log(`   ! ${m.id}: before ${before.winner}/${before.margin}&${18 - before.thru} after ${after.winner}/${after.margin} (expected ${expWinner})`); }
    }
    console.log(`  validation: ${bad === 0 ? "all matches mirror cleanly" : bad + " PROBLEM(S)"}  (decisive matches: ${flips})`);
    if (bad > 0) { console.error(`  Aborting ${tid} — swap would not mirror correctly.`); process.exitCode = 1; continue; }

    if (!COMMIT) continue;

    // write tournament team swap (masked: only teamA/teamB)
    await patchMasked(token, `tournaments/${tid}`, { teamA: newA, teamB: newB }, ["teamA", "teamB"]);
    // write each match swap (masked) + force recompute
    for (const m of matches) {
      const holes = fromValue({ mapValue: { fields: m.f.holes?.mapValue?.fields || {} } }) || {};
      const tA = fromValue(m.f.teamAPlayers) || [], tB = fromValue(m.f.teamBPlayers) || [];
      const ch = m.f.courseHandicaps ? fromValue(m.f.courseHandicaps) : null;
      const upd = {
        teamAPlayers: tB, teamBPlayers: tA, holes: swapHoles(holes),
        _computeSig: "stale", _touch: Date.now(),
      };
      const mask = ["teamAPlayers", "teamBPlayers", "holes", "_computeSig", "_touch"];
      if (ch && tA.length) { upd.courseHandicaps = [...ch.slice(tA.length), ...ch.slice(0, tA.length)]; mask.push("courseHandicaps"); }
      await patchMasked(token, `matches/${m.id}`, upd, mask);
      await sleep(120);
    }
    console.log(`  committed swap for ${tid}.`);
  }

  if (!COMMIT) console.log("\nDRY RUN — no writes. Re-run with --commit.\n");
  else console.log("\nDone. Triggers recompute status/result/pointTotals/facts/stats over ~30s.");
})().catch((e) => { console.error("\nERROR", e.message); process.exit(1); });
