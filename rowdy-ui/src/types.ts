import { Timestamp } from "firebase/firestore";

export type RoundFormat = "twoManBestBall" | "twoManShamble" | "twoManScramble" | "fourManScramble" | "singles";

/**
 * A Firestore timestamp field that may also appear as a Date, ISO/datetime string,
 * or serialized POJO (e.g. when passed via props or returned from a callable function).
 * Use `toDateOrNull()` from utils.ts to normalize to a Date before formatting.
 */
export type FirestoreTimestampLike =
  | Timestamp
  | Date
  | string
  | { _seconds: number; _nanoseconds?: number }
  | { seconds: number; nanoseconds?: number }
  | null;

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
  teamADrive: number | null;  // 0 or 1 = which player's drive was used
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
   * When format is known, narrow with type guards (isSinglesInput, etc.)
   */
  input: HoleInputLoose;
};

// ============================================================================
// TYPE GUARDS - Narrow HoleInput based on format
// ============================================================================

/** Check if format is singles (use to narrow HoleInputLoose to SinglesHoleInput) */
export function isSinglesFormat(format: RoundFormat | null | undefined): boolean {
  return format === "singles";
}

/** Check if format is scramble (use to narrow HoleInputLoose to ScrambleHoleInput) */
export function isScrambleFormat(format: RoundFormat | null | undefined): boolean {
  return format === "twoManScramble" || format === "fourManScramble";
}

/** Check if format is best ball (use to narrow HoleInputLoose to BestBallHoleInput) */
export function isBestBallFormat(format: RoundFormat | null | undefined): boolean {
  return format === "twoManBestBall";
}

/** Check if format is shamble (use to narrow HoleInputLoose to ShambleHoleInput) */
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
// DOCUMENT TYPES
// ============================================================================

export type PlayerDoc = {
  id: string;
  displayName?: string;
  authUid?: string;       // Firebase Auth UID (set after account setup)
  email?: string;         // Email for login (set after account setup)
  isAdmin?: boolean;      // Admin access flag
  scoutingNotes?: string; // Subjective free-text take used by AI for draft/pairing help (not shown in stats)
  // Per-category push preferences (opt-out; absent => server defaults). Saved via
  // the setNotificationPrefs callable from the Notifications settings screen.
  notificationPrefs?: NotificationPrefs;
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
  test?: boolean; // If true, only admins can see this tournament (for testing/dev)
  archived?: boolean; // Hidden from default admin lists; never deleted (stats/history reference it)
  roundIds?: string[];
  tournamentLogo?: string;
  totalPointsAvailable?: number; // Total points available in tournament (for score tracker bar)
  teamA: { 
    id: string; 
    name: string;
    logo?: string;
    color?: string; 
    rosterByTier?: TierMap;
    handicapByPlayer?: Record<string, number>; // playerId -> handicap index (e.g., 7.4)
    captainId?: string;
    coCaptainId?: string;
  };
  teamB: { 
    id: string; 
    name: string;
    logo?: string;
    color?: string; 
    rosterByTier?: TierMap;
    handicapByPlayer?: Record<string, number>; // playerId -> handicap index (e.g., 9.5)
    captainId?: string;
    coCaptainId?: string;
  };
  // Temporary feature toggle: when true, clients may edit matches without being rostered/logged-in.
  openPublicEdits?: boolean;
  // Sportsbook feature toggle: when true, the peer-to-peer betting UI is enabled
  // for this tournament. Defaults off so the feature ships dark.
  sportsbookEnabled?: boolean;
  // Comments feature toggle: when true, match comment threads and the sportsbook
  // trash-talk feed are enabled for this tournament. Defaults off (ships dark).
  commentsEnabled?: boolean;
  // When a tournament ends tied after regulation (e.g. 12–12) and is decided by a
  // sudden-death/tiebreaker, the admin designates the winning team here. Absent
  // means the tournament was won in regulation, ended in an unbroken tie, or
  // isn't over yet. Drives the champions banner on the home and tournament views.
  tiebreakerWinner?: "teamA" | "teamB";
  // Pre-draft pool of available players, keyed by playerId -> current handicap
  // index (e.g. 7.4). Populated before the captains' draft, while players aren't
  // yet assigned to teamA/teamB. Drives the public Draft Pool dashboard; its
  // presence (non-empty) is what gates that page + the Home card / menu link.
  draftPool?: Record<string, number>;
  // When true, hide the Draft Pool from the UI (Home card + menu link) even
  // though `draftPool` data is still present. Set after the draft is complete
  // so the pool stops surfacing without deleting the underlying data.
  hideDraftPool?: boolean;
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

  // Denormalized point totals for this round, maintained server-side by the
  // computeRoundTotals trigger. Lets aggregate views (home/tournament/history)
  // read scores from the `rounds` collection instead of subscribing to every
  // match. May be absent on rounds last scored before this field existed; the
  // client falls back to a matches subscription in that case.
  pointTotals?: {
    teamAConfirmed: number;
    teamBConfirmed: number;
    teamAPending: number;
    teamBPending: number;
    matchCount: number;
    _sig?: string;
  };

  // SKINS: Optional skins game pots (only for singles/bestBall formats)
  skinsGrossPot?: number; // Total $ for gross skins; if > 0, gross skins active
  skinsNetPot?: number;   // Total $ for net skins; if > 0, net skins active
  skinsHandicapPercent?: number; // Percentage of course handicap to use for net skins (default: 100)
  
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
  rating?: number; // Course rating (e.g., 70.5)
  slope?: number; // Slope rating (e.g., 121)
  holes: HoleInfo[];
};

export type MatchDoc = {
  id: string;
  roundId: string;
  tournamentId?: string;
  matchNumber?: number; // For ordering matches on Round page (like day for rounds)
  teeTime?: FirestoreTimestampLike; // tee time for the match (stored as Pacific Time UTC-8)
  locked?: boolean; // Admin per-match lock (round.locked covers the whole round)
  completed?: boolean; // Auto-set when match closes and all 18 holes are scored
  holes?: Record<string, HoleData>;
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
  courseHandicaps?: number[]; // Course handicaps for all players in match order [teamA..., teamB...]
};

// ============================================================================
// PAIRINGS DRAFT - Live snake-draft state for a round (pairingDrafts/{roundId})
// ============================================================================

export type DraftTeamKey = "teamA" | "teamB";

/** One match being built during the draft. Player slots are null until placed. */
export type DraftMatch = {
  matchNumber: number;          // 1-based, equals draft order
  nominatedBy: DraftTeamKey;
  teamAPlayers: string[] | null; // playerIds
  teamBPlayers: string[] | null;
};

/** Whose move it is. Null once the draft reaches review (snake complete). */
export type DraftTurn = {
  matchIndex: number;
  awaiting: "nomination" | "response";
  team: DraftTeamKey;
};

export type PairingDraftDoc = {
  roundId: string;
  tournamentId: string;
  format: RoundFormat;
  playersPerSide: number;
  totalMatches: number;
  available: { teamA: string[]; teamB: string[] };
  firstPickTeam: DraftTeamKey;
  phase: "drafting" | "review" | "finalized";
  matches: DraftMatch[];
  turn: DraftTurn | null;
  tierByPlayer: Record<string, "A" | "B" | "C" | "D">;
  authorizedUids: string[];
  createdBy: string;
  finalizedMatchIds?: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
};

// Per-hole performance data for advanced queries
export type HolePerformance = {
  hole: number;                           // 1-18
  par: number;                            // from course data
  gross: number | null;                   // raw score (individual for singles/bestBall, team for scramble/shamble)
  net?: number | null;                    // gross - strokesReceived (singles/bestBall only)
  strokes?: 0 | 1;                        // strokesReceived for this hole (singles/bestBall only)
  partnerNet?: number | null;             // partner's net score (bestBall only)
  partnerGross?: number | null;           // partner's gross score (shamble only)
  driveUsed?: boolean;                    // true if this player's drive was used (scramble/shamble only)
  result?: 'win' | 'loss' | 'halve' | null; // hole result from player's perspective
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
  hamAndEggCount?: number;    // Best Ball/Shamble: holes where one player net par or better, other net double bogey or worse
  jekyllAndHyde?: boolean;    // Best Ball/Shamble: team's worst ball total - best ball total >= 24
  drivesUsed?: number;        // DRIVE_TRACKING: Scramble/Shamble: drives used by this player

  // Individual scoring stats (twoManBestBall, singles only)
  totalGross?: number;        // Sum of player's gross scores
  totalNet?: number;          // Sum of player's net scores (gross - strokes received)
  strokesVsParGross?: number; // totalGross - coursePar (e.g., +5, -2)
  strokesVsParNet?: number;   // totalNet - coursePar

  // Team scoring stats (twoManScramble, twoManShamble only)
  teamTotalGross?: number;        // Team's combined gross score
  teamStrokesVsParGross?: number; // teamTotalGross - coursePar

  // Per-hole performance array for advanced queries
  holePerformance?: HolePerformance[];

  // Counting stats added by Cloud Functions
  birdies?: number;            // number of birdies in this match (gross-based)
  eagles?: number;             // number of eagles (2+ under par) in this match (gross-based)

  // Team ball totals (twoManBestBall, twoManShamble only)
  bestBallTotal?: number;      // Sum of team's best ball (lowest net/gross) per hole
  worstBallTotal?: number;     // Sum of team's worst ball (highest net/gross) per hole
  worstBallStrokesVsPar?: number; // Worst ball total minus course par

  // Course context
  coursePar?: number;         // Course par for reference

  // Round context
  courseId?: string;
  day?: number;

  // Tournament context
  tournamentYear?: number;
  tournamentName?: string;
  tournamentSeries?: string;

  // Captain tracking
  isCaptain?: boolean;           // Player was captain for their team in this tournament
  isCoCaptain?: boolean;         // Player was co-captain for their team in this tournament
  captainVsCaptain?: boolean;    // Match had captains from both teams AND this player is one of them

  updatedAt?: FirestoreTimestampLike;
};

export type PlayerStatDoc = {
  id: string; // matches playerId
  wins: number;
  losses: number;
  halves: number;
  totalPoints: number;
  matchesPlayed: number;
  lastUpdated?: FirestoreTimestampLike;
};

// =============================================================================
// PLAYER STATS BY SERIES
// Aggregated stats per player per tournament series (rowdyCup, christmasClassic)
// =============================================================================

export type TournamentSeries = "rowdyCup" | "christmasClassic";

export type PlayerStatsBySeries = {
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
    fourManScramble?: { wins: number; losses: number; halves: number; matches: number };
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
  
  lastUpdated?: FirestoreTimestampLike;
};

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
  playerTeeTime?: FirestoreTimestampLike;
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
  lastUpdated?: FirestoreTimestampLike;
  _computeSig?: string; // Hash to detect changes
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

export interface ScoringLeader {
  playerId: string;
  playerName: string;
  strokesVsPar: number; // Display value (actual strokes vs par)
  holesCompleted: number; // Number of holes actually played
  strokesVsParPer18: number; // Normalized value for ranking: (strokesVsPar * 18) / holesCompleted
  totalGross?: number;
  totalNet?: number;
  teamKey?: string; // For team formats
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
    
    // Scoring leaders (strokes vs par)
    scoringGross?: ScoringLeader[];
    scoringNet?: ScoringLeader[];
    scoringTeamGross?: ScoringLeader[]; // Team gross for shamble/scramble
    scoringTeamNet?: ScoringLeader[]; // Team net for bestBall
    
    // Best/worst holes
    bestHole?: { holeNumber: number; avgStrokesUnderPar: number }; // Lowest avg vs par
    worstHole?: { holeNumber: number; avgStrokesOverPar: number }; // Highest avg vs par
  };
  
  computedAt?: FirestoreTimestampLike;
  computedBy?: string; // uid of admin who triggered
}

// ============================================================================
// SPORTSBOOK (PEER-TO-PEER BETTING)
// Friendly, no-real-money wagers between two players on a match outcome or the
// overall Cup winner. The `bets` collection is public-read / server-write only;
// all mutations go through the betsOps callables. Keep this block in sync with
// functions/src/types.ts.
// ============================================================================

/**
 * Which betting market a wager belongs to.
 *  - match:        who wins a single match (sides teamA/teamB)
 *  - round:        who wins a round/session's points (sides teamA/teamB)
 *  - cupFuture:    who wins the overall Cup (sides teamA/teamB)
 *  - overUnder:    a numeric prop vs a line (sides over/under); see BetOverUnderMetric
 *  - playerMatchup: which of two players scores more tournament points
 *                  (teamA backs subjectAId, teamB backs subjectBId)
 */
export type BetMarket = "match" | "round" | "cupFuture" | "overUnder" | "playerMatchup";

/** What an over/under bet is measured against. matchHolesPlayed = holes the match
 *  went before closing (status.thru); matchMargin = final margin of victory;
 *  playerTournamentPoints = a single player's total tournament points (subjectId),
 *  lines every half-point 0.5–3.5 (whole-point lines can push);
 *  playerTournamentWins = a single player's count of won matches (subjectId),
 *  half-point lines only (0.5/1.5/2.5/3.5) so it never pushes. */
export type BetOverUnderMetric =
  | "matchHolesPlayed"
  | "matchMargin"
  | "playerTournamentPoints"
  | "playerTournamentWins";

/** open marketplace offer (anyone may take) vs directed challenge (one target). */
export type BetKind = "offer" | "challenge";

/**
 * Bet lifecycle: open -> pending -> active -> settled, with
 * cancelled/declined/void as terminal off-ramps. A bet only pays out from the
 * `active` state; both parties must confirm to reach it.
 */
export type BetStatus =
  | "open"        // posted, no counterparty yet
  | "pending"     // counterparty took it; awaiting both confirmations
  | "active"      // both confirmed + locked; live until the result is known
  | "settled"     // resolved; result populated
  | "cancelled"   // proposer pulled it
  | "declined"    // target declined a challenge
  | "void";       // never locked before tee-off, or underlying match deleted

/**
 * The side a player backs. For team markets (match / round / cupFuture) it is a
 * team; for `overUnder` markets it is "over" / "under" the line. Proposer and
 * acceptor always hold opposite sides.
 */
export type BetSide = "teamA" | "teamB" | "over" | "under";

/** The team-only subset of BetSide, for builders/markets that never use over/under. */
export type BetTeamSide = "teamA" | "teamB";

/** Settlement outcome written when a bet is resolved. */
export type BetResult = {
  outcome: BetSide | "push";           // push = tie at the line / halved — no money moves
  winnerId?: string;                   // playerId owed the money (omitted on push)
  loserId?: string;                    // playerId who pays (omitted on push)
  payout: number;                      // === amount on a win, 0 on push
};

export type BetDoc = {
  id: string;
  tournamentId: string;
  market: BetMarket;
  matchId?: string;                    // present for match markets + match-scoped over/unders
  roundId?: string;                    // present when market === "round"
  metric?: BetOverUnderMetric;         // present when market === "overUnder"
  line?: number;                       // the over/under line (use half-lines to avoid pushes)
  subjectId?: string;                  // player O/U: the player whose tournament points are bet on
  subjectAId?: string;                 // playerMatchup: player backed by the teamA side
  subjectBId?: string;                 // playerMatchup: player backed by the teamB side
  kind: BetKind;
  status: BetStatus;
  amount: number;                      // even-money stake each side risks

  proposerId: string;                  // playerId who posted
  proposerSide: BetSide;
  targetId?: string;                   // directed challenge only: playerId who must accept

  acceptorId?: string;                 // filled when someone takes the offer
  acceptorSide?: BetSide;              // always the opposite of proposerSide

  // Two-phase mutual confirmation. Both must be true to transition pending -> active.
  proposerConfirmed: boolean;
  acceptorConfirmed: boolean;

  result?: BetResult;                  // populated on settlement

  // Denormalized union of the parties for "my bets" array-contains queries.
  participantIds: string[];

  createdAt?: FirestoreTimestampLike;
  acceptedAt?: FirestoreTimestampLike; // entered pending
  lockedAt?: FirestoreTimestampLike;   // both confirmed -> active
  settledAt?: FirestoreTimestampLike;
};

// ----------------------------------------------------------------------------
// SETTLE-UP ("mark as paid")
// A real-money transfer that clears part of a head-to-head tab. The debtor
// records the payment (pending); the creditor confirms receipt (confirmed).
// Confirmed settlements reduce the amounts-owed tab only — never the Money
// Leaders standings. betSettlements/{id}: public-read / server-write, like bets.
// Keep this block in sync with functions/src/types.ts.
// ----------------------------------------------------------------------------

export type SettlementStatus = "pending" | "confirmed" | "cancelled";

export type BetSettlementDoc = {
  id: string;
  tournamentId: string;
  payerId: string;     // player who paid (the debtor)
  payeeId: string;     // player who received (the creditor)
  amount: number;      // whole-dollar amount transferred
  status: SettlementStatus;
  initiatedBy: string; // playerId who created the record
  createdAt?: FirestoreTimestampLike;
  confirmedAt?: FirestoreTimestampLike;
};

// ============================================================================
// COMMENTS (match threads + sportsbook trash-talk feed)
// One generic collection serves both surfaces via a (threadType, threadId)
// discriminator. Public-read / server-write only; all mutations go through the
// commentOps callables. Keep this block in sync with functions/src/types.ts.
// ============================================================================

/** Which surface a comment thread belongs to. */
export type CommentThreadType = "match" | "sportsbook";

export type CommentDoc = {
  id: string;
  tournamentId: string;            // scoping + commentsEnabled gate
  threadType: CommentThreadType;   // "match" | "sportsbook"
  threadId: string;                // matchId for match threads; `sb_${tournamentId}` for the feed
  authorId: string;                // player doc id, e.g. "pShane"
  authorName: string;              // denormalized display name at post time
  text: string;
  reactions?: Record<string, string[]>; // emoji -> playerIds who reacted
  createdAt?: FirestoreTimestampLike;
  // Threading: top-level comments live in `comments` and carry `replyCount`;
  // replies live in `comments/{parentId}/replies` and carry `parentId` (one level
  // deep — you can't reply to a reply). Reactions are top-level only.
  replyCount?: number;             // denormalized # of replies (top-level comments)
  parentId?: string;               // set on reply docs; the comment they answer
};

// ============================================================================
// NOTIFICATIONS (in-app history for the bell + unread badges)
// players/{playerId}/notifications/{id}: owner-readable; written server-side by
// notify() whenever a push is sent. Keep in sync with functions/src/types.ts.
// ============================================================================

/**
 * Which feature a notification belongs to. Drives in-app badges and the
 * per-category delivery preference (PlayerDoc.notificationPrefs), enforced at
 * send time server-side. Keep in lockstep with functions/src/types.ts.
 */
export type NotificationCategory =
  | "chat"
  | "sportsbook"
  | "matchResult"
  | "matchLeadChange"
  | "tournament";

/** Per-player opt-out map: category -> whether the player wants that category. */
export type NotificationPrefs = Partial<Record<NotificationCategory, boolean>>;

export type NotificationDoc = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string;        // app-relative deep link, e.g. "/sportsbook" or "/match/abc"
  read: boolean;
  createdAt?: FirestoreTimestampLike;
  readAt?: FirestoreTimestampLike;
  expireAt?: FirestoreTimestampLike;  // TTL reap time (server-set); see functions notify()
  sourceId?: string;  // id of the entity that spawned this (e.g. a comment); removed when it's deleted
};
