import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";

import { db } from "./firebase";
import { RoundFormat, defaultStatus, ensureSideSize, normalizeHoles, playersPerSide } from "./utils";

export const seedMatchBoilerplate = onDocumentCreated("matches/{matchId}", async (event) => {
  const matchRef = event.data?.ref;
  const match = event.data?.data() || {};
  if (!matchRef) return;
  const roundId: string | undefined = match.roundId;
  if (!roundId) return;

  const roundSnap = await db.collection("rounds").doc(roundId).get();
  if (!roundSnap.exists) return;
  const round = roundSnap.data()!;
  const format = (round.format as RoundFormat) || "twoManBestBall";
  const tournamentId = match.tournamentId ?? round.tournamentId ?? "";

  const count = playersPerSide(format);
  const teamA = ensureSideSize(match.teamAPlayers, count);
  const teamB = ensureSideSize(match.teamBPlayers, count);
  const holes = normalizeHoles(match.holes, format);

  await matchRef.set({
    tournamentId, roundId,
    teamAPlayers: teamA, teamBPlayers: teamB,
    status: match.status ?? defaultStatus(),
    holes,
    _seededAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const roundRef = db.collection("rounds").doc(roundId);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(roundRef);
    if (!s.exists) return;
    const r = s.data()!;
    const list: string[] = Array.isArray(r.matchIds) ? r.matchIds : [];
    if (!list.includes(event.params.matchId)) {
      tx.update(roundRef, { matchIds: [...list, event.params.matchId] });
    }
  });
});

export const seedRoundDefaults = onDocumentCreated("rounds/{roundId}", async (event) => {
  const ref = event.data?.ref;
  const data = event.data?.data();
  if (!ref || !data) return;

  const toMerge: any = {};
  if (!Array.isArray(data.matchIds)) toMerge.matchIds = [];
  if (data.day === undefined) toMerge.day = 0;
  if (data.format === undefined) toMerge.format = null;
  if (data.courseId === undefined) toMerge.courseId = null;
  if (data.locked === undefined) toMerge.locked = false;
  if (data.pointsValue === undefined) toMerge.pointsValue = 1;
  if (data.trackDrives === undefined) toMerge.trackDrives = false;
  if (Object.keys(toMerge).length > 0) {
    toMerge._seededAt = FieldValue.serverTimestamp();
    await ref.set(toMerge, { merge: true });
  }
});

export const linkRoundToTournament = onDocumentWritten("rounds/{roundId}", async (event) => {
  const after = event.data?.after.data();
  if (!after) return;
  const tId = after.tournamentId;
  if (!tId) return;
  const tRef = db.collection("tournaments").doc(tId);
  await db.runTransaction(async (tx) => {
    const tSnap = await tx.get(tRef);
    if (!tSnap.exists) return;
    const t = tSnap.data()!;
    const rIds: string[] = Array.isArray(t.roundIds) ? t.roundIds : [];
    if (!rIds.includes(event.params.roundId)) {
      tx.update(tRef, { roundIds: [...rIds, event.params.roundId] });
    }
  });
});

export const seedTournamentDefaults = onDocumentCreated("tournaments/{tournamentId}", async (event) => {
  const ref = event.data?.ref;
  const data = event.data?.data();
  if (!ref || !data) return;

  const toMerge: any = {};

  if (data.year === undefined) toMerge.year = new Date().getFullYear();
  if (data.name === undefined) toMerge.name = "";
  if (data.series === undefined) toMerge.series = "";
  if (data.active === undefined) toMerge.active = false;
  if (!Array.isArray(data.roundIds)) toMerge.roundIds = [];
  if (data.tournamentLogo === undefined) toMerge.tournamentLogo = "";

  if (!data.teamA || typeof data.teamA !== "object") {
    toMerge.teamA = { id: "teamA", name: "", logo: "", color: "", rosterByTier: {}, handicapByPlayer: {} };
  } else {
    const teamA: any = { ...data.teamA };
    if (teamA.id === undefined) teamA.id = "teamA";
    if (teamA.name === undefined) teamA.name = "";
    if (teamA.logo === undefined) teamA.logo = "";
    if (teamA.color === undefined) teamA.color = "";
    if (teamA.rosterByTier === undefined) teamA.rosterByTier = {};
    if (teamA.handicapByPlayer === undefined) teamA.handicapByPlayer = {};
    toMerge.teamA = teamA;
  }

  if (!data.teamB || typeof data.teamB !== "object") {
    toMerge.teamB = { id: "teamB", name: "", logo: "", color: "", rosterByTier: {}, handicapByPlayer: {} };
  } else {
    const teamB: any = { ...data.teamB };
    if (teamB.id === undefined) teamB.id = "teamB";
    if (teamB.name === undefined) teamB.name = "";
    if (teamB.logo === undefined) teamB.logo = "";
    if (teamB.color === undefined) teamB.color = "";
    if (teamB.rosterByTier === undefined) teamB.rosterByTier = {};
    if (teamB.handicapByPlayer === undefined) teamB.handicapByPlayer = {};
    toMerge.teamB = teamB;
  }

  if (Object.keys(toMerge).length > 0) {
    toMerge._seededAt = FieldValue.serverTimestamp();
    await ref.set(toMerge, { merge: true });
  }
});

export const seedCourseDefaults = onDocumentCreated("courses/{courseId}", async (event) => {
  const ref = event.data?.ref;
  const data = event.data?.data();
  if (!ref || !data) return;

  const toMerge: any = {};

  if (!Array.isArray(data.holes)) {
    toMerge.holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1,
      hcpIndex: 0,
      par: 4,
      yards: 0
    }));
  }

  if (data.par === undefined) toMerge.par = 72;
  if (data.name === undefined) toMerge.name = "";
  if (data.tees === undefined) toMerge.tees = "";

  if (Object.keys(toMerge).length > 0) {
    toMerge._seededAt = FieldValue.serverTimestamp();
    await ref.set(toMerge, { merge: true });
  }
});
