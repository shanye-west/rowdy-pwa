/**
 * Callables for the captains' team draft (`teamDrafts/{tournamentId}`): the two
 * captains snake-draft the tournament's `draftPool` onto their teams.
 *
 * Start/undo/reset/finalize are admin-only; picks come from the acting team's
 * captain/co-captain (or an admin) and are enforced server-side. All turn and
 * tier-lock logic lives in helpers/teamDraft.ts (pure, tested); these callables
 * only read/write Firestore and map errors.
 *
 * The board is private: only captains/co-captains and admins (stamped into
 * `authorizedUids`) can read it — see firestore.rules. Finalizing writes the
 * public rosters, which is the reveal.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "../helpers/adminAuth.js";
import { requireCaptainOrAdmin } from "../helpers/captainAuth.js";
import {
  TeamDraftError,
  initTeamDraft,
  applyTeamPick,
  applyTeamUndo,
  rosterByTierFromDraft,
  teamPlayerIds,
  type TeamDraftState,
  type TeamKey,
} from "../helpers/teamDraft.js";

function db() {
  return getFirestore();
}

function isTeam(v: unknown): v is TeamKey {
  return v === "teamA" || v === "teamB";
}

function toHttpsError(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e;
  if (e instanceof TeamDraftError) return new HttpsError("failed-precondition", e.message, { code: e.code });
  console.error("teamDraft failure", e);
  return new HttpsError("internal", "Draft update failed");
}

function requireTournamentId(data: unknown): string {
  const tournamentId = (data as { tournamentId?: unknown } | undefined)?.tournamentId;
  if (!tournamentId || typeof tournamentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing tournamentId");
  }
  return tournamentId;
}

/** Auth uids of both teams' captains/co-captains plus every admin. */
async function captainAndAdminUids(t: FirebaseFirestore.DocumentData): Promise<string[]> {
  const uids = new Set<string>();
  const captainIds = [t.teamA?.captainId, t.teamA?.coCaptainId, t.teamB?.captainId, t.teamB?.coCaptainId].filter(
    Boolean
  ) as string[];
  if (captainIds.length > 0) {
    const snaps = await db().getAll(...captainIds.map((pid) => db().collection("players").doc(pid)));
    for (const s of snaps) {
      const uid = s.data()?.authUid;
      if (uid) uids.add(uid);
    }
  }
  const admins = await db().collection("players").where("isAdmin", "==", true).get();
  for (const d of admins.docs) {
    const uid = d.data()?.authUid;
    if (uid) uids.add(uid);
  }
  return [...uids];
}

/**
 * Admin: open the draft. Freezes the pool's handicaps and tiers, pre-places
 * each team's captain, and records which team picks first (the admin's call).
 */
export const startTeamDraft = onCall(async (request) => {
  const { playerId } = await requireAdmin(request, "startTeamDraft", { maxCalls: 20, windowSeconds: 60 });
  const tournamentId = requireTournamentId(request.data);
  const { firstPickTeam } = request.data || {};
  if (!isTeam(firstPickTeam)) throw new HttpsError("invalid-argument", "firstPickTeam must be 'teamA' or 'teamB'");

  const tSnap = await db().collection("tournaments").doc(tournamentId).get();
  if (!tSnap.exists) throw new HttpsError("not-found", "Tournament not found");
  const t = tSnap.data()!;

  const pool = (t.draftPool ?? {}) as Record<string, number | null>;
  const captainA = t.teamA?.captainId as string | undefined;
  const captainB = t.teamB?.captainId as string | undefined;
  if (!captainA || !captainB) {
    throw new HttpsError("failed-precondition", "Set both team captains before starting the draft.");
  }

  const draftRef = db().collection("teamDrafts").doc(tournamentId);
  try {
    const state = initTeamDraft({
      handicapByPlayer: pool,
      keepers: { teamA: [captainA], teamB: [captainB] },
      firstPickTeam,
    });
    const authorizedUids = await captainAndAdminUids(t);
    await db().runTransaction(async (tx) => {
      const existing = await tx.get(draftRef);
      if (existing.exists) {
        throw new TeamDraftError("exists", "A draft already exists for this tournament. Reset it to start over.");
      }
      tx.set(draftRef, {
        tournamentId,
        firstPickTeam: state.firstPickTeam,
        poolIds: state.poolIds,
        tierByPlayer: state.tierByPlayer,
        handicapByPlayer: Object.fromEntries(state.poolIds.map((id) => [id, pool[id] ?? null])),
        perTeamPerTier: state.perTeamPerTier,
        keepers: state.keepers,
        picks: [],
        totalPicks: state.totalPicks,
        turn: state.turn,
        phase: state.phase,
        authorizedUids,
        createdBy: playerId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    throw toHttpsError(e);
  }
  return { success: true };
});

/** Captain (of the acting team) or admin: draft one player. */
export const submitTeamDraftPick = onCall(async (request) => {
  const tournamentId = requireTournamentId(request.data);
  const { team, playerId: pickId } = request.data || {};
  if (!isTeam(team)) throw new HttpsError("invalid-argument", "team must be 'teamA' or 'teamB'");
  if (!pickId || typeof pickId !== "string") throw new HttpsError("invalid-argument", "Missing playerId");

  await requireCaptainOrAdmin(request, "submitTeamDraftPick", { maxCalls: 60, windowSeconds: 60 }, tournamentId, team);

  const draftRef = db().collection("teamDrafts").doc(tournamentId);
  try {
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(draftRef);
      if (!snap.exists) throw new TeamDraftError("not-found", "The draft hasn't started.");
      const next = applyTeamPick(snap.data() as TeamDraftState, team, pickId);
      tx.update(draftRef, {
        picks: next.picks,
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

/** Admin-only: take back the most recent pick (captains draft forward only). */
export const undoTeamDraftPick = onCall(async (request) => {
  await requireAdmin(request, "undoTeamDraftPick", { maxCalls: 60, windowSeconds: 60 });
  const tournamentId = requireTournamentId(request.data);
  const draftRef = db().collection("teamDrafts").doc(tournamentId);
  try {
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(draftRef);
      if (!snap.exists) throw new TeamDraftError("not-found", "The draft hasn't started.");
      const next = applyTeamUndo(snap.data() as TeamDraftState);
      tx.update(draftRef, {
        picks: next.picks,
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

/** Admin: delete the draft so it can be started fresh. Refuses once finalized. */
export const resetTeamDraft = onCall(async (request) => {
  await requireAdmin(request, "resetTeamDraft", { maxCalls: 20, windowSeconds: 60 });
  const tournamentId = requireTournamentId(request.data);
  const draftRef = db().collection("teamDrafts").doc(tournamentId);
  const snap = await draftRef.get();
  if (snap.exists && snap.data()?.phase === "finalized") {
    throw new HttpsError(
      "failed-precondition",
      "This draft is finalized and the rosters are written. Edit rosters in admin settings instead."
    );
  }
  await draftRef.delete();
  return { success: true };
});

/**
 * Admin: write the finished draft to the tournament — each team's rosterByTier
 * and handicapByPlayer (the pool's frozen handicaps) — hide the Draft Pool, and
 * mark the draft finalized, all in one transaction.
 *
 * Refuses if a team's current roster holds anyone besides its captain (someone
 * already set rosters by hand) unless `force` is passed.
 */
export const finalizeTeamDraft = onCall(async (request) => {
  await requireAdmin(request, "finalizeTeamDraft", { maxCalls: 10, windowSeconds: 60 });
  const tournamentId = requireTournamentId(request.data);
  const force = !!request.data?.force;

  const draftRef = db().collection("teamDrafts").doc(tournamentId);
  const tRef = db().collection("tournaments").doc(tournamentId);
  try {
    await db().runTransaction(async (tx) => {
      const [dSnap, tSnap] = await Promise.all([tx.get(draftRef), tx.get(tRef)]);
      if (!dSnap.exists) throw new TeamDraftError("not-found", "The draft hasn't started.");
      if (!tSnap.exists) throw new TeamDraftError("not-found", "Tournament not found.");
      const draft = dSnap.data() as TeamDraftState & { handicapByPlayer: Record<string, number | null> };
      if (draft.phase !== "review") {
        throw new TeamDraftError("not-complete", "The draft must be complete before finalizing.");
      }
      const t = tSnap.data()!;

      const update: Record<string, unknown> = {
        hideDraftPool: true,
      };
      for (const team of ["teamA", "teamB"] as const) {
        if (!force) {
          const existing = Object.values((t[team]?.rosterByTier ?? {}) as Record<string, string[]>).flat();
          const extras = existing.filter((pid) => !draft.keepers[team].includes(pid));
          if (extras.length > 0) {
            throw new TeamDraftError(
              "roster-not-empty",
              `${t[team]?.name || team} already has rostered players. Clear them first, or finalize with force.`
            );
          }
        }
        const handicaps: Record<string, number> = {};
        for (const pid of teamPlayerIds(draft, team)) {
          const h = draft.handicapByPlayer?.[pid];
          if (typeof h === "number") handicaps[pid] = h;
        }
        update[`${team}.rosterByTier`] = rosterByTierFromDraft(draft, team);
        update[`${team}.handicapByPlayer`] = handicaps;
      }

      tx.update(tRef, update);
      tx.update(draftRef, { phase: "finalized", updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (e) {
    throw toHttpsError(e);
  }
  return { success: true };
});
