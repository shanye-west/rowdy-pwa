/**
 * Shared types for Cloud Functions
 */

export type RoundFormat = "twoManBestBall" | "twoManShamble" | "twoManScramble" | "singles";

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

export interface HoleInput {
  // Scramble format
  teamAGross?: number | null;
  teamBGross?: number | null;
  teamADrive?: number | null;
  teamBDrive?: number | null;
  // Singles format
  teamAPlayerGross?: number | null;
  teamBPlayerGross?: number | null;
  // Best Ball & Shamble format
  teamAPlayersGross?: (number | null)[];
  teamBPlayersGross?: (number | null)[];
}

export interface MatchData {
  tournamentId?: string;
  roundId?: string;
  teamAPlayers?: PlayerInMatch[];
  teamBPlayers?: PlayerInMatch[];
  holes?: Record<string, { input: HoleInput }>;
  status?: MatchStatus;
  result?: MatchResult;
}
