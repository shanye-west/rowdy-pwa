#!/usr/bin/env node
/**
 * One-time cleanup of orphaned in-app notification docs
 * (players/{id}/notifications/{nid}) that predate the message-delete / TTL
 * plumbing and would otherwise linger on players' bells forever.
 *
 * Context: notifications are convenience history for the bell + unread badge.
 * Before sourceId stamping (see functions/src/messaging/notify.ts) there was no
 * way to remove a notification when its source message was deleted, and the
 * earliest docs were written without `expireAt` so the Firestore TTL never reaps
 * them. This script sweeps the `notifications` collection group and deletes by
 * scope. Reads via the firebase-tools refresh token → OAuth → Firestore REST,
 * same pattern as the import scripts. PROD — no dev environment.
 *
 * Usage:
 *   node scripts/cleanup-orphan-notifications.js                # dry-run (survey only)
 *   node scripts/cleanup-orphan-notifications.js --delete=no-ttl # delete docs missing expireAt
 *   node scripts/cleanup-orphan-notifications.js --delete=all    # delete EVERY notification doc
 */
const https = require("https");
const os = require("os");

const PROJECT = "rowdy-pwa";
const V1 = "https://firestore.googleapis.com/v1";
const DOCS = `${V1}/projects/${PROJECT}/databases/(default)/documents`;

const mode = (process.argv.find((a) => a.startsWith("--delete=")) || "").split("=")[1] || "";
const DELETE = mode === "all" || mode === "no-ttl";

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

// Collection-group query over every `notifications` subcollection.
async function fetchAll(token) {
  const query = {
    structuredQuery: { from: [{ collectionId: "notifications", allDescendants: true }] },
  };
  const rows = await httpReq(`${DOCS}:runQuery`, "POST", JSON.stringify(query), {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
  });
  return rows.filter((r) => r.document).map((r) => r.document);
}

(async () => {
  const token = await mintToken();
  const docs = await fetchAll(token);

  const withTtl = docs.filter((d) => d.fields && d.fields.expireAt);
  const noTtl = docs.filter((d) => !(d.fields && d.fields.expireAt));

  console.log(`Total notification docs: ${docs.length}`);
  console.log(`  with expireAt (self-cleaning): ${withTtl.length}`);
  console.log(`  WITHOUT expireAt (will never auto-reap): ${noTtl.length}`);
  console.log("\nSample (up to 12):");
  for (const d of docs.slice(0, 12)) {
    const player = d.name.split("/players/")[1]?.split("/notifications/")[0];
    const body = d.fields?.body?.stringValue || "";
    const ttl = d.fields?.expireAt ? "ttl" : "NO-ttl";
    console.log(`  [${ttl}] ${player}: ${body}`);
  }

  if (!DELETE) {
    console.log("\nDry-run only. Re-run with --delete=no-ttl or --delete=all to delete.");
    return;
  }

  const targets = mode === "all" ? docs : noTtl;
  console.log(`\nDeleting ${targets.length} docs (mode=${mode})...`);
  let n = 0;
  for (const d of targets) {
    await httpReq(`${V1}/${d.name}`, "DELETE", null, { Authorization: "Bearer " + token });
    if (++n % 25 === 0) console.log(`  deleted ${n}/${targets.length}`);
  }
  console.log(`Done. Deleted ${n} notification docs.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
