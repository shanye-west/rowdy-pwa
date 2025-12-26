/**
 * Shared types for Cloud Functions
 */

export type RoundFormat = "twoManBestBall" | "twoManShamble" | "twoManScramble" | "fourManScramble" | "singles";

// ============================================================================
// HOLE INPUT TYPES - Format-specific score input structures
// ============================================================================

/** Singles: one gross score per player */
export type SinglesHoleInput = {
  teamAPlayerGross: number | null;
  teamBPlayerGross: number | null;
};

/** Scramble: one team gross score + drive selection per team */
export type ScrambleHoleInput = {
  teamAGross: number | null;
  teamBGross: number | null;
  teamADrive: number | null;
  teamBDrive: number | null;
};

/** Best Ball: two individual gross scores per team (best net wins) */
export type BestBallHoleInput = {
  teamAPlayersGross: [number | null, number | null];
  teamBPlayersGross: [number | null, number | null];
};

/** Shamble: two individual gross scores + drive selection per team */
export type ShambleHoleInput = {
  teamAPlayersGross: [number | null, number | null];
  teamBPlayersGross: [number | null, number | null];
  teamADrive: number | null;
  teamBDrive: number | null;
};

/** Union of all format-specific inputs */
export type HoleInput = SinglesHoleInput | ScrambleHoleInput | BestBallHoleInput | ShambleHoleInput;

/**
 * Loose HoleInput for backwards compatibility - all fields optional.
 * Use format-specific types when format is known.
 */
export interface HoleInputLoose {
  teamAGross?: number | null;
  teamBGross?: number | null;
  teamADrive?: number | null;
  teamBDrive?: number | null;
  teamAPlayerGross?: number | null;
  teamBPlayerGross?: number | null;
  teamAPlayersGross?: (number | null)[];
  teamBPlayersGross?: (number | null)[];
}

/** Wrapper for hole data in match document */
export type HoleData = {
  /** 
   * Use HoleInputLoose for backwards compatibility with existing code.
   * When format is known, narrow with type guards.
   */
  input: HoleInputLoose;
};

// ============================================================================
// TYPE GUARDS - Check format type
// ============================================================================

/** Check if format is singles */
export function isSinglesFormat(format: RoundFormat | null | undefined): boolean {
  return format === "singles";
}

/** Check if format is scramble */
export function isScrambleFormat(format: RoundFormat | null | undefined): boolean {
  return format === "twoManScramble" || format === "fourManScramble";
}

/** Check if format is best ball */
export function isBestBallFormat(format: RoundFormat | null | undefined): boolean {
  return format === "twoManBestBall";
}

/** Check if format is shamble */
export function isShambleFormat(format: RoundFormat | null | undefined): boolean {
  return format === "twoManShamble";
}

/** Check if format uses individual player scores (2 per team) */
export function isFourPlayerFormat(format: RoundFormat | null | undefined): boolean {
  return format === "twoManBestBall" || format === "twoManShamble";
}

/** Check if format tracks drives */
export function isDriveTrackingFormat(format: RoundFormat | null | undefined): boolean {
  return format === "twoManScramble" || format === "fourManScramble" || format === "twoManShamble";
}

// ============================================================================
// MATCH TYPES
// ============================================================================

export interface MatchStatus {
  leader: "teamA" | "teamB" | null;
  margin: number;
  thru: number;
  dormie: boolean;
  closed: boolean;
  wasTeamADown3PlusBack9?: boolean;
  wasTeamAUp3PlusBack9?: boolean;
  marginHistory?: number[];
}

export interface MatchResult {
  winner: "teamA" | "teamB" | "AS";
  holesWonA: number;
  holesWonB: number;
}

export interface PlayerInMatch {
  playerId: string;
  strokesReceived: number[];
}

// =============================================================================
// PLAYER STATS BY SERIES
// Aggregated stats per player per tournament series (rowdyCup, christmasClassic)
// =============================================================================

export type TournamentSeries = "rowdyCup" | "christmasClassic";

export interface PlayerStatsBySeries {
  playerId: string;
  series: TournamentSeries;
  
  // Core record
  wins: number;
  losses: number;
  halves: number;
  points: number;
  matchesPlayed: number;
  
  // Format breakdown
  formatBreakdown?: {
    singles?: { wins: number; losses: number; halves: number; matches: number };
    twoManBestBall?: { wins: number; losses: number; halves: number; matches: number };
    twoManShamble?: { wins: number; losses: number; halves: number; matches: number };
    twoManScramble?: { wins: number; losses: number; halves: number; matches: number };
  };
  
  // Scoring stats (individual formats only: singles, bestBall)
  totalGross?: number;        // Cumulative gross strokes
  totalNet?: number;          // Cumulative net strokes
  holesPlayed?: number;       // For calculating averages
  strokesVsParGross?: number; // Cumulative strokes vs par (gross)
  strokesVsParNet?: number;   // Cumulative strokes vs par (net)
  
  // Counting stats
  birdies?: number;
  eagles?: number;
  holesWon?: number;
  holesLost?: number;
  holesHalved?: number;
  
  // Badge counters
  comebackWins: number;
  blownLeads: number;
  neverBehindWins: number;   // Won without ever trailing
  jekyllAndHydes: number;    // Worst ball - best ball >= 24
  clutchWins: number;        // Match decided on 18th hole AND player's team won
  
  // Team format stats
  drivesUsed?: number;
  ballsUsed?: number;
  ballsUsedSolo?: number;
  hamAndEggs?: number;
  
  // Captain stats
  captainWins?: number;
  captainLosses?: number;
  captainHalves?: number;
  captainVsCaptainWins?: number;
  captainVsCaptainLosses?: number;
  captainVsCaptainHalves?: number;
  
  lastUpdated: any; // FieldValue.serverTimestamp()
}

export interface MatchData {
  tournamentId?: string;
  roundId?: string;
  teamAPlayers?: PlayerInMatch[];
  teamBPlayers?: PlayerInMatch[];
  holes?: Record<string, HoleData>;
  status?: MatchStatus;
  result?: MatchResult;
}

// ============================================================================
// SKINS TYPES
// Pre-computed skins results stored in rounds/{roundId}/skinsResults/computed
// ============================================================================

export interface PlayerHoleScore {
  playerId: string;
  playerName: string;
  gross: number | null;
  net: number | null;
  hasStroke: boolean;
  playerThru: number; // Number of holes completed by this player
  playerTeeTime?: any; // Firestore Timestamp
}

export interface HoleSkinData {
  holeNumber: number;
  par: number;
  grossWinner: string | null; // playerId or null if tied
  netWinner: string | null;
  grossLowScore: number | null;
  netLowScore: number | null;
  grossTiedCount: number; // 0 if winner, >1 if tied
  netTiedCount: number;
  allScores: PlayerHoleScore[]; // All player scores for this hole
  allPlayersCompleted: boolean; // True if all players have completed this hole
}

export interface PlayerSkinsTotal {
  playerId: string;
  playerName: string;
  grossSkinsWon: number;
  netSkinsWon: number;
  grossHoles: number[]; // Hole numbers won
  netHoles: number[];
  grossEarnings: number;
  netEarnings: number;
  totalEarnings: number;
}

export interface SkinsResultDoc {
  holeSkinsData: HoleSkinData[];
  playerTotals: PlayerSkinsTotal[];
  skinsGrossPot: number;
  skinsNetPot: number;
  lastUpdated: any; // FieldValue.serverTimestamp()
  _computeSig: string; // Hash to detect changes
}

// ============================================================================
// ROUND RECAP TYPES
// Pre-computed round statistics including "vs All" simulations
// ============================================================================

export interface VsAllRecord {
  playerId: string;
  playerName: string;
  wins: number;
  losses: number;
  ties: number;
  teamKey?: string; // For team formats: "player1Id_player2Id"
}

export interface HoleAverageData {
  holeNumber: number;
  par: number;
  avgGross: number | null;
  avgNet: number | null; // Only for singles/bestBall
  lowestGross: number | null;
  lowestNet: number | null;
  highestGross: number | null;
  highestNet: number | null;
  scoringCount: number; // Number of players with scores
}

export interface BirdieEagleLeader {
  playerId: string;
  playerName: string;
  count: number;
  holes: number[]; // Hole numbers where achieved
}

export interface RoundRecapDoc {
  roundId: string;
  tournamentId: string;
  format: RoundFormat;
  day?: number;
  courseId: string;
  courseName: string;
  coursePar: number;
  
  // "vs All" simulation results
  vsAllRecords: VsAllRecord[];
  
  // Hole-by-hole averages
  holeAverages: HoleAverageData[];
  
  // Leaders
  leaders: {
    birdiesGross: BirdieEagleLeader[];
    birdiesNet: BirdieEagleLeader[];
    eaglesGross: BirdieEagleLeader[];
    eaglesNet: BirdieEagleLeader[];
    
    // Best/worst holes
    bestHole?: { holeNumber: number; avgStrokesUnderPar: number }; // Lowest avg vs par
    worstHole?: { holeNumber: number; avgStrokesOverPar: number }; // Highest avg vs par
  };
  
  computedAt: any; // FieldValue.serverTimestamp()
  computedBy: string; // uid of admin who triggered
}
