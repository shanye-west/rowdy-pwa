#!/usr/bin/env node
/*
  scripts/updateHandicaps.js

  Bulk-update players' handicaps for a given tournament.

  Usage:
    # Dry-run (no writes):
    node scripts/updateHandicaps.js --tournament <tournamentId> --file handicaps.csv --dry-run

    # Perform update (needs Firebase admin credentials)
    GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json node scripts/updateHandicaps.js --tournament <tournamentId> --file handicaps.csv

  CSV format (no header required):
    playerId,handicap
    abc123,12.3
    def456,9.8

  The script will detect whether each player is on teamA or teamB (based on rosterByTier)
  and update the corresponding field under `teamA.handicapByPlayer.<playerId>` or
  `teamB.handicapByPlayer.<playerId>`.
*/

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function usageAndExit(msg) {
  if (msg) console.error(msg);
  console.log('\nUsage: node scripts/updateHandicaps.js --tournament <tournamentId> --file <csvPath> [--dry-run]');
  process.exit(msg ? 1 : 0);
}

const argv = require('minimist')(process.argv.slice(2));
const tournamentId = argv.tournament || argv.t;
const file = argv.file || argv.f;
const dryRun = argv['dry-run'] || argv.dryRun || false;

if (!tournamentId || !file) {
  usageAndExit('Missing required arguments.');
}

// Initialize firebase-admin. Use APPLICATION DEFAULT or service account via env var
try {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
} catch (err) {
  console.error('Failed to initialize firebase-admin:', err.message || err);
  process.exit(1);
}

const db = admin.firestore();

function parseJson(content) {
  // Accepts either:
  // - An object mapping { playerId: handicap, ... }
  // - An array of objects [{ playerId, handicap }, ...]
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error('Invalid JSON file');
  }

  if (Array.isArray(parsed)) {
    // normalize array entries to { playerId, handicap }
    return parsed.map(item => {
      if (typeof item === 'object' && item !== null) {
        return { playerId: item.playerId || item.id || item.player || item.pid, handicap: item.handicap ?? item.hcp ?? item.handicapByPlayer };
      }
      return null;
    }).filter(Boolean);
  }

  if (typeof parsed === 'object' && parsed !== null) {
    // treat as mapping
    return Object.keys(parsed).map(k => ({ playerId: k, handicap: parsed[k] }));
  }

  throw new Error('JSON must be an object map or array of entries');
}

async function main() {
  const jsonPath = path.resolve(file);
  if (!fs.existsSync(jsonPath)) {
    console.error('File not found:', jsonPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, 'utf8');
  let rows;
  try {
    rows = parseJson(raw);
  } catch (err) {
    console.error('Failed to parse JSON:', err.message || err);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.error('No entries found in JSON');
    process.exit(1);
  }

  console.log(`Loading tournament '${tournamentId}'...`);
  const tRef = db.collection('tournaments').doc(tournamentId);
  const snap = await tRef.get();
  if (!snap.exists) {
    console.error('Tournament not found:', tournamentId);
    process.exit(1);
  }
  const tournament = snap.data() || {};

  // flatten roster ids for team A and B
  const flatten = (rosterByTier) => {
    if (!rosterByTier) return [];
    return Object.values(rosterByTier).flat();
  };

  const teamAIds = flatten(tournament.teamA?.rosterByTier);
  const teamBIds = flatten(tournament.teamB?.rosterByTier);

  const updates = {};
  const skipped = [];
  const applied = [];

  for (const r of rows) {
    const pid = r.playerId;
    const rawH = r.handicap;
    if (!pid) {
      console.warn('Skipping entry with empty playerId');
      continue;
    }
    if (rawH == null || rawH === '') {
      console.warn('Skipping entry with empty handicap for', pid);
      continue;
    }
    const h = Number(rawH);
    if (!Number.isFinite(h)) {
      console.warn('Invalid handicap for', pid, '=>', rawH);
      skipped.push(pid);
      continue;
    }

    if (teamAIds.includes(pid)) {
      updates[`teamA.handicapByPlayer.${pid}`] = h;
      applied.push({ pid, team: 'A', h });
    } else if (teamBIds.includes(pid)) {
      updates[`teamB.handicapByPlayer.${pid}`] = h;
      applied.push({ pid, team: 'B', h });
    } else {
      console.warn('PlayerId not found on either team; skipping:', pid);
      skipped.push(pid);
    }
  }

  console.log('\nPlanned updates:', Object.keys(updates).length);
  if (dryRun) {
    console.log('(dry-run) The following updates would be applied:');
    console.table(applied);
    if (skipped.length) console.log('Skipped playerIds:', skipped.join(', '));
    process.exit(0);
  }

  if (Object.keys(updates).length === 0) {
    console.log('No updates to apply. Exiting.');
    process.exit(0);
  }

  console.log('Applying updates to tournament doc...');
  try {
    await tRef.update(updates);
    console.log('Update successful. Updated entries:');
    console.table(applied);
    if (skipped.length) console.log('Skipped playerIds:', skipped.join(', '));
  } catch (err) {
    console.error('Failed to apply updates:', err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
