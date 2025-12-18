import { useEffect, useState } from "react";
import { doc, onSnapshot, getDoc, getDocs, collection, where, query, documentId } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, PlayerDoc, MatchDoc, RoundDoc, CourseDoc, PlayerMatchFact } from "../types";
import { ensureTournamentTeamColors } from "../utils/teamColors";

export type PlayerLookup = Record<string, PlayerDoc>;

export interface UseMatchDataResult {
  match: MatchDoc | null;
  round: RoundDoc | null;
  course: CourseDoc | null;
  tournament: TournamentDoc | null;
  players: PlayerLookup;
  matchFacts: PlayerMatchFact[];
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook for fetching all match-related data with real-time updates.
 * 
 * Sets up listeners for:
 * 1. Match document (real-time)
 * 2. Round document (real-time, depends on match.roundId)
 * 3. Tournament document (one-time fetch when round loads)
 * 4. Course document (one-time fetch when round loads)
 * 5. Player documents (batch fetch when match loads)
 * 6. PlayerMatchFacts (fetch when match closes)
 */
export function useMatchData(matchId: string | undefined): UseMatchDataResult {
  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [players, setPlayers] = useState<PlayerLookup>({});
  const [matchFacts, setMatchFacts] = useState<PlayerMatchFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Listen to MATCH and fetch players
  useEffect(() => {
    if (!matchId) return;
    setLoading(true);
    setError(null);

    const unsub = onSnapshot(
      doc(db, "matches", matchId),
      (mSnap) => {
        if (!mSnap.exists()) { 
          setMatch(null); 
          setLoading(false); 
          return; 
        }
        
        const mData = { id: mSnap.id, ...(mSnap.data() as any) } as MatchDoc;
        setMatch(mData);

        // Extract unique player IDs from both teams
        const ids = Array.from(new Set([
          ...(mData.teamAPlayers || []).map((p) => p.playerId).filter(Boolean),
          ...(mData.teamBPlayers || []).map((p) => p.playerId).filter(Boolean),
        ]));
        
        if (ids.length === 0) {
          setLoading(false);
          return;
        }

        // Batch fetch players (Firestore 'in' query limited to 10 items)
        const fetchPlayers = async () => {
          const batches = [];
          for (let i = 0; i < ids.length; i += 10) {
            batches.push(ids.slice(i, i + 10));
          }
          
          const newPlayers: PlayerLookup = {};
          for (const batch of batches) {
            const q = query(collection(db, "players"), where(documentId(), "in", batch));
            const snap = await getDocs(q);
            snap.forEach(d => { 
              newPlayers[d.id] = { id: d.id, ...d.data() } as PlayerDoc; 
            });
          }
          setPlayers(prev => ({ ...prev, ...newPlayers }));
        };

        fetchPlayers()
          .catch((err) => setError(`Failed to load players: ${err.message}`))
          .finally(() => setLoading(false));
      },
      (err) => {
        setError(`Failed to load match: ${err.message}`);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [matchId]);

  // 2. Listen to ROUND and fetch Tournament/Course in parallel
  useEffect(() => {
    if (!match?.roundId) return;
    
    const unsub = onSnapshot(
      doc(db, "rounds", match.roundId),
      async (rSnap) => {
        if (!rSnap.exists()) return;
        
        const rData = { id: rSnap.id, ...(rSnap.data() as any) } as RoundDoc;
        setRound(rData);
        
        try {
          // Fetch tournament and course in parallel to avoid N+1 pattern
          const promises: Promise<any>[] = [];
          
          if (rData.tournamentId) {
            promises.push(
              getDoc(doc(db, "tournaments", rData.tournamentId)).then(tSnap => {
                if (tSnap.exists()) {
                  setTournament(ensureTournamentTeamColors({ id: tSnap.id, ...(tSnap.data() as any) } as TournamentDoc));
                }
              })
            );
          }
          
          if (rData.courseId) {
            promises.push(
              getDoc(doc(db, "courses", rData.courseId)).then(cSnap => {
                if (cSnap.exists()) {
                  setCourse({ id: cSnap.id, ...(cSnap.data() as any) } as CourseDoc);
                }
              })
            );
          }
          
          // Also fetch match facts in parallel if match is closed
          if (match?.status?.closed) {
            promises.push(
              getDocs(query(collection(db, "playerMatchFacts"), where("matchId", "==", match.id))).then(snap => {
                const facts = snap.docs.map(d => ({ ...d.data(), id: d.id } as unknown as PlayerMatchFact));
                setMatchFacts(facts);
              })
            );
          }
          
          await Promise.all(promises);
        } catch (err: any) {
          setError(`Failed to load round details: ${err.message}`);
        }
      },
      (err) => {
        setError(`Failed to load round: ${err.message}`);
      }
    );
    
    return () => unsub();
  }, [match?.roundId, match?.status?.closed]);

  // 3. Match facts now fetched in parallel with tournament/course above
  // This effect clears facts when match is not closed
  useEffect(() => {
    if (!match?.status?.closed) {
      setMatchFacts([]);
    }
  }, [match?.status?.closed]);

  return {
    match,
    round,
    course,
    tournament,
    players,
    matchFacts,
    loading,
    error,
  };
}

export default useMatchData;
