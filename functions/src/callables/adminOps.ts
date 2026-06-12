/**
 * Admin-only callables for managing tournaments, rounds, matches, and players
 * from the in-app Admin UI (instead of the Firestore console / seed scripts).
 *
 * All writes here go through the Admin SDK, which bypasses security rules —
 * every callable must therefore start with requireAdmin().
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { requireAdmin } from "../helpers/adminAuth.js";
import { isValidGross } from "../scoring/matchScoring.js";
import type { RoundFormat } from "../types.js";

const ROUND_FORMATS: RoundFormat[] = [
  "twoManBestBall",
  "twoManShamble",
  "twoManScramble",
  "fourManScramble",
  "singles",
];

const TIERS = ["A", "B", "C", "D"] as const;

function db() {
  return getFirestore();
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError("invalid-argument", `${field} is required`);
  }
  return value.trim();
}

// ============================================================================
// TOURNAMENT MANAGEMENT
// ============================================================================

/**
 * Validates and extracts the editable fields of a team object.
 * Only whitelisted keys are accepted; unknown keys are rejected so a typo
 * can't silently write garbage into the tournament doc.
 */
function sanitizeTeamUpdates(team: Record<string, unknown>, label: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(team)) {
    switch (key) {
      case "name":
      case "color":
      case "logo":
      case "captainId":
      case "coCaptainId":
        if (typeof value !== "string") {
          throw new HttpsError("invalid-argument", `${label}.${key} must be a string`);
        }
        out[key] = value;
        break;
      case "rosterByTier": {
        if (typeof value !== "object" || value === null) {
          throw new HttpsError("invalid-argument", `${label}.rosterByTier must be an object`);
        }
        const roster: Record<string, string[]> = {};
        for (const [tier, ids] of Object.entries(value)) {
          if (!TIERS.includes(tier as typeof TIERS[number])) {
            throw new HttpsError("invalid-argument", `${label}.rosterByTier has invalid tier "${tier}"`);
          }
          if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id)) {
            throw new HttpsError("invalid-argument", `${label}.rosterByTier.${tier} must be an array of player ids`);
          }
          roster[tier] = ids;
        }
        out.rosterByTier = roster;
        break;
      }
      case "handicapByPlayer": {
        if (typeof value !== "object" || value === null) {
          throw new HttpsError("invalid-argument", `${label}.handicapByPlayer must be an object`);
        }
        const handicaps: Record<string, number> = {};
        for (const [playerId, hcp] of Object.entries(value)) {
          if (typeof hcp !== "number" || !Number.isFinite(hcp) || hcp < -10 || hcp > 54) {
            throw new HttpsError("invalid-argument", `${label}.handicapByPlayer.${playerId} must be a handicap index between -10 and 54`);
          }
          handicaps[playerId] = hcp;
        }
        out.handicapByPlayer = handicaps;
        break;
      }
      default:
        throw new HttpsError("invalid-argument", `${label}.${key} is not an editable field`);
    }
  }
  return out;
}

/**
 * Update tournament settings, team info, rosters, and handicaps.
 *
 * Data payload:
 * - tournamentId: string
 * - updates: {
 *     name?, year?, active?, openPublicEdits?, test?,
 *     teamA?: { name?, color?, logo?, captainId?, coCaptainId?, rosterByTier?, handicapByPlayer? },
 *     teamB?: { ...same }
 *   }
 *
 * Setting active=true unsets `active` on every other tournament to preserve
 * the single-active-tournament invariant.
 */
export const updateTournament = onCall(async (request) => {
  await requireAdmin(request, "updateTournament", { maxCalls: 30, windowSeconds: 60 });

  const tournamentId = requireString(request.data?.tournamentId, "tournamentId");
  const updates = request.data?.updates;
  if (typeof updates !== "object" || updates === null || Object.keys(updates).length === 0) {
    throw new HttpsError("invalid-argument", "updates object is required");
  }

  const tRef = db().collection("tournaments").doc(tournamentId);
  const tSnap = await tRef.get();
  if (!tSnap.exists) {
    throw new HttpsError("not-found", "Tournament not found");
  }

  const toMerge: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    switch (key) {
      case "name":
      case "series":
        toMerge[key] = requireString(value, `updates.${key}`);
        break;
      case "year":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 2000 || value > 2100) {
          throw new HttpsError("invalid-argument", "updates.year must be a valid year");
        }
        toMerge.year = value;
        break;
      case "active":
      case "openPublicEdits":
      case "test":
        if (typeof value !== "boolean") {
          throw new HttpsError("invalid-argument", `updates.${key} must be a boolean`);
        }
        toMerge[key] = value;
        break;
      case "teamA":
      case "teamB":
        if (typeof value !== "object" || value === null) {
          throw new HttpsError("invalid-argument", `updates.${key} must be an object`);
        }
        toMerge[key] = sanitizeTeamUpdates(value as Record<string, unknown>, `updates.${key}`);
        break;
      default:
        throw new HttpsError("invalid-argument", `updates.${key} is not an editable field`);
    }
  }

  // Preserve single-active invariant: activating this tournament deactivates
  // every other tournament in the same batch.
  const batch = db().batch();
  if (toMerge.active === true) {
    const activeSnap = await db().collection("tournaments").where("active", "==", true).get();
    activeSnap.docs.forEach((d) => {
      if (d.id !== tournamentId) batch.update(d.ref, { active: false });
    });
  }
  batch.set(tRef, { ...toMerge, _adminUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();

  return { success: true, tournamentId, updatedFields: Object.keys(toMerge) };
});

// ============================================================================
// ROUND MANAGEMENT
// ============================================================================

function sanitizeRoundUpdates(updates: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    switch (key) {
      case "format":
        if (value !== null && !ROUND_FORMATS.includes(value as RoundFormat)) {
          throw new HttpsError("invalid-argument", `format must be one of: ${ROUND_FORMATS.join(", ")}`);
        }
        out.format = value;
        break;
      case "courseId":
        out.courseId = value === null ? null : requireString(value, "courseId");
        break;
      case "day":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          throw new HttpsError("invalid-argument", "day must be a non-negative integer");
        }
        out.day = value;
        break;
      case "pointsValue":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
          throw new HttpsError("invalid-argument", "pointsValue must be a non-negative number");
        }
        out.pointsValue = value;
        break;
      case "skinsGrossPot":
      case "skinsNetPot":
      case "skinsHandicapPercent":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
          throw new HttpsError("invalid-argument", `${key} must be a non-negative number`);
        }
        out[key] = value;
        break;
      case "locked":
      case "trackDrives":
        if (typeof value !== "boolean") {
          throw new HttpsError("invalid-argument", `${key} must be a boolean`);
        }
        out[key] = value;
        break;
      default:
        throw new HttpsError("invalid-argument", `${key} is not an editable round field`);
    }
  }
  return out;
}

/**
 * Create a round. seedRoundDefaults fills remaining defaults and
 * linkRoundToTournament adds the round to tournament.roundIds.
 *
 * Data payload:
 * - tournamentId: string
 * - id?: string - optional custom document id
 * - any editable round fields (format, courseId, day, pointsValue, locked,
 *   trackDrives, skinsGrossPot, skinsNetPot, skinsHandicapPercent)
 */
export const createRound = onCall(async (request) => {
  await requireAdmin(request, "createRound", { maxCalls: 30, windowSeconds: 60 });

  const tournamentId = requireString(request.data?.tournamentId, "tournamentId");
  const { id, ...rest } = request.data ?? {};
  delete rest.tournamentId;

  const tSnap = await db().collection("tournaments").doc(tournamentId).get();
  if (!tSnap.exists) {
    throw new HttpsError("not-found", "Tournament not found");
  }

  const fields = sanitizeRoundUpdates(rest);
  const ref = id
    ? db().collection("rounds").doc(requireString(id, "id"))
    : db().collection("rounds").doc();

  if (id) {
    const existing = await ref.get();
    if (existing.exists) {
      throw new HttpsError("already-exists", `Round "${ref.id}" already exists`);
    }
  }

  await ref.set({ tournamentId, ...fields, _adminCreatedAt: FieldValue.serverTimestamp() });
  return { success: true, roundId: ref.id };
});

/**
 * Update editable round fields, including lock/unlock (round.locked is the
 * primary control for score-entry editability in the UI).
 *
 * Data payload:
 * - roundId: string
 * - updates: { format?, courseId?, day?, pointsValue?, locked?, trackDrives?,
 *              skinsGrossPot?, skinsNetPot?, skinsHandicapPercent? }
 */
export const updateRound = onCall(async (request) => {
  await requireAdmin(request, "updateRound", { maxCalls: 30, windowSeconds: 60 });

  const roundId = requireString(request.data?.roundId, "roundId");
  const updates = request.data?.updates;
  if (typeof updates !== "object" || updates === null || Object.keys(updates).length === 0) {
    throw new HttpsError("invalid-argument", "updates object is required");
  }

  const ref = db().collection("rounds").doc(roundId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Round not found");
  }

  const fields = sanitizeRoundUpdates(updates);
  await ref.set({ ...fields, _adminUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { success: true, roundId, updatedFields: Object.keys(fields) };
});

// ============================================================================
// MATCH CONTROLS
// ============================================================================

/**
 * Lock or unlock a single match. Round.locked covers the whole round; this
 * covers one match (e.g. a disputed scorecard while the rest stay editable).
 *
 * Data payload:
 * - matchId: string
 * - locked: boolean
 */
export const setMatchLock = onCall(async (request) => {
  await requireAdmin(request, "setMatchLock", { maxCalls: 30, windowSeconds: 60 });

  const matchId = requireString(request.data?.matchId, "matchId");
  const locked = request.data?.locked;
  if (typeof locked !== "boolean") {
    throw new HttpsError("invalid-argument", "locked must be a boolean");
  }

  const ref = db().collection("matches").doc(matchId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Match not found");
  }

  await ref.set({ locked, _adminUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { success: true, matchId, locked };
});

/**
 * Override the score input for one hole of a match (fix a wrong entry).
 * Writes via the Admin SDK so computeMatchOnWrite recomputes status/result
 * and the stats pipeline updates downstream.
 *
 * Data payload:
 * - matchId: string
 * - hole: number (1-18)
 * - input: format-specific input object (gross values 1-30 or null;
 *          drive values 0, 1, or null)
 */
export const adminOverrideHoleScore = onCall(async (request) => {
  await requireAdmin(request, "adminOverrideHoleScore", { maxCalls: 30, windowSeconds: 60 });

  const matchId = requireString(request.data?.matchId, "matchId");
  const hole = request.data?.hole;
  if (typeof hole !== "number" || !Number.isInteger(hole) || hole < 1 || hole > 18) {
    throw new HttpsError("invalid-argument", "hole must be an integer between 1 and 18");
  }
  const input = request.data?.input;
  if (typeof input !== "object" || input === null) {
    throw new HttpsError("invalid-argument", "input object is required");
  }

  const matchRef = db().collection("matches").doc(matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) {
    throw new HttpsError("not-found", "Match not found");
  }
  const match = matchSnap.data()!;

  // Determine format (cached by computeMatchOnWrite, fall back to round doc)
  let format: RoundFormat | undefined = match._lastComputed?.format;
  if (!format && match.roundId) {
    const rSnap = await db().collection("rounds").doc(match.roundId).get();
    format = rSnap.data()?.format;
  }
  if (!format || !ROUND_FORMATS.includes(format)) {
    throw new HttpsError("failed-precondition", "Could not determine match format");
  }

  const grossOrNull = (v: unknown, field: string): number | null => {
    if (v === null || v === undefined) return null;
    if (!isValidGross(v)) {
      throw new HttpsError("invalid-argument", `${field} must be an integer between 1 and 30, or null`);
    }
    return v;
  };
  const driveOrNull = (v: unknown, field: string): number | null => {
    if (v === null || v === undefined) return null;
    if (v !== 0 && v !== 1) {
      throw new HttpsError("invalid-argument", `${field} must be 0, 1, or null`);
    }
    return v;
  };
  const grossPair = (v: unknown, field: string): (number | null)[] => {
    const arr = Array.isArray(v) ? v : [null, null];
    return [grossOrNull(arr[0], `${field}[0]`), grossOrNull(arr[1], `${field}[1]`)];
  };

  let sanitized: Record<string, unknown>;
  if (format === "singles") {
    sanitized = {
      teamAPlayerGross: grossOrNull(input.teamAPlayerGross, "teamAPlayerGross"),
      teamBPlayerGross: grossOrNull(input.teamBPlayerGross, "teamBPlayerGross"),
    };
  } else if (format === "twoManScramble" || format === "fourManScramble") {
    sanitized = {
      teamAGross: grossOrNull(input.teamAGross, "teamAGross"),
      teamBGross: grossOrNull(input.teamBGross, "teamBGross"),
      teamADrive: driveOrNull(input.teamADrive, "teamADrive"),
      teamBDrive: driveOrNull(input.teamBDrive, "teamBDrive"),
    };
  } else if (format === "twoManShamble") {
    sanitized = {
      teamAPlayersGross: grossPair(input.teamAPlayersGross, "teamAPlayersGross"),
      teamBPlayersGross: grossPair(input.teamBPlayersGross, "teamBPlayersGross"),
      teamADrive: driveOrNull(input.teamADrive, "teamADrive"),
      teamBDrive: driveOrNull(input.teamBDrive, "teamBDrive"),
    };
  } else {
    // twoManBestBall
    sanitized = {
      teamAPlayersGross: grossPair(input.teamAPlayersGross, "teamAPlayersGross"),
      teamBPlayersGross: grossPair(input.teamBPlayersGross, "teamBPlayersGross"),
    };
  }

  await matchRef.update({ [`holes.${hole}.input`]: sanitized });
  return { success: true, matchId, hole, input: sanitized };
});

/**
 * Delete a match. The existing triggers handle the fallout: updateMatchFacts
 * deletes the match's playerMatchFacts (which cascades into stats rebuilds via
 * aggregatePlayerStats), and computeRoundSkins recomputes the round's skins.
 *
 * Data payload:
 * - matchId: string
 */
export const deleteMatch = onCall(async (request) => {
  await requireAdmin(request, "deleteMatch", { maxCalls: 10, windowSeconds: 60 });

  const matchId = requireString(request.data?.matchId, "matchId");
  const matchRef = db().collection("matches").doc(matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) {
    throw new HttpsError("not-found", "Match not found");
  }
  const roundId = matchSnap.data()?.roundId;

  await matchRef.delete();

  // Remove the match from its round's matchIds list
  if (roundId) {
    const roundRef = db().collection("rounds").doc(roundId);
    await db().runTransaction(async (tx) => {
      const s = await tx.get(roundRef);
      if (!s.exists) return;
      const list: string[] = Array.isArray(s.data()?.matchIds) ? s.data()!.matchIds : [];
      if (list.includes(matchId)) {
        tx.update(roundRef, { matchIds: list.filter((id) => id !== matchId) });
      }
    });
  }

  return { success: true, matchId };
});

// ============================================================================
// PLAYER MANAGEMENT
// ============================================================================

/**
 * Create a player document.
 *
 * Data payload:
 * - id: string - player document id (convention: "pFirstLast")
 * - displayName: string
 */
export const createPlayer = onCall(async (request) => {
  await requireAdmin(request, "createPlayer", { maxCalls: 30, windowSeconds: 60 });

  const id = requireString(request.data?.id, "id");
  const displayName = requireString(request.data?.displayName, "displayName");

  const ref = db().collection("players").doc(id);
  const existing = await ref.get();
  if (existing.exists) {
    throw new HttpsError("already-exists", `Player "${id}" already exists`);
  }

  await ref.set({ displayName, _adminCreatedAt: FieldValue.serverTimestamp() });
  return { success: true, playerId: id };
});

/**
 * Update a player's display name.
 *
 * Data payload:
 * - playerId: string
 * - displayName: string
 */
export const updatePlayerInfo = onCall(async (request) => {
  await requireAdmin(request, "updatePlayerInfo", { maxCalls: 30, windowSeconds: 60 });

  const playerId = requireString(request.data?.playerId, "playerId");
  const displayName = requireString(request.data?.displayName, "displayName");

  const ref = db().collection("players").doc(playerId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Player not found");
  }

  await ref.set({ displayName, _adminUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { success: true, playerId };
});

/**
 * Link a Firebase Auth account to a player document by email (replaces the
 * link-auth-to-player.ts script). The person must have signed in at least
 * once so the Auth user exists.
 *
 * Note: matches store authorizedUids computed at creation time, so linking
 * after matches were seeded does not retroactively authorize the player for
 * existing matches — recreate or edit those matches if needed.
 *
 * Data payload:
 * - playerId: string
 * - email: string
 */
export const linkAuthToPlayer = onCall(async (request) => {
  await requireAdmin(request, "linkAuthToPlayer", { maxCalls: 30, windowSeconds: 60 });

  const playerId = requireString(request.data?.playerId, "playerId");
  const email = requireString(request.data?.email, "email").toLowerCase();

  const ref = db().collection("players").doc(playerId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Player not found");
  }

  let authUser;
  try {
    authUser = await getAuth().getUserByEmail(email);
  } catch {
    throw new HttpsError(
      "not-found",
      `No Firebase Auth user found for ${email}. The player must sign in once before linking.`
    );
  }

  // Don't silently steal a uid already linked to a different player
  const conflict = await db().collection("players").where("authUid", "==", authUser.uid).get();
  if (!conflict.empty && conflict.docs[0].id !== playerId) {
    throw new HttpsError(
      "already-exists",
      `That account is already linked to player "${conflict.docs[0].id}"`
    );
  }

  await ref.set({ authUid: authUser.uid, email, _adminUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { success: true, playerId, authUid: authUser.uid };
});
