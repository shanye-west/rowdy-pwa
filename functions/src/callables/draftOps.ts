/**
 * Callables for the live pairings snake-draft (`pairingDrafts/{roundId}`).
 *
 * Setup/reset/finalize are admin-only; picks and undos are driven by the
 * acting team's captain/co-captain (or an admin) and enforced server-side.
 * All turn/validation logic lives in helpers/pairingDraft.ts (pure, tested);
 * these callables only read/write Firestore and map errors.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "../helpers/adminAuth.js";
import { requireCaptainOrAdmin } from "../helpers/captainAuth.js";
import { buildSeededMatchDoc } from "./matchOps.js";
import {
  DraftError,
  draftPlayersPerSide,
  buildInitialMatches,
  initialTurn,
  applyPick,
  applyUndo,
  lastPlacement,
  isPairableRemainder,
  type DraftState,
  type DraftTeam,
} from "../helpers/pairingDraft.js";
import type { RoundFormat } from "../types.js";

function db() {
  return getFirestore();
}

const TIERS = ["A", "B", "C", "D"] as const;

/** Flatten a team's rosterByTier into playerId → tier and add to `out`. */
function addTiers(roster: Record<string, string[]> | undefined, out: Record<string, string>): void {
  if (!roster) return;
  for (const tier of TIERS) {
    for (const pid of roster[tier] ?? []) out[pid] = tier;
  }
}

/** All player ids on a team (any tier). */
function rosterIds(roster: Record<string, string[]> | undefined): Set<string> {
  const ids = new Set<string>();
  if (roster) for (const tier of TIERS) for (const pid of roster[tier] ?? []) ids.add(pid);
  return ids;
}

function isTeam(v: unknown): v is DraftTeam {
  return v === "teamA" || v === "teamB";
}

/** Map a thrown DraftError to a user-facing HttpsError; pass others through. */
function toHttpsError(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e;
  if (e instanceof DraftError) return new HttpsError("failed-precondition", e.message, { code: e.code });
  return new HttpsError("internal", "Draft update failed");
}

/**
 * Admin: create (or reset) the draft for a round. Reads the round's format and
 * course, validates the available rosters, computes the tier lookup and the
 * read-gating authorizedUids (captains + co-captains + admins), and writes the
 * draft in `drafting` phase with the snake turn initialized.
 */
export const createPairingDraft = onCall(async (request) => {
  const { playerId } = await requireAdmin(request, "createPairingDraft", { maxCalls: 20, windowSeconds: 60 });

  const { roundId, availableTeamA, availableTeamB, firstPickTeam, reset } = request.data || {};
  if (!roundId || typeof roundId !== "string") {
    throw new HttpsError("invalid-argument", "Missing roundId");
  }
  if (!Array.isArray(availableTeamA) || !Array.isArray(availableTeamB)) {
    throw new HttpsError("invalid-argument", "availableTeamA and availableTeamB must be arrays");
  }
  if (!isTeam(firstPickTeam)) {
    throw new HttpsError("invalid-argument", "firstPickTeam must be 'teamA' or 'teamB'");
  }

  const roundSnap = await db().collection("rounds").doc(roundId).get();
  if (!roundSnap.exists) throw new HttpsError("not-found", "Round not found");
  const round = roundSnap.data()!;
  const format = round.format as RoundFormat | null | undefined;
  const tournamentId = round.tournamentId as string | undefined;
  if (!format) throw new HttpsError("failed-precondition", "Round has no format set");
  if (!tournamentId) throw new HttpsError("failed-precondition", "Round is missing tournamentId");
  if (!round.courseId) throw new HttpsError("failed-precondition", "Round has no course set");

  const playersPerSide = draftPlayersPerSide(format);
  const teamAIds = [...new Set(availableTeamA.map(String))];
  const teamBIds = [...new Set(availableTeamB.map(String))];
  if (teamAIds.length === 0 || teamBIds.length === 0) {
    throw new HttpsError("invalid-argument", "Select available players for both teams");
  }
  if (teamAIds.length !== teamBIds.length) {
    throw new HttpsError("invalid-argument", "Both teams must have the same number of available players");
  }
  if (teamAIds.length % playersPerSide !== 0) {
    throw new HttpsError("invalid-argument", `Available player count must be divisible by ${playersPerSide}`);
  }

  const tSnap = await db().collection("tournaments").doc(tournamentId).get();
  if (!tSnap.exists) throw new HttpsError("not-found", "Tournament not found");
  const t = tSnap.data()!;

  const teamARoster = rosterIds(t.teamA?.rosterByTier);
  const teamBRoster = rosterIds(t.teamB?.rosterByTier);
  for (const id of teamAIds) {
    if (!teamARoster.has(id)) throw new HttpsError("invalid-argument", `Player ${id} is not on team A's roster`);
  }
  for (const id of teamBIds) {
    if (!teamBRoster.has(id)) throw new HttpsError("invalid-argument", `Player ${id} is not on team B's roster`);
  }

  const tierByPlayer: Record<string, string> = {};
  addTiers(t.teamA?.rosterByTier, tierByPlayer);
  addTiers(t.teamB?.rosterByTier, tierByPlayer);

  // Reject rosters that can't be paired legally before the draft even starts —
  // a team can hold at most one A-tier and one D-tier per match, so more than
  // `totalMatches` of either tier is impossible. Fails here, not mid-draft.
  if (playersPerSide === 2) {
    const matchesPerTeam = teamAIds.length / playersPerSide;
    for (const [ids, name] of [
      [teamAIds, (t.teamA?.name as string) || "Team A"] as const,
      [teamBIds, (t.teamB?.name as string) || "Team B"] as const,
    ]) {
      if (!isPairableRemainder(ids, matchesPerTeam, tierByPlayer)) {
        const a = ids.filter((id) => tierByPlayer[id] === "A").length;
        const d = ids.filter((id) => tierByPlayer[id] === "D").length;
        throw new HttpsError(
          "failed-precondition",
          `${name} can't be paired legally — ${a} A-tier and ${d} D-tier across ${matchesPerTeam} matches (at most ${matchesPerTeam} of each). Bench or rebalance before drafting.`
        );
      }
    }
  }

  const draftRef = db().collection("pairingDrafts").doc(roundId);
  const existing = await draftRef.get();
  if (existing.exists && !reset) {
    throw new HttpsError("already-exists", "A draft already exists for this round. Reset it to start over.");
  }

  // Read-gating: only captains/co-captains and admins may load the draft doc.
  const captainIds = [t.teamA?.captainId, t.teamA?.coCaptainId, t.teamB?.captainId, t.teamB?.coCaptainId].filter(
    Boolean
  ) as string[];
  const authorizedUids = new Set<string>();
  await Promise.all(
    captainIds.map(async (pid) => {
      const pSnap = await db().collection("players").doc(pid).get();
      const authUid = pSnap.data()?.authUid;
      if (authUid) authorizedUids.add(authUid);
    })
  );
  const adminSnap = await db().collection("players").where("isAdmin", "==", true).get();
  adminSnap.docs.forEach((d) => {
    const authUid = d.data()?.authUid;
    if (authUid) authorizedUids.add(authUid);
  });

  const totalMatches = teamAIds.length / playersPerSide;
  const doc = {
    roundId,
    tournamentId,
    format,
    playersPerSide,
    totalMatches,
    available: { teamA: teamAIds, teamB: teamBIds },
    firstPickTeam,
    phase: "drafting" as const,
    matches: buildInitialMatches(totalMatches, firstPickTeam),
    turn: initialTurn(firstPickTeam),
    tierByPlayer,
    authorizedUids: [...authorizedUids],
    createdBy: playerId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await draftRef.set(doc);
  return { success: true, roundId, totalMatches };
});

/**
 * Captain/admin: place a nomination or response for the acting team. Validated
 * and applied atomically in a transaction.
 */
export const submitDraftPick = onCall(async (request) => {
  const { roundId, team, playerIds } = request.data || {};
  if (!roundId || typeof roundId !== "string") throw new HttpsError("invalid-argument", "Missing roundId");
  if (!isTeam(team)) throw new HttpsError("invalid-argument", "team must be 'teamA' or 'teamB'");
  if (!Array.isArray(playerIds)) throw new HttpsError("invalid-argument", "playerIds must be an array");

  const draftRef = db().collection("pairingDrafts").doc(roundId);
  const snap = await draftRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Draft not found");
  const tournamentId = snap.data()!.tournamentId as string;

  await requireCaptainOrAdmin(request, "submitDraftPick", { maxCalls: 60, windowSeconds: 60 }, tournamentId, team);

  const ids = playerIds.map(String);
  try {
    await db().runTransaction(async (tx) => {
      const fresh = await tx.get(draftRef);
      if (!fresh.exists) throw new DraftError("not-found", "Draft not found");
      const state = fresh.data() as unknown as DraftState;
      const next = applyPick(state, team, ids);
      tx.update(draftRef, {
        matches: next.matches,
        turn: next.turn,
        phase: next.phase,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    throw toHttpsError(e);
  }

  return { success: true };
});

/**
 * Captain/admin: undo the most recent placement. A captain may only undo their
 * own team's last pick; an admin may undo any.
 */
export const undoDraftPick = onCall(async (request) => {
  const { roundId, team } = request.data || {};
  if (!roundId || typeof roundId !== "string") throw new HttpsError("invalid-argument", "Missing roundId");
  if (!isTeam(team)) throw new HttpsError("invalid-argument", "team must be 'teamA' or 'teamB'");

  const draftRef = db().collection("pairingDrafts").doc(roundId);
  const snap = await draftRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Draft not found");
  const tournamentId = snap.data()!.tournamentId as string;

  const { isAdmin } = await requireCaptainOrAdmin(
    request,
    "undoDraftPick",
    { maxCalls: 60, windowSeconds: 60 },
    tournamentId,
    team
  );

  try {
    await db().runTransaction(async (tx) => {
      const fresh = await tx.get(draftRef);
      if (!fresh.exists) throw new DraftError("not-found", "Draft not found");
      const state = fresh.data() as unknown as DraftState;
      if (state.phase === "finalized") throw new DraftError("finalized", "This draft is already finalized");

      const last = lastPlacement(state);
      if (!last) throw new DraftError("nothing-to-undo", "There is no pick to undo");
      if (!isAdmin && team !== last.team) {
        throw new DraftError("not-your-pick", "You can only undo your own team's last pick");
      }

      const next = applyUndo(state);
      tx.update(draftRef, {
        matches: next.matches,
        turn: next.turn,
        phase: next.phase,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    throw toHttpsError(e);
  }

  return { success: true };
});

/** Admin: delete the draft for a round so it can be set up fresh. */
export const resetPairingDraft = onCall(async (request) => {
  await requireAdmin(request, "resetPairingDraft", { maxCalls: 20, windowSeconds: 60 });
  const { roundId } = request.data || {};
  if (!roundId || typeof roundId !== "string") throw new HttpsError("invalid-argument", "Missing roundId");
  await db().collection("pairingDrafts").doc(roundId).delete();
  return { success: true };
});

/**
 * Admin: turn a completed (review) draft into real matches via the shared
 * seedMatch builder, then mark the draft finalized. Refuses if the round
 * already has matches unless `force` is set.
 */
export const finalizePairingDraft = onCall(async (request) => {
  await requireAdmin(request, "finalizePairingDraft", { maxCalls: 10, windowSeconds: 60 });
  const { roundId, force } = request.data || {};
  if (!roundId || typeof roundId !== "string") throw new HttpsError("invalid-argument", "Missing roundId");

  const draftRef = db().collection("pairingDrafts").doc(roundId);
  const snap = await draftRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Draft not found");
  const draft = snap.data()!;
  if (draft.phase !== "review") {
    throw new HttpsError("failed-precondition", "Draft must be complete (in review) before finalizing");
  }

  const tournamentId = draft.tournamentId as string;
  const matches = (draft.matches || []) as {
    matchNumber: number;
    teamAPlayers: string[] | null;
    teamBPlayers: string[] | null;
  }[];

  const existingMatches = await db().collection("matches").where("roundId", "==", roundId).get();
  if (!existingMatches.empty && !force) {
    throw new HttpsError("failed-precondition", "This round already has matches. Pass force to add anyway.");
  }

  const built: Record<string, unknown>[] = [];
  for (const m of matches) {
    if (!m.teamAPlayers || !m.teamBPlayers) {
      throw new HttpsError("failed-precondition", "Draft is incomplete — every match needs both sides");
    }
    const id = `${roundId}-m${String(m.matchNumber).padStart(2, "0")}`;
    const matchDoc = await buildSeededMatchDoc({
      id,
      tournamentId,
      roundId,
      teamAPlayers: m.teamAPlayers.map((pid) => ({ playerId: pid })),
      teamBPlayers: m.teamBPlayers.map((pid) => ({ playerId: pid })),
      matchNumber: m.matchNumber,
    });
    built.push(matchDoc);
  }

  const batch = db().batch();
  const matchIds: string[] = [];
  for (const matchDoc of built) {
    const id = matchDoc.id as string;
    batch.set(db().collection("matches").doc(id), matchDoc);
    matchIds.push(id);
  }
  batch.update(draftRef, {
    phase: "finalized",
    finalizedMatchIds: matchIds,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { success: true, roundId, matchIds };
});
