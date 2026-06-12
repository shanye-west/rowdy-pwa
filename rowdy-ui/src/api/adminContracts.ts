/**
 * Request/response contracts for the admin callables in functions/.
 *
 * KEEP IN SYNC with functions/src/callables/contracts.ts — the two files are
 * mirrored by convention (functions and rowdy-ui have separate tsconfig
 * projects, so types are duplicated rather than shared).
 */

import type { RoundFormat, TierMap } from "../types";

/** Default success payload returned by most admin callables. */
export interface AdminResult {
  success: boolean;
}

// ============================================================================
// TOURNAMENT
// ============================================================================

/** Editable team fields accepted by updateTournament (whitelist-validated server-side). */
export interface TeamUpdates {
  name?: string;
  color?: string;
  logo?: string;
  captainId?: string;
  coCaptainId?: string;
  rosterByTier?: TierMap;
  handicapByPlayer?: Record<string, number>;
}

export interface TournamentUpdates {
  name?: string;
  year?: number;
  series?: string;
  active?: boolean;
  openPublicEdits?: boolean;
  test?: boolean;
  teamA?: TeamUpdates;
  teamB?: TeamUpdates;
}

export interface UpdateTournamentRequest {
  tournamentId: string;
  updates: TournamentUpdates;
}

export interface UpdateTournamentResult extends AdminResult {
  tournamentId: string;
  updatedFields: string[];
}

// ============================================================================
// ROUND
// ============================================================================

export interface RoundUpdates {
  day?: number;
  format?: RoundFormat | null;
  courseId?: string | null;
  pointsValue?: number;
  locked?: boolean;
  trackDrives?: boolean;
  skinsGrossPot?: number;
  skinsNetPot?: number;
  skinsHandicapPercent?: number;
}

export interface CreateRoundRequest extends RoundUpdates {
  tournamentId: string;
  id?: string;
}

export interface CreateRoundResult extends AdminResult {
  roundId: string;
}

export interface UpdateRoundRequest {
  roundId: string;
  updates: RoundUpdates;
}

export interface UpdateRoundResult extends AdminResult {
  roundId: string;
  updatedFields: string[];
}

// ============================================================================
// MATCH
// ============================================================================

export interface SetMatchLockRequest {
  matchId: string;
  locked: boolean;
}

export interface SetMatchLockResult extends AdminResult {
  matchId: string;
  locked: boolean;
}

export interface AdminOverrideHoleScoreRequest {
  matchId: string;
  hole: number;
  /** Format-specific hole input — see HoleInput variants in types.ts. */
  input: Record<string, unknown>;
}

export interface DeleteMatchRequest {
  matchId: string;
}

export interface MatchPlayerInput {
  playerId: string;
  /** Optional override; the server falls back to tournament.handicapByPlayer. */
  handicapIndex?: number;
}

export interface SeedMatchRequest {
  id: string;
  tournamentId: string;
  roundId: string;
  /** ISO string; the server stores it as a Timestamp. */
  teeTime?: string;
  teamAPlayers: MatchPlayerInput[];
  teamBPlayers: MatchPlayerInput[];
  matchNumber?: number;
}

export interface SeedMatchResult extends AdminResult {
  matchId: string;
}

export interface EditMatchRequest {
  matchId: string;
  tournamentId: string;
  roundId: string;
  teeTime?: string;
  teamAPlayers: MatchPlayerInput[];
  teamBPlayers: MatchPlayerInput[];
}

export interface RecalculateMatchStrokesRequest {
  matchId: string;
}

export interface RecalculateMatchStrokesResult extends AdminResult {
  matchId: string;
  courseHandicaps: number[];
}

// ============================================================================
// PLAYER
// ============================================================================

export interface CreatePlayerRequest {
  id: string;
  displayName: string;
}

export interface UpdatePlayerInfoRequest {
  playerId: string;
  displayName: string;
}

export interface LinkAuthToPlayerRequest {
  playerId: string;
  email: string;
}

export interface LinkAuthToPlayerResult extends AdminResult {
  playerId: string;
  authUid: string;
}

// ============================================================================
// STATS
// ============================================================================

export interface RecalculateAllStatsRequest {
  dryRun?: boolean;
}

export interface RecalculateAllStatsDryRunResult {
  success: boolean;
  dryRun: true;
  factsToDelete: number;
  affectedPlayers: number;
  tournamentsAffected: number;
  matchesToRecalculate: number;
  message: string;
}

export interface RecalculateAllStatsExecuteResult {
  success: boolean;
  dryRun: false;
  factsDeleted: number;
  statsAutoCleanedUp: number;
  tournamentsRecalculated: number;
  matchesRecalculated: number;
  message: string;
}

export type RecalculateAllStatsResult =
  | RecalculateAllStatsDryRunResult
  | RecalculateAllStatsExecuteResult;

export interface ComputeRoundRecapRequest {
  roundId: string;
}

export interface ComputeRoundRecapResult {
  success: boolean;
  roundId: string;
  stats: {
    playersAnalyzed: number;
    vsAllMatchupsSimulated: number;
    birdiesGrossLeader: string;
    birdiesGrossCount: number;
    eaglesGrossLeader: string;
    eaglesGrossCount: number;
  };
  message: string;
}
