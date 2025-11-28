import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, query, where, onSnapshot, limit } from "firebase/firestore";
import { db } from "./firebase";
import type { TournamentDoc, RoundDoc, MatchDoc, CourseDoc } from "./types";
import Layout from "./components/Layout";
import LastUpdated from "./components/LastUpdated";
import ScoreBlock from "./components/ScoreBlock";
import { formatRoundType } from "./utils";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [rounds, setRounds] = useState<RoundDoc[]>([]);
  const [matchesByRound, setMatchesByRound] = useState<Record<string, MatchDoc[]>>({});
  const [courses, setCourses] = useState<Record<string, CourseDoc>>({});

  // Track which data has loaded for coordinated loading state
  const [tournamentLoaded, setTournamentLoaded] = useState(false);
  const [roundsLoaded, setRoundsLoaded] = useState(false);
  const [matchesLoaded, setMatchesLoaded] = useState(false);

  // 1) Subscribe to active tournament
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "tournaments"), where("active", "==", true), limit(1)),
      (snap) => {
        if (snap.empty) {
          setTournament(null);
        } else {
          const doc = snap.docs[0];
          setTournament({ id: doc.id, ...doc.data() } as TournamentDoc);
        }
        setTournamentLoaded(true);
      },
      (err) => {
        console.error("Tournament subscription error:", err);
        setTournamentLoaded(true);
      }
    );
    return () => unsub();
  }, []);

  // 2) Subscribe to rounds when tournament is available
  useEffect(() => {
    if (!tournament?.id) {
      setRounds([]);
      setRoundsLoaded(tournamentLoaded);
      return;
    }

    const unsub = onSnapshot(
      query(collection(db, "rounds"), where("tournamentId", "==", tournament.id)),
      (snap) => {
        let rds = snap.docs.map(d => ({ id: d.id, ...d.data() } as RoundDoc));
        rds = rds.sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.id.localeCompare(b.id));
        setRounds(rds);
        setRoundsLoaded(true);
      },
      (err) => {
        console.error("Rounds subscription error:", err);
        setRoundsLoaded(true);
      }
    );
    return () => unsub();
  }, [tournament?.id, tournamentLoaded]);

  // 3) Subscribe to ALL matches for this tournament (single query, grouped in memory)
  useEffect(() => {
    if (!tournament?.id) {
      setMatchesByRound({});
      setMatchesLoaded(tournamentLoaded);
      return;
    }

    const unsub = onSnapshot(
      query(collection(db, "matches"), where("tournamentId", "==", tournament.id)),
      (snap) => {
        const bucket: Record<string, MatchDoc[]> = {};
        snap.docs.forEach(d => {
          const match = { id: d.id, ...d.data() } as MatchDoc;
          if (match.roundId) {
            if (!bucket[match.roundId]) bucket[match.roundId] = [];
            bucket[match.roundId].push(match);
          }
        });
        setMatchesByRound(bucket);
        setMatchesLoaded(true);
      },
      (err) => {
        console.error("Matches subscription error:", err);
        setMatchesLoaded(true);
      }
    );
    return () => unsub();
  }, [tournament?.id, tournamentLoaded]);

  // 4) Subscribe to courses (all courses - small collection, cached well)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "courses"),
      (snap) => {
        const lookup: Record<string, CourseDoc> = {};
        snap.docs.forEach(d => {
          lookup[d.id] = { id: d.id, ...d.data() } as CourseDoc;
        });
        setCourses(lookup);
      },
      (err) => console.error("Courses subscription error:", err)
    );
    return () => unsub();
  }, []);

  // Compute loading state - done when tournament loaded AND (no tournament OR rounds+matches loaded)
  useEffect(() => {
    if (tournamentLoaded && (!tournament || (roundsLoaded && matchesLoaded))) {
      setLoading(false);
    }
  }, [tournamentLoaded, tournament, roundsLoaded, matchesLoaded]);

  // Build coursesByRound lookup from rounds + courses
  const coursesByRound = useMemo(() => {
    const result: Record<string, CourseDoc | null> = {};
    rounds.forEach(r => {
      result[r.id] = r.courseId ? (courses[r.courseId] || null) : null;
    });
    return result;
  }, [rounds, courses]);

  // --- Stats Calculation ---
  const { stats, roundStats } = useMemo(() => {
    let fA = 0, fB = 0, pA = 0, pB = 0;
    const rStats: Record<string, { fA: number; fB: number; pA: number; pB: number }> = {};

    // Create a lookup for round pointsValue
    const roundPvLookup: Record<string, number> = {};
    rounds.forEach(r => { 
      rStats[r.id] = { fA: 0, fB: 0, pA: 0, pB: 0 }; 
      roundPvLookup[r.id] = r.pointsValue ?? 1;
    });

    const allMatches = Object.values(matchesByRound).flat();

    for (const m of allMatches) {
      const pv = m.roundId ? (roundPvLookup[m.roundId] ?? 1) : 1;
      const w = m.result?.winner;
      
      const ptsA = w === "teamA" ? pv : w === "AS" ? pv / 2 : 0;
      const ptsB = w === "teamB" ? pv : w === "AS" ? pv / 2 : 0;

      const isClosed = m.status?.closed === true;
      const isStarted = (m.status?.thru ?? 0) > 0;

      if (isClosed) { fA += ptsA; fB += ptsB; }
      else if (isStarted) { pA += ptsA; pB += ptsB; }

      if (m.roundId && rStats[m.roundId]) {
        if (isClosed) {
          rStats[m.roundId].fA += ptsA;
          rStats[m.roundId].fB += ptsB;
        } else if (isStarted) {
          rStats[m.roundId].pA += ptsA;
          rStats[m.roundId].pB += ptsB;
        }
      }
    }
    return { stats: { fA, fB, pA, pB }, roundStats: rStats };
  }, [matchesByRound, rounds]);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="spinner-lg"></div>
    </div>
  );

  const tName = tournament?.name || "Rowdy Cup";
  const tSeries = tournament?.series; // "rowdyCup" or "christmasClassic"
  const tLogo = tournament?.tournamentLogo;

  return (
    <Layout title={tName} series={tSeries} tournamentLogo={tLogo}>
      {!tournament ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏌️</div>
          <div className="empty-state-text">No active tournament found.</div>
        </div>
      ) : (
        <div style={{ padding: 16, display: "grid", gap: 24 }}>
          
          {/* HERO SCOREBOARD */}
          <section className="card" style={{ textAlign: 'center', padding: 24 }}>
            <h2 style={{ 
              margin: "0 0 16px 0", 
              fontSize: "0.85rem", 
              color: "var(--text-secondary)", 
              textTransform: "uppercase", 
              letterSpacing: "0.1em" 
            }}>
              Total Score
            </h2>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center" }}>
              {/* Team A */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {tournament.teamA?.logo && (
                  <Link to="/teams?team=A">
                    <img 
                      src={tournament.teamA.logo} 
                      alt={tournament.teamA?.name || "Team A"}
                      style={{ width: 48, height: 48, objectFit: "contain", marginBottom: 8, cursor: "pointer" }}
                    />
                  </Link>
                )}
                <div style={{ 
                  fontWeight: 800, 
                  color: tournament.teamA?.color || "var(--team-a-default)", 
                  fontSize: "1.1rem", 
                  marginBottom: 4 
                }}>
                  {tournament.teamA?.name || "Team A"}
                </div>
                <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1, position: 'relative', display: 'inline-block' }}>
                  <span style={{ color: tournament.teamA?.color || "var(--team-a-default)" }}>{stats.fA}</span>
                  {stats.pA > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        left: '100%',
                        bottom: '15%',
                        fontSize: "0.35em",
                        color: "#aaa",
                        marginLeft: 3,
                        fontWeight: 400,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      (+{stats.pA})
                    </span>
                  )}
                </div>
              </div>

              {/* Divider Line */}
              <div style={{ height: 40, width: 1, background: "var(--divider)" }}></div>

              {/* Team B */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {tournament.teamB?.logo && (
                  <Link to="/teams?team=B">
                    <img 
                      src={tournament.teamB.logo} 
                      alt={tournament.teamB?.name || "Team B"}
                      style={{ width: 48, height: 48, objectFit: "contain", marginBottom: 8, cursor: "pointer" }}
                    />
                  </Link>
                )}
                <div style={{ 
                  fontWeight: 800, 
                  color: tournament.teamB?.color || "var(--team-b-default)", 
                  fontSize: "1.1rem", 
                  marginBottom: 4 
                }}>
                  {tournament.teamB?.name || "Team B"}
                </div>
                <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1, position: 'relative', display: 'inline-block' }}>
                  {stats.pB > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        right: '100%',
                        bottom: '15%',
                        fontSize: "0.35em",
                        color: "#aaa",
                        marginRight: 3,
                        fontWeight: 400,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      (+{stats.pB})
                    </span>
                  )}
                  <span style={{ color: tournament.teamB?.color || "var(--team-b-default)" }}>{stats.fB}</span>
                </div>
              </div>
            </div>
          </section>

          {/* ROUNDS LIST */}
          <section style={{ display: "grid", gap: 12 }}>
            <h3 style={{ 
              margin: "0 0 8px 0", 
              fontSize: "0.9rem", 
              textTransform: "uppercase", 
              color: "var(--text-secondary)",
              letterSpacing: "0.05em",
              paddingLeft: 4
            }}>
              Schedule
            </h3>
            
            {rounds.map((r, idx) => {
              const rs = roundStats[r.id];
              const course = coursesByRound[r.id];
              // Get course name only (no tees) for round tiles
              const courseName = course?.name || r.course?.name;
              
              return (
                <Link 
                  key={r.id} 
                  to={`/round/${r.id}`} 
                  className="card card-hover"
                  style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12 }}
                >
                  {/* Team A - Left */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {tournament.teamA?.logo && (
                      <img 
                        src={tournament.teamA.logo} 
                        alt={tournament.teamA?.name || "Team A"}
                        style={{ width: 28, height: 28, objectFit: "contain" }}
                      />
                    )}
                    <span style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
                      <ScoreBlock
                        final={rs.fA}
                        proj={rs.pA}
                        color={tournament.teamA?.color}
                      />
                    </span>
                  </div>

                  {/* Round Info - Center */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 2 }}>Round {idx + 1}</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{formatRoundType(r.format)}</div>
                    {courseName && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 2 }}>{courseName}</div>
                    )}
                  </div>

                  {/* Team B - Right */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>  
                    <span style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
                      <ScoreBlock
                        final={rs.fB}
                        proj={rs.pB}
                        color={tournament.teamB?.color}
                        projLeft
                      />
                    </span>
                    {tournament.teamB?.logo && (
                      <img 
                        src={tournament.teamB.logo} 
                        alt={tournament.teamB?.name || "Team B"}
                        style={{ width: 28, height: 28, objectFit: "contain" }}
                      />
                    )}
                  </div>
                </Link>
              );
            })}
          </section>

          <LastUpdated />
        </div>
      )}
    </Layout>
  );
}