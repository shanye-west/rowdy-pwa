#!/usr/bin/env node
/**
 * One-time migration: move player PII (`email` + `scoutingNotes`) off the
 * world-readable `players/{id}` doc into the server-only private subcollection
 * `players/{id}/private/profile`.
 *
 * Why: the players collection is public-read (display names/photos are shown
 * app-wide, including to logged-out visitors). Firestore read rules are
 * document-level, so keeping email/scoutingNotes on the doc exposed them to
 * anyone. After this migration those fields live in `private/profile`, which is
 * `allow read, write: if false` — reachable only by the Admin SDK (the admin
 * getPlayerPrivate callable + the shared-key MCP relay).
 *
 * Run this AFTER deploying the functions that read/write the new location
 * (updatePlayerInfo / linkAuthToPlayer / getPlayerPrivate / MCP adminReads) and
 * BEFORE deploying the client that reads via getPlayerPrivate. Deploying the
 * private-subcollection rule can happen with the rest of the rules at any point.
 *
 * Reads/writes via the firebase-tools refresh token → OAuth → Firestore REST,
 * same pattern as the import + cleanup scripts. PROD — there is no dev DB.
 * Idempotent: re-running only re-copies fields that are still on the doc.
 *
 * Usage:
 *   node scripts/migrate-player-pii.js            # dry-run (survey only)
 *   node scripts/migrate-player-pii.js --apply    # perform the migration
 */
const https = require("https");
const os = require("os");

const PROJECT = "rowdy-pwa";
const V1 = "https://firestore.googleapis.com/v1";
const DOCS = `${V1}/projects/${PROJECT}/databases/(default)/documents`;

const APPLY = process.argv.includes("--apply");

function httpReq(url, method, body, headers) {
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
  return httpReq("https://oauth2.googleapis.com/token", "POST", body, {
    "Content-Type": "application/x-www-form-urlencoded",
  }).then((j) => {
    if (!j.access_token) throw new Error("token mint failed");
    return j.access_token;
  });
}

/** Top-level players docs only (allDescendants defaults to false). */
async function fetchPlayers(token) {
  const query = { structuredQuery: { from: [{ collectionId: "players" }] } };
  const rows = await httpReq(`${DOCS}:runQuery`, "POST", JSON.stringify(query), {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
  });
  return rows.filter((r) => r.document).map((r) => r.document);
}

(async () => {
  const token = await mintToken();
  const auth = { Authorization: "Bearer " + token };
  const authJson = { ...auth, "Content-Type": "application/json" };
  const players = await fetchPlayers(token);

  // A player needs migrating if the doc still carries email and/or scoutingNotes.
  const targets = players
    .map((d) => {
      const id = d.name.split("/players/")[1];
      const f = d.fields || {};
      const email = f.email?.stringValue;
      const scoutingNotes = f.scoutingNotes?.stringValue;
      return { id, email, scoutingNotes };
    })
    .filter((p) => p.email !== undefined || p.scoutingNotes !== undefined);

  console.log(`Players scanned: ${players.length}`);
  console.log(`Players with PII still on the doc: ${targets.length}`);
  for (const p of targets) {
    console.log(
      `  ${p.id}: ${p.email ? "email" : "—"}${p.scoutingNotes ? " +scoutingNotes" : ""}`
    );
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to migrate.");
    return;
  }

  let n = 0;
  for (const p of targets) {
    // 1) Write the private profile (creates players/{id}/private/profile).
    const fields = {};
    if (p.email !== undefined) fields.email = { stringValue: p.email };
    if (p.scoutingNotes !== undefined) fields.scoutingNotes = { stringValue: p.scoutingNotes };
    await httpReq(
      `${DOCS}/players/${p.id}/private/profile`,
      "PATCH",
      JSON.stringify({ fields }),
      authJson
    );

    // 2) Delete the fields from the public doc. updateMask names only the fields
    // to change; omitting them from the body deletes them and leaves the rest
    // (displayName/authUid/isAdmin/…) untouched.
    const masks = [];
    if (p.email !== undefined) masks.push("email");
    if (p.scoutingNotes !== undefined) masks.push("scoutingNotes");
    const qs = masks.map((m) => `updateMask.fieldPaths=${m}`).join("&");
    await httpReq(`${DOCS}/players/${p.id}?${qs}`, "PATCH", JSON.stringify({ fields: {} }), authJson);

    console.log(`  migrated ${++n}/${targets.length}: ${p.id}`);
  }
  console.log(`Done. Migrated PII for ${n} player(s) into players/{id}/private/profile.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
