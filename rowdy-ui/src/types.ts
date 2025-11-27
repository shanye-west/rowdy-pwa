export type RoundFormat = "twoManBestBall" | "twoManShamble" | "twoManScramble" | "singles";

export type PlayerDoc = { 
  id: string; 
  displayName?: string; 
  username?: string;
  tempPassword?: string;  // Temporary password for first login (cleared after setup)
  authUid?: string;       // Firebase Auth UID (set after account setup)
  email?: string;         // Email for login (set after account setup)
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
  yards?: number; // Yardage for the hole
};

// UPDATED: RoundDoc now includes courseId reference
export type RoundDoc = {
  id: string;
  tournamentId: string;
  day?: number;
  format?: RoundFormat | null; // null until format is selected
  locked?: boolean;
  courseId?: string; // Reference to courses collection
  pointsValue?: number; // Points value for all matches in this round
  matchIds?: string[]; // Auto-populated when matches are linked
  
  // DRIVE_TRACKING: Feature toggle for scramble/shamble drive tracking
  trackDrives?: boolean;
  
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
  tees?: string; // e.g., "Blue", "White"
  par?: number; // Total course par (e.g., 72)
  holes: HoleInfo[];
};

export type MatchDoc = {
  id: string;
  roundId: string;
  tournamentId?: string;
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
    wasTeamADown3PlusBack9?: boolean;
    wasTeamAUp3PlusBack9?: boolean;
    marginHistory?: number[]; // Running margin after each hole (positive = TeamA up)
  };
  teamAPlayers?: { playerId: string; strokesReceived: number[] }[];
  teamBPlayers?: { playerId: string; strokesReceived: number[] }[];
};

export type PlayerMatchFact = {
  playerId: string;
  matchId: string;
  tournamentId: string;
  roundId: string;
  format: string;
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

  // Partners
  partnerIds?: string[];
  partnerTiers?: string[];

  // Match result details
  holesWon?: number;
  holesLost?: number;
  holesHalved?: number; // finalThru - holesWon - holesLost
  finalMargin?: number;
  finalThru?: number;

  // Momentum stats (was down/up 3+ on back 9)
  comebackWin?: boolean;
  blownLead?: boolean;

  // Additional match stats
  strokesGiven?: number;      // Total strokes received in match
  leadChanges?: number;       // Number of lead changes during match
  wasNeverBehind?: boolean;   // Never trailed during match
  winningHole?: number | null; // Hole where match was won (null if went 18 or halved)
  
  // Format-specific stats
  ballsUsed?: number;         // Best Ball/Shamble: holes where player's score was team's best (includes ties)
  ballsUsedSolo?: number;     // Best Ball/Shamble: holes where player's score was strictly better than partner
  ballsUsedShared?: number;   // Best Ball/Shamble: holes where player tied with partner
  ballsUsedSoloWonHole?: number; // Best Ball/Shamble: solo ball AND team won the hole
  ballsUsedSoloPush?: number; // Best Ball/Shamble: solo ball AND hole was halved (tied)
  drivesUsed?: number;        // DRIVE_TRACKING: Scramble/Shamble: drives used by this player

  // Individual scoring stats (twoManBestBall, singles only)
  totalGross?: number;        // Sum of player's gross scores
  totalNet?: number;          // Sum of player's net scores (gross - strokes received)
  strokesVsParGross?: number; // totalGross - coursePar (e.g., +5, -2)
  strokesVsParNet?: number;   // totalNet - coursePar

  // Team scoring stats (twoManScramble, twoManShamble only)
  teamTotalGross?: number;        // Team's combined gross score
  teamStrokesVsParGross?: number; // teamTotalGross - coursePar

  // Course context
  coursePar?: number;         // Course par for reference

  // Round context
  courseId?: string;
  day?: number;

  // Tournament context
  tournamentYear?: number;
  tournamentName?: string;
  tournamentSeries?: string;

  updatedAt?: any;
};

export type PlayerStatDoc = {
  id: string; // matches playerId
  wins: number;
  losses: number;
  halves: number;
  totalPoints: number;
  matchesPlayed: number;
  lastUpdated?: any; // Firestore Timestamp
};