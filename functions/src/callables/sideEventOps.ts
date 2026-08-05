/**
 * Admin-only callables for SIDE EVENTS — the optional, for-fun 9-hole games
 * (currently the 3-man scramble) that run alongside the Cup.
 *
 * A side event deliberately does NOT use `rounds` / `matches`:
 *  - every scoring, stats, skins, betting and notification trigger fires on
 *    `matches/{matchId}` or `playerMatchFacts/{factId}`, so staying out of those
 *    collections is what guarantees "no points, no stats" — no flags needed;
 *  - its teams are free-form (any mix of the two rosters), which the
 *    teamA-vs-teamB match document cannot express.
 *
 * Score entry is a direct client write to `sideEventTeams/{teamId}.holes`
 * (see firestore.rules), so the offline write queue behaves exactly as it does
 * on the match scorecard. Everything else is written here via the Admin SDK,
 * which bypasses rules — so every callable must start with requireAdmin().
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "../helpers/adminAuth.js";
import { isValidGross } from "../scoring/matchScoring.js";
import type { SideEventNine, SideEventPayout } from "../types.js";

const NINES: SideEventNine[] = ["front", "back"];

/** Guard rails on team size: normally 3, but an odd headcount happens. */
const MIN_TEAM_PLAYERS = 2;
const MAX_TEAM_PLAYERS = 4;

function db() {
  return getFirestore();
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError("invalid-argument", `${field} is required`);
  }
  return value.trim();
}

/** Hole numbers a nine covers, as strings (they key the `holes` map). */
export function holeNumbersForNine(nine: SideEventNine): number[] {
  const start = nine === "back" ? 10 : 1;
  return Array.from({ length: 9 }, (_, i) => start + i);
}

/**
 * Validates the payouts array. Places must be positive integers and unique;
 * the result is sorted by place so the UI never has to. An empty array is
 * legal — it just means nobody gets paid this year.
 */
function sanitizePayouts(value: unknown): SideEventPayout[] {
  if (!Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "payouts must be an array");
  }
  if (value.length > 10) {
    throw new HttpsError("invalid-argument", "payouts supports at most 10 paid places");
  }
  const seen = new Set<number>();
  const out: SideEventPayout[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      throw new HttpsError("invalid-argument", "each payout must be an object");
    }
    const { place, amount } = entry as Record<string, unknown>;
    if (typeof place !== "number" || !Number.isInteger(place) || place < 1) {
      throw new HttpsError("invalid-argument", "payout.place must be a positive integer");
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      throw new HttpsError("invalid-argument", "payout.amount must be a non-negative number");
    }
    if (seen.has(place)) {
      throw new HttpsError("invalid-argument", `payouts has a duplicate place (${place})`);
    }
    seen.add(place);
    out.push({ place, amount });
  }
  out.sort((a, b) => a.place - b.place);
  return out;
}

/**
 * Strict per-key whitelist, mirroring sanitizeRoundUpdates in adminOps: an
 * unknown key throws rather than silently writing garbage into the doc.
 */
function sanitizeSideEventUpdates(updates: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    switch (key) {
      case "name": {
        const name = requireString(value, "name");
        if (name.length > 60) {
          throw new HttpsError("invalid-argument", "name must be 60 characters or fewer");
        }
        out.name = name;
        break;
      }
      case "courseId":
        out.courseId = value === null ? null : requireString(value, "courseId");
        break;
      case "nine":
        if (!NINES.includes(value as SideEventNine)) {
          throw new HttpsError("invalid-argument", `nine must be one of: ${NINES.join(", ")}`);
        }
        out.nine = value;
        break;
      case "payouts":
        out.payouts = sanitizePayouts(value);
        break;
      case "locked":
      case "hidden":
        if (typeof value !== "boolean") {
          throw new HttpsError("invalid-argument", `${key} must be a boolean`);
        }
        out[key] = value;
        break;
      default:
        throw new HttpsError("invalid-argument", `${key} is not an editable side event field`);
    }
  }
  return out;
}

/**
 * Rewrites `tournament.sideEvents` — the denormalized `{ id, name, hidden }`
 * list the hamburger menu reads. Keeping it on the tournament doc (which every
 * page already has in context) means the menu link costs zero extra reads.
 *
 * Pass `entry: null` to remove the event. Runs in a transaction because two
 * admins editing different side events would otherwise clobber each other's
 * entry — arrayUnion/arrayRemove can't be used since the objects mutate.
 */
async function syncTournamentSideEvents(
  tournamentId: string,
  eventId: string,
  entry: { id: string; name: string; hidden?: boolean } | null
): Promise<void> {
  const ref = db().collection("tournaments").doc(tournamentId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = Array.isArray(snap.data()?.sideEvents)
      ? (snap.data()!.sideEvents as { id: string }[])
      : [];
    const next = current.filter((e) => e && e.id !== eventId);
    if (entry) next.push(entry);
    tx.set(ref, { sideEvents: next }, { merge: true });
  });
}

/** The menu entry shape derived from an event doc's current fields. */
function menuEntry(eventId: string, data: Record<string, unknown>) {
  return {
    id: eventId,
    name: typeof data.name === "string" ? data.name : "Side Event",
    hidden: data.hidden === true,
  };
}

// ============================================================================
// SIDE EVENT CRUD
// ============================================================================

/**
 * Create a side event.
 *
 * Data payload:
 * - tournamentId: string
 * - name?, courseId?, nine?, payouts?, hidden?
 */
export const createSideEvent = onCall(async (request) => {
  await requireAdmin(request, "createSideEvent", { maxCalls: 20, windowSeconds: 60 });

  const tournamentId = requireString(request.data?.tournamentId, "tournamentId");
  const { tournamentId: _ignored, ...rest } = request.data ?? {};
  void _ignored;

  const tSnap = await db().collection("tournaments").doc(tournamentId).get();
  if (!tSnap.exists) {
    throw new HttpsError("not-found", "Tournament not found");
  }

  const fields = sanitizeSideEventUpdates(rest);
  const doc = {
    tournamentId,
    name: "3-Man Scramble",
    courseId: null,
    nine: "front" as SideEventNine,
    payouts: [] as SideEventPayout[],
    locked: false,
    hidden: false,
    ...fields,
    _adminCreatedAt: FieldValue.serverTimestamp(),
  };

  const ref = db().collection("sideEvents").doc();
  await ref.set(doc);
  await syncTournamentSideEvents(tournamentId, ref.id, menuEntry(ref.id, doc));

  return { success: true, sideEventId: ref.id };
});

/**
 * Update editable side event fields.
 *
 * `locked` is fanned out to every team doc because the security rule checks the
 * team's own `locked` field (a cross-document get() in rules would cost a read
 * on every score save).
 *
 * Data payload:
 * - sideEventId: string
 * - updates: { name?, courseId?, nine?, payouts?, locked?, hidden? }
 */
export const updateSideEvent = onCall(async (request) => {
  await requireAdmin(request, "updateSideEvent", { maxCalls: 30, windowSeconds: 60 });

  const sideEventId = requireString(request.data?.sideEventId, "sideEventId");
  const updates = request.data?.updates;
  if (typeof updates !== "object" || updates === null || Object.keys(updates).length === 0) {
    throw new HttpsError("invalid-argument", "updates object is required");
  }

  const ref = db().collection("sideEvents").doc(sideEventId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Side event not found");
  }
  const before = snap.data() ?? {};

  const fields = sanitizeSideEventUpdates(updates);
  await ref.set({ ...fields, _adminUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });

  // Fan the lock out to the team docs the security rule actually reads.
  if ("locked" in fields && fields.locked !== before.locked) {
    const teams = await db().collection("sideEventTeams").where("sideEventId", "==", sideEventId).get();
    if (!teams.empty) {
      const batch = db().batch();
      teams.docs.forEach((d) => batch.set(d.ref, { locked: fields.locked }, { merge: true }));
      await batch.commit();
    }
  }

  // Keep the menu's denormalized copy honest.
  if ("name" in fields || "hidden" in fields) {
    const after = { ...before, ...fields };
    await syncTournamentSideEvents(
      requireString(before.tournamentId, "tournamentId"),
      sideEventId,
      menuEntry(sideEventId, after)
    );
  }

  return { success: true };
});

/** Delete a side event and all of its teams, then unlink it from the tournament. */
export const deleteSideEvent = onCall(async (request) => {
  await requireAdmin(request, "deleteSideEvent", { maxCalls: 10, windowSeconds: 60 });

  const sideEventId = requireString(request.data?.sideEventId, "sideEventId");
  const ref = db().collection("sideEvents").doc(sideEventId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Side event not found");
  }
  const tournamentId = snap.data()?.tournamentId;

  const teams = await db().collection("sideEventTeams").where("sideEventId", "==", sideEventId).get();
  const batch = db().batch();
  teams.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(ref);
  await batch.commit();

  if (typeof tournamentId === "string" && tournamentId) {
    await syncTournamentSideEvents(tournamentId, sideEventId, null);
  }

  return { success: true, teamsDeleted: teams.size };
});

// ============================================================================
// TEAMS
// ============================================================================

/**
 * Resolve the auth uids allowed to enter this team's scores. Batched getAll —
 * one round-trip regardless of team size, matching buildSeededMatchDoc.
 */
async function resolveAuthorizedUids(playerIds: string[]): Promise<string[]> {
  if (playerIds.length === 0) return [];
  const refs = playerIds.map((pid) => db().collection("players").doc(pid));
  const snaps = await db().getAll(...refs);
  const uids: string[] = [];
  for (const snap of snaps) {
    const authUid = snap.data()?.authUid;
    if (typeof authUid === "string" && authUid) uids.push(authUid);
  }
  return uids;
}

/**
 * Validates a `holes` map supplied by an admin score fix.
 *
 * A cleared hole is `{ gross: null }`, not a missing key — clients clear the
 * same way because the security rule forbids dropping hole keys.
 */
function sanitizeHoles(value: unknown, nine: SideEventNine): Record<string, { gross: number | null }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "holes must be a map");
  }
  const allowed = new Set(holeNumbersForNine(nine).map(String));
  const out: Record<string, { gross: number | null }> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      throw new HttpsError("invalid-argument", `hole ${key} is not part of this side event's nine`);
    }
    if (raw === null || raw === undefined) continue;
    const gross = (raw as Record<string, unknown>)?.gross;
    if (gross === null) {
      out[key] = { gross: null };
      continue;
    }
    if (!isValidGross(gross)) {
      throw new HttpsError("invalid-argument", `hole ${key} has an invalid gross score`);
    }
    out[key] = { gross };
  }
  return out;
}

/**
 * Create or update one side event team. Handles the roster-free pairing that is
 * the whole point of this feature: playerIds may mix both Cup rosters freely.
 *
 * Data payload:
 * - sideEventId: string
 * - teamId?: string          (omit to create)
 * - playerIds: string[]      (2-4)
 * - holes?: Record<string, { gross: number }>   (admin score fix)
 */
export const saveSideEventTeam = onCall(async (request) => {
  await requireAdmin(request, "saveSideEventTeam", { maxCalls: 60, windowSeconds: 60 });

  const sideEventId = requireString(request.data?.sideEventId, "sideEventId");
  const teamId = request.data?.teamId ? requireString(request.data.teamId, "teamId") : null;
  const playerIds = request.data?.playerIds;

  if (!Array.isArray(playerIds)) {
    throw new HttpsError("invalid-argument", "playerIds must be an array");
  }
  if (playerIds.length < MIN_TEAM_PLAYERS || playerIds.length > MAX_TEAM_PLAYERS) {
    throw new HttpsError(
      "invalid-argument",
      `a team needs between ${MIN_TEAM_PLAYERS} and ${MAX_TEAM_PLAYERS} players`
    );
  }
  const cleanIds = playerIds.map((p: unknown, i: number) => requireString(p, `playerIds[${i}]`));
  if (new Set(cleanIds).size !== cleanIds.length) {
    throw new HttpsError("invalid-argument", "a player can only appear once on a team");
  }

  const eventSnap = await db().collection("sideEvents").doc(sideEventId).get();
  if (!eventSnap.exists) {
    throw new HttpsError("not-found", "Side event not found");
  }
  const event = eventSnap.data() ?? {};
  const nine: SideEventNine = event.nine === "back" ? "back" : "front";

  // Every team in the event, used both to reject cross-team duplicates and to
  // pick the next free team number.
  const siblings = await db().collection("sideEventTeams").where("sideEventId", "==", sideEventId).get();
  const takenNumbers = new Set<number>();
  for (const d of siblings.docs) {
    const data = d.data();
    if (typeof data.teamNumber === "number") takenNumbers.add(data.teamNumber);
    if (d.id === teamId) continue;
    const others: string[] = Array.isArray(data.playerIds) ? data.playerIds : [];
    const clash = cleanIds.find((pid) => others.includes(pid));
    if (clash) {
      throw new HttpsError("already-exists", `${clash} is already on another team in this side event`);
    }
  }

  const authorizedUids = await resolveAuthorizedUids(cleanIds);
  const ref = teamId
    ? db().collection("sideEventTeams").doc(teamId)
    : db().collection("sideEventTeams").doc();

  if (teamId) {
    const existing = await ref.get();
    if (!existing.exists) {
      throw new HttpsError("not-found", "Side event team not found");
    }
    const updates: Record<string, unknown> = {
      playerIds: cleanIds,
      authorizedUids,
      locked: event.locked === true,
      _adminUpdatedAt: FieldValue.serverTimestamp(),
    };
    if (request.data?.holes !== undefined) {
      updates.holes = sanitizeHoles(request.data.holes, nine);
    }
    await ref.set(updates, { merge: true });
  } else {
    let teamNumber = 1;
    while (takenNumbers.has(teamNumber)) teamNumber++;
    await ref.set({
      sideEventId,
      tournamentId: event.tournamentId,
      teamNumber,
      playerIds: cleanIds,
      authorizedUids,
      locked: event.locked === true,
      holes: request.data?.holes !== undefined ? sanitizeHoles(request.data.holes, nine) : {},
      _adminCreatedAt: FieldValue.serverTimestamp(),
    });
  }

  return { success: true, teamId: ref.id };
});

/** Remove one team from a side event. */
export const deleteSideEventTeam = onCall(async (request) => {
  await requireAdmin(request, "deleteSideEventTeam", { maxCalls: 30, windowSeconds: 60 });

  const sideEventId = requireString(request.data?.sideEventId, "sideEventId");
  const teamId = requireString(request.data?.teamId, "teamId");

  const ref = db().collection("sideEventTeams").doc(teamId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Side event team not found");
  }
  if (snap.data()?.sideEventId !== sideEventId) {
    throw new HttpsError("invalid-argument", "Team does not belong to that side event");
  }

  await ref.delete();
  return { success: true };
});
