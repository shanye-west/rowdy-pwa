export type RoundFormat = "twoManBestBall" | "twoManShamble" | "twoManScramble" | "singles";

export type PlayerDoc = { 
  id: string; 
  displayName?: string; 
  username?: string; 
};

// NEW: Helper for the Tier Arrays
export type TierMap = {
  A?: string[];
  B?: string[];
  C?: string[];
  D?: string[];
};

export type TournamentDoc = {
  id: string;
  year: number;
  name: string;
  series: string;
  active: boolean;
  roundIds?: string[];
  tournamentLogo?: string;
  teamA: { 
    id: string; 
    name: string;
    logo?: string;
    color?: string; 
    rosterByTier?: TierMap;
    handicapByPlayer?: Record<string, number>; // playerId -> handicap index (e.g., 7.4)
  };
  teamB: { 
    id: string; 
    name: string;
    logo?: string;
    color?: string; 
    rosterByTier?: TierMap;
    handicapByPlayer?: Record<string, number>; // playerId -> handicap index (e.g., 9.5)
  };
};

// NEW: Hole definition (static data)
export type HoleInfo = {
  number: number;
  par: number;
  hcpIndex: number; // Handicap Index (1-18)
};

// UPDATED: RoundDoc now includes courseId reference
export type RoundDoc = {
  id: string;
  tournamentId: string;
  day?: number;
  format: RoundFormat;
  locked?: boolean;
  courseId?: string; // Reference to courses collection
  
  // Legacy: embedded course data (may not be present)
  course?: {
    name: string;
    tee?: string; // e.g., "Blue", "White"
    holes: HoleInfo[]; // Array of 18 objects
  };
};

// NEW: Course document type
export type CourseDoc = {
  id: string;
  name: string;
  tee?: string;
  holes: HoleInfo[];
};

export type MatchDoc = {
  id: string;
  roundId: string;
  tournamentId?: string;
  pointsValue: number;
  holes?: Record<string, { input: any }>;
  result?: { 
    winner?: "teamA" | "teamB" | "AS";
    holesWonA?: number;
    holesWonB?: number;
  };
  status?: {
    leader: "teamA" | "teamB" | null;
    margin: number;
    thru: number;
    dormie: boolean;
    closed: boolean;
  };
  teamAPlayers?: { playerId: string; strokesReceived: number[] }[];
  teamBPlayers?: { playerId: string; strokesReceived: number[] }[];
};

export type PlayerMatchFact = {
  playerId: string;
  matchId: string;
  tournamentId?: string;
  roundId?: string;
  format?: string;
  outcome: "win" | "loss" | "halve";
  pointsEarned: number;
  
  playerTier?: string;
  playerTeamId?: string;
  opponentTeamId?: string;

  // Handicaps (tournament-specific)
  playerHandicap?: number | null;
  opponentHandicaps?: (number | null)[];  // Array for team formats (1 for singles, 2 for team)
  partnerHandicaps?: (number | null)[];   // Array for team formats (0 for singles, 1 for team)

  // Opponents
  opponentIds?: string[];
  opponentTiers?: string[];

  // Partners (NEW)
  partnerIds?: string[];
  partnerTiers?: string[];

  finalMargin?: number;
  finalThru?: number;
  updatedAt?: any;
};

export type PlayerStatDoc = {
  id: string; // matches playerId
  wins: number;
  losses: number;
  halves: number;
  totalPoints: number;
  matchesPlayed: number;
};