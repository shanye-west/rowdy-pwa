/**
 * Read-only Firestore access layer for the MCP server.
 *
 * Uses the *unauthenticated* Firebase Web SDK. Every collection read here is
 * public-read per firestore.rules, and all client writes are denied by those
 * same rules — so this layer physically cannot write, regardless of code paths.
 * There is intentionally no write helper anywhere in this module.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { FIREBASE_WEB_CONFIG, DEFAULT_SERIES } from "./config.js";
import type {
  PlayerDoc,
  TournamentDoc,
  RoundDoc,
  PlayerStatsDoc,
  PlayerMatchFact,
  PlayerRecentRoundsDoc,
} from "./types.js";

let _db: Firestore | null = null;

/** Lazily initialise a single anonymous Web SDK app + Firestore instance. */
function db(): Firestore {
  if (_db) return _db;
  const app: FirebaseApp = getApps()[0] ?? initializeApp(FIREBASE_WEB_CONFIG, "rowdy-mcp");
  _db = getFirestore(app);
  return _db;
}

/** A player is "real" if its id isn't `_`-prefixed and it isn't a seeded test row. */
export function isRealPlayer(id: string, data: { _testSeed?: boolean }): boolean {
  return !id.startsWith("_") && data._testSeed !== true;
}

/** All real (non-test) players. */
export async function getAllRealPlayers(): Promise<PlayerDoc[]> {
  const snap = await getDocs(collection(db(), "players"));
  return snap.docs
    .filter((d) => isRealPlayer(d.id, d.data() as PlayerDoc))
    .map((d) => ({ id: d.id, ...(d.data() as Omit<PlayerDoc, "id">) }));
}

export async function getPlayerDoc(playerId: string): Promise<PlayerDoc | null> {
  const snap = await getDoc(doc(db(), "players", playerId));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<PlayerDoc, "id">) }) : null;
}

/** The active tournament (active == true), or null. */
export async function getActiveTournament(): Promise<TournamentDoc | null> {
  const snap = await getDocs(
    query(collection(db(), "tournaments"), where("active", "==", true))
  );
  const d = snap.docs[0];
  return d ? ({ id: d.id, ...(d.data() as Omit<TournamentDoc, "id">) }) : null;
}

export async function getTournament(tournamentId: string): Promise<TournamentDoc | null> {
  const snap = await getDoc(doc(db(), "tournaments", tournamentId));
  return snap.exists()
    ? ({ id: snap.id, ...(snap.data() as Omit<TournamentDoc, "id">) })
    : null;
}

/** Resolve the tournament to operate on: explicit id, else the active one. */
export async function resolveTournament(tournamentId?: string): Promise<TournamentDoc | null> {
  return tournamentId ? getTournament(tournamentId) : getActiveTournament();
}

/** Series to use: explicit, else the active tournament's series, else default. */
export async function resolveSeries(series?: string): Promise<string> {
  if (series) return series;
  const active = await getActiveTournament();
  return active?.series || DEFAULT_SERIES;
}

export async function getRoundsForTournament(tournamentId: string): Promise<RoundDoc[]> {
  const snap = await getDocs(
    query(collection(db(), "rounds"), where("tournamentId", "==", tournamentId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RoundDoc, "id">) }));
}

/**
 * Aggregated player stats for a scope.
 *  - allTime  -> playerStats/{playerId}/bySeries/{series}
 *  - tournament -> playerStats/{playerId}/byTournament/{tournamentId}
 */
export async function getPlayerStats(
  playerId: string,
  scope: "allTime" | "tournament",
  key: string
): Promise<PlayerStatsDoc | null> {
  const sub = scope === "tournament" ? "byTournament" : "bySeries";
  const snap = await getDoc(doc(db(), "playerStats", playerId, sub, key));
  return snap.exists() ? (snap.data() as PlayerStatsDoc) : null;
}

/** All match facts for a player (single-field auto-index; no composite needed). */
export async function getFactsForPlayer(playerId: string): Promise<PlayerMatchFact[]> {
  const snap = await getDocs(
    query(collection(db(), "playerMatchFacts"), where("playerId", "==", playerId))
  );
  return snap.docs.map((d) => d.data() as PlayerMatchFact);
}

/**
 * Current-tournament aggregates via the existing `byTournament` collection-group
 * index (same query the frontend's useTournamentLeaderboard runs).
 */
export async function getTournamentStatRows(tournamentId: string): Promise<PlayerStatsDoc[]> {
  const snap = await getDocs(
    query(collectionGroup(db(), "byTournament"), where("tournamentId", "==", tournamentId))
  );
  return snap.docs.map((d) => d.data() as PlayerStatsDoc);
}

/** roundRecaps/{roundId} */
export async function getRoundRecap(roundId: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db(), "roundRecaps", roundId));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
}

/** playerRecentRounds/{playerId} — one golfer's last ~20 GHIN rounds + summary. */
export async function getRecentRounds(playerId: string): Promise<PlayerRecentRoundsDoc | null> {
  const snap = await getDoc(doc(db(), "playerRecentRounds", playerId));
  return snap.exists() ? (snap.data() as PlayerRecentRoundsDoc) : null;
}

/** All players' recent-rounds docs, keyed by playerId (for the draft-pool join). */
export async function getAllRecentRounds(): Promise<Map<string, PlayerRecentRoundsDoc>> {
  const snap = await getDocs(collection(db(), "playerRecentRounds"));
  const out = new Map<string, PlayerRecentRoundsDoc>();
  snap.docs.forEach((d) => out.set(d.id, d.data() as PlayerRecentRoundsDoc));
  return out;
}
