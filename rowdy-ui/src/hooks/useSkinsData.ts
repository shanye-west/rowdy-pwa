import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, doc } from "firebase/firestore";
import { db } from "../firebase";
import type { RoundDoc, MatchDoc, CourseDoc, PlayerDoc, TournamentDoc, HoleInfo } from "../types";
import { ensureTournamentTeamColors } from "../utils/teamColors";
import { calculateSkinsStrokes } from "../utils/ghin";

export type SkinType = "gross" | "net";

export interface PlayerHoleScore {
  playerId: string;
  playerName: string;
  gross: number | null;
  net: number | null;
  hasStroke: boolean;
  playerThru: number; // Number of holes completed by this player
  playerTeeTime?: any; // Firestore Timestamp or Date when available
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
  allScores: PlayerHoleScore[]; // All player scores for this hole, sorted low→high
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

export function useSkinsData(roundId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});

  // Subscribe to round
  useEffect(() => {
    if (!roundId) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, "rounds", roundId),
      (snap) => {
        if (snap.exists()) {
          setRound({ id: snap.id, ...snap.data() } as RoundDoc);
        } else {
          setRound(null);
          setError("Round not found");
        }
      },
      (err) => {
        console.error("Error loading round:", err);
        setError("Failed to load round");
      }
    );

    return () => unsub();
  }, [roundId]);

  // Subscribe to tournament
  useEffect(() => {
    if (!round?.tournamentId) return;

    const unsub = onSnapshot(
      doc(db, "tournaments", round.tournamentId),
      (snap) => {
        if (snap.exists()) {
          setTournament(ensureTournamentTeamColors({ id: snap.id, ...snap.data() } as TournamentDoc));
        }
      }
    );

    return () => unsub();
  }, [round?.tournamentId]);

  // Subscribe to course
  useEffect(() => {
    if (!round?.courseId) return;

    const unsub = onSnapshot(
      doc(db, "courses", round.courseId),
      (snap) => {
        if (snap.exists()) {
          setCourse({ id: snap.id, ...snap.data() } as CourseDoc);
        }
      }
    );

    return () => unsub();
  }, [round?.courseId]);

  // Subscribe to matches for this round
  useEffect(() => {
    if (!roundId) return;

    const unsub = onSnapshot(
      query(collection(db, "matches"), where("roundId", "==", roundId)),
      (snap) => {
        const ms = snap.docs.map(d => ({ id: d.id, ...d.data() } as MatchDoc));
        setMatches(ms);
      },
      (err) => {
        console.error("Error loading matches:", err);
        setError("Failed to load matches");
      }
    );

    return () => unsub();
  }, [roundId]);

  // Subscribe to all players (simplified: subscribe to entire collection)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "players"),
      (snap) => {
        const pMap: Record<string, PlayerDoc> = {};
        snap.docs.forEach(d => {
          pMap[d.id] = { id: d.id, ...d.data() } as PlayerDoc;
        });
        setPlayers(pMap);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // Check if skins are enabled and format is valid
  const skinsEnabled = useMemo(() => {
    const hasGross = (round?.skinsGrossPot ?? 0) > 0;
    const hasNet = (round?.skinsNetPot ?? 0) > 0;
    const validFormat = round?.format === "singles" || round?.format === "twoManBestBall";
    return validFormat && (hasGross || hasNet);
  }, [round]);

  // Compute hole-by-hole skins data
  const holeSkinsData = useMemo((): HoleSkinData[] => {
    if (!skinsEnabled || !course?.holes) return [];

    const format = round!.format;
    const handicapPercent = round?.skinsHandicapPercent ?? 100;
    const slopeRating = course.slope ?? 113;
    const courseRating = course.rating ?? (course.par ?? 72);
    const coursePar = course.par ?? 72;

    // Cache skins strokes per player (per team) so we don't recompute for every hole
    const skinsStrokesCache = new Map<string, number[]>();

    const getSkinsStrokesForPlayer = (playerId: string, teamKey: "teamA" | "teamB"): number[] => {
      const cacheKey = `${teamKey}:${playerId}`;
      const existing = skinsStrokesCache.get(cacheKey);
      if (existing) return existing;

      const teamData = teamKey === "teamA" ? tournament?.teamA : tournament?.teamB;
      const handicapIndex = teamData?.handicapByPlayer?.[playerId] ?? 0;

      const strokes = calculateSkinsStrokes(
        handicapIndex,
        handicapPercent,
        slopeRating,
        courseRating,
        coursePar,
        course.holes as HoleInfo[]
      );

      skinsStrokesCache.set(cacheKey, strokes);
      return strokes;
    };
    const holes: HoleSkinData[] = [];

    for (let holeNum = 1; holeNum <= 18; holeNum++) {
      const holeKey = String(holeNum);
      const holeInfo = course.holes.find(h => h.number === holeNum);
      const par = holeInfo?.par ?? 4;

      // Collect all player scores for this hole across all matches
      const allScores: PlayerHoleScore[] = [];

      matches.forEach(match => {
        const holeData = match.holes?.[holeKey];
        if (!holeData) return;

        const input = holeData.input;

        if (format === "singles") {
          // Singles: one player per team
          const teamAPlayer = match.teamAPlayers?.[0];
          const teamBPlayer = match.teamBPlayers?.[0];

          if (teamAPlayer) {
            const gross = input.teamAPlayerGross ?? null;
            const skinsStrokes = getSkinsStrokesForPlayer(teamAPlayer.playerId, "teamA");
            const strokesReceived = skinsStrokes[holeNum - 1];
            
            const net = gross !== null ? gross - strokesReceived : null;
            const playerThru = match.status?.thru ?? 0;
            allScores.push({
              playerId: teamAPlayer.playerId,
              playerName: players[teamAPlayer.playerId]?.displayName || teamAPlayer.playerId,
              gross,
              net,
              hasStroke: strokesReceived > 0,
              playerThru,
              playerTeeTime: match.teeTime ?? null,
            });
          }

          if (teamBPlayer) {
            const gross = input.teamBPlayerGross ?? null;
            const skinsStrokes = getSkinsStrokesForPlayer(teamBPlayer.playerId, "teamB");
            const strokesReceived = skinsStrokes[holeNum - 1];
            
            const net = gross !== null ? gross - strokesReceived : null;
            const playerThru = match.status?.thru ?? 0;
            allScores.push({
              playerId: teamBPlayer.playerId,
              playerName: players[teamBPlayer.playerId]?.displayName || teamBPlayer.playerId,
              gross,
              net,
              hasStroke: strokesReceived > 0,
              playerThru,
              playerTeeTime: match.teeTime ?? null,
            });
          }
        } else if (format === "twoManBestBall") {
          // Best Ball: two players per team
          [match.teamAPlayers, match.teamBPlayers].forEach((team) => {
            const isTeamA = team === match.teamAPlayers;
            team?.forEach((player, playerIdx) => {
              const grossArray = isTeamA 
                ? input.teamAPlayersGross 
                : input.teamBPlayersGross;
              
              const gross = grossArray?.[playerIdx] ?? null;
              const teamKey: "teamA" | "teamB" = isTeamA ? "teamA" : "teamB";
              const skinsStrokes = getSkinsStrokesForPlayer(player.playerId, teamKey);
              const strokesReceived = skinsStrokes[holeNum - 1];
              
              const net = gross !== null ? gross - strokesReceived : null;
              const playerThru = match.status?.thru ?? 0;
              
              allScores.push({
                playerId: player.playerId,
                playerName: players[player.playerId]?.displayName || player.playerId,
                gross,
                net,
                hasStroke: strokesReceived > 0,
                playerThru,
                playerTeeTime: match.teeTime ?? null,
              });
            });
          });
        }
      });

      // Determine gross winner
      const grossScores = allScores.filter(s => s.gross !== null);
      const grossLowScore = grossScores.length > 0 ? Math.min(...grossScores.map(s => s.gross!)) : null;
      const grossWinners = grossScores.filter(s => s.gross === grossLowScore);
      const grossWinner = grossWinners.length === 1 ? grossWinners[0].playerId : null;
      const grossTiedCount = grossWinners.length;

      // Determine net winner
      const netScores = allScores.filter(s => s.net !== null);
      const netLowScore = netScores.length > 0 ? Math.min(...netScores.map(s => s.net!)) : null;
      const netWinners = netScores.filter(s => s.net === netLowScore);
      const netWinner = netWinners.length === 1 ? netWinners[0].playerId : null;
      const netTiedCount = netWinners.length;

      // Sort all scores: lowest first, null scores at end
      allScores.sort((a, b) => {
        if (a.gross === null) return 1;
        if (b.gross === null) return -1;
        return a.gross - b.gross;
      });

      // Check if all players have completed this hole
      const allPlayersCompleted = allScores.every(s => s.gross !== null);

      holes.push({
        holeNumber: holeNum,
        par,
        grossWinner,
        netWinner,
        grossLowScore,
        netLowScore,
        grossTiedCount,
        netTiedCount,
        allScores,
        allPlayersCompleted,
      });
    }

    return holes;
  }, [skinsEnabled, round, course, matches, players]);

  // Compute player totals (leaderboard)
  const playerTotals = useMemo((): PlayerSkinsTotal[] => {
    if (!skinsEnabled) return [];

    const totalsMap = new Map<string, PlayerSkinsTotal>();

    // Initialize all players
    matches.forEach(match => {
      [...(match.teamAPlayers || []), ...(match.teamBPlayers || [])].forEach(p => {
        if (!totalsMap.has(p.playerId)) {
          totalsMap.set(p.playerId, {
            playerId: p.playerId,
            playerName: players[p.playerId]?.displayName || p.playerId,
            grossSkinsWon: 0,
            netSkinsWon: 0,
            grossHoles: [],
            netHoles: [],
            grossEarnings: 0,
            netEarnings: 0,
            totalEarnings: 0,
          });
        }
      });
    });

    // Count skins won per player
    holeSkinsData.forEach(hole => {
      if (hole.grossWinner) {
        const player = totalsMap.get(hole.grossWinner);
        if (player) {
          player.grossSkinsWon++;
          player.grossHoles.push(hole.holeNumber);
        }
      }
      if (hole.netWinner) {
        const player = totalsMap.get(hole.netWinner);
        if (player) {
          player.netSkinsWon++;
          player.netHoles.push(hole.holeNumber);
        }
      }
    });

    // Calculate earnings
    const grossPot = round?.skinsGrossPot ?? 0;
    const netPot = round?.skinsNetPot ?? 0;
    const totalGrossSkins = holeSkinsData.filter(h => h.grossWinner !== null).length;
    const totalNetSkins = holeSkinsData.filter(h => h.netWinner !== null).length;
    const grossValuePerSkin = totalGrossSkins > 0 ? grossPot / totalGrossSkins : 0;
    const netValuePerSkin = totalNetSkins > 0 ? netPot / totalNetSkins : 0;

    totalsMap.forEach(player => {
      player.grossEarnings = player.grossSkinsWon * grossValuePerSkin;
      player.netEarnings = player.netSkinsWon * netValuePerSkin;
      player.totalEarnings = player.grossEarnings + player.netEarnings;
    });

    // Return as sorted array (highest total earnings first)
    return Array.from(totalsMap.values())
      .filter(p => p.grossSkinsWon > 0 || p.netSkinsWon > 0)
      .sort((a, b) => b.totalEarnings - a.totalEarnings);
  }, [skinsEnabled, round, holeSkinsData, matches, players]);

  return {
    loading,
    error,
    round,
    tournament,
    course,
    matches,
    players,
    skinsEnabled,
    holeSkinsData,
    playerTotals,
  };
}
