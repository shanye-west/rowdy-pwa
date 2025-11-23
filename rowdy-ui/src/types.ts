export type RoundFormat = "twoManBestBall" | "twoManShamble" | "twoManScramble" | "singles";

export type PlayerDoc = { 
  id: string; 
  displayName?: string; 
  username?: string; 
};

export type TournamentDoc = {
  id: string;
  name: string;
  teamA: { id: string; name: string; color?: string };
  teamB: { id: string; name: string; color?: string };
};

export type RoundDoc = {
  id: string;
  tournamentId: string;
  day?: number;
  format: RoundFormat;
};

export type MatchDoc = {
  id: string;
  roundId: string;
  tournamentId?: string;
  pointsValue?: number;
  
  // Scoring Data
  holes?: Record<string, { input: any }>; // Keeping 'any' for input flexibility or define strict shape if desired
  
  // Calculated Results
  result?: { 
    winner?: "teamA" | "teamB" | "AS";
    holesWonA?: number;
    holesWonB?: number;
  };
  
  // Live Status
  status?: {
    leader: "teamA" | "teamB" | null;
    margin: number;
    thru: number;
    dormie: boolean;
    closed: boolean;
  };

  // Roster & Strokes
  teamAPlayers?: { playerId: string; strokesReceived: number[] }[];
  teamBPlayers?: { playerId: string; strokesReceived: number[] }[];
};