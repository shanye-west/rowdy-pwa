/**
 * Request/response contracts for the admin callables in functions/.
 *
 * KEEP IN SYNC with functions/src/callables/contracts.ts — the two files are
 * mirrored by convention (functions and rowdy-ui have separate tsconfig
 * projects, so types are duplicated rather than shared).
 */

import type { RoundFormat, TierMap, BetMarket, BetSide } from "../types";

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
  archived?: boolean;
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

export interface CreateTournamentRequest {
  id?: string;
  name: string;
  year: number;
  series: string;
  active?: boolean;
  test?: boolean;
  teamA?: TeamUpdates;
  teamB?: TeamUpdates;
}

export interface CreateTournamentResult extends AdminResult {
  tournamentId: string;
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

export interface DeleteRoundRequest {
  roundId: string;
  /** Required when the round still has matches; cascades their deletion. */
  force?: boolean;
}

export interface DeleteRoundResult extends AdminResult {
  roundId: string;
  matchesDeleted: number;
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

export interface DeletePlayerRequest {
  playerId: string;
}

export interface SetPlayerAdminRequest {
  playerId: string;
  isAdmin: boolean;
}

// ============================================================================
// COURSE
// ============================================================================

export interface CourseHoleInput {
  number: number;
  par: number;
  hcpIndex: number;
  yards?: number;
}

export interface UpsertCourseRequest {
  /** Omit to create with an auto id; provide to create-with-id or update. */
  courseId?: string;
  name: string;
  tees?: string;
  par: number;
  rating: number;
  slope: number;
  holes: CourseHoleInput[];
}

export interface UpsertCourseResult extends AdminResult {
  courseId: string;
  created: boolean;
}

export interface DeleteCourseRequest {
  courseId: string;
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

// ============================================================================
// PAIRINGS / DRAFT
// ============================================================================

export type DraftTeam = "teamA" | "teamB";

export interface CreatePairingDraftRequest {
  roundId: string;
  /** Player ids available this round, per team (each list belongs to that team's roster). */
  availableTeamA: string[];
  availableTeamB: string[];
  /** Coin-flip outcome: which team nominates match 1. */
  firstPickTeam: DraftTeam;
  /** Overwrite an existing (non-finalized) draft for this round. */
  reset?: boolean;
}

export interface CreatePairingDraftResult extends AdminResult {
  roundId: string;
  totalMatches: number;
}

export interface SubmitDraftPickRequest {
  roundId: string;
  /** The team the caller is acting for; must be captain/co-captain of it (or admin). */
  team: DraftTeam;
  /** Players being placed (length = players-per-side). */
  playerIds: string[];
}

export interface UndoDraftPickRequest {
  roundId: string;
  /** The team the caller is acting for (captain/co-captain of it, or admin). */
  team: DraftTeam;
}

export interface ResetPairingDraftRequest {
  roundId: string;
}

export interface FinalizePairingDraftRequest {
  roundId: string;
  /** Create matches even if some already exist for the round. */
  force?: boolean;
}

export interface FinalizePairingDraftResult extends AdminResult {
  roundId: string;
  matchIds: string[];
}

// ============================================================================
// SPORTSBOOK (PEER-TO-PEER BETTING)
// ============================================================================

/** Post an open marketplace offer (anyone may take the other side). */
export interface CreateBetOfferRequest {
  tournamentId: string;
  market: BetMarket;
  /** Required when market === "match". */
  matchId?: string;
  /** The team the proposer is backing to win. */
  side: BetSide;
  /** Even-money stake each side risks. */
  amount: number;
}

/** Post a directed challenge to one specific player. */
export interface CreateBetChallengeRequest extends CreateBetOfferRequest {
  targetId: string;
}

export interface CreateBetResult extends AdminResult {
  betId: string;
}

/** Shared payload for the single-bet lifecycle actions. */
export interface BetActionRequest {
  betId: string;
}

/** Admin: resolve the Cup-futures market for a tournament. */
export interface SettleCupFuturesRequest {
  tournamentId: string;
  /** "push" retains/ties the Cup — all futures bets refund. */
  winningTeam: BetSide | "push";
}

export interface SettleCupFuturesResult extends AdminResult {
  settledCount: number;
}
