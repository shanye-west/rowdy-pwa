/**
 * Minimal read-only shapes for the MCP server.
 *
 * These are a deliberately small subset of the canonical types in
 * rowdy-ui/src/types.ts and functions/src/types.ts — only the fields the MCP
 * tools read. Kept local so this module stays self-contained.
 */

export type RoundFormat =
  | "singles"
  | "twoManBestBall"
  | "twoManShamble"
  | "twoManScramble"
  | "fourManScramble";

/** players/{playerId} */
export interface PlayerDoc {
  id: string;
  displayName?: string;
  isAdmin?: boolean;
  _testSeed?: boolean;
}

export interface TeamSide {
  id?: string;
  name?: string;
  rosterByTier?: { A?: string[]; B?: string[]; C?: string[]; D?: string[] };
  handicapByPlayer?: Record<string, number>;
  captainId?: string;
  coCaptainId?: string;
}

/** tournaments/{tournamentId} */
export interface TournamentDoc {
  id: string;
  year?: number;
  name?: string;
  series?: string;
  active?: boolean;
  test?: boolean;
  archived?: boolean;
  roundIds?: string[];
  totalPointsAvailable?: number;
  teamA?: TeamSide;
  teamB?: TeamSide;
  tiebreakerWinner?: "teamA" | "teamB";
  draftPool?: Record<string, number>;
}

/** rounds/{roundId} */
export interface RoundDoc {
  id: string;
  tournamentId?: string;
  day?: number;
  format?: RoundFormat | null;
  courseId?: string | null;
  pointsValue?: number;
  pointTotals?: {
    teamAConfirmed: number;
    teamBConfirmed: number;
    teamAPending: number;
    teamBPending: number;
    matchCount: number;
  };
}

/** playerStats/{playerId}/bySeries|byTournament|byRound/{key} */
export interface PlayerStatsDoc {
  playerId?: string;
  series?: string;
  wins?: number;
  losses?: number;
  halves?: number;
  points?: number;
  matchesPlayed?: number;
  formatBreakdown?: Record<
    string,
    { wins: number; losses: number; halves: number; matches: number }
  >;
  birdies?: number;
  eagles?: number;
  holesWon?: number;
  holesLost?: number;
  holesHalved?: number;
  comebackWins?: number;
  blownLeads?: number;
  neverBehindWins?: number;
  jekyllAndHydes?: number;
  clutchWins?: number;
  drivesUsed?: number;
  ballsUsed?: number;
  ballsUsedSolo?: number;
  hamAndEggs?: number;
  captainWins?: number;
  captainLosses?: number;
  captainHalves?: number;
}

/** playerMatchFacts/{factId} — one per rostered player per closed match. */
export interface PlayerMatchFact {
  playerId: string;
  matchId?: string;
  roundId?: string;
  tournamentId?: string;
  tournamentName?: string;
  tournamentSeries?: string;
  tournamentYear?: number;
  day?: number;
  format?: RoundFormat;
  team?: string;
  outcome?: "win" | "loss" | "halve";
  pointsEarned?: number;
  opponentIds?: string[];
  partnerIds?: string[];
  playerTier?: string;
  playerHandicap?: number | null;
  finalMargin?: number;
  finalThru?: number;
  birdies?: number;
  eagles?: number;
  comebackWin?: boolean;
  blownLead?: boolean;
}
