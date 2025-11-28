import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where, documentId } from "firebase/firestore";
import { db } from "../firebase";
import type { RoundDoc, TournamentDoc, MatchDoc, PlayerDoc, CourseDoc } from "../types";
import { formatMatchStatus, formatRoundType } from "../utils";
import { getPlayerShortName as getPlayerShortNameFromLookup } from "../utils/playerHelpers";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";

export default function Round() {
  const { roundId } = useParams();
  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roundId) {
      setLoading(false);
      setError("Round ID is missing.");
      return;
    }

    const fetchRound = async () => {
      setLoading(true);
      setError(null);

      try {
        // 1. Get Round first (needed to fetch related data)
        const rSnap = await getDoc(doc(db, "rounds", roundId));
        if (!rSnap.exists()) {
          setError("Round not found.");
          setRound(null);
          return;
        }
        const rData = { id: rSnap.id, ...rSnap.data() } as RoundDoc;
        setRound(rData);

        // 2. Fetch tournament, matches, and course in parallel
        const matchesQuery = query(collection(db, "matches"), where("roundId", "==", roundId));
        
        const [tournamentResult, matchesResult, courseResult] = await Promise.all([
          // Tournament (for theme & colors)
          rData.tournamentId 
            ? getDoc(doc(db, "tournaments", rData.tournamentId))
            : Promise.resolve(null),
          // Matches
          getDocs(matchesQuery),
          // Course
          rData.courseId
            ? getDoc(doc(db, "courses", rData.courseId))
            : Promise.resolve(null),
        ]);

        // Process tournament
        if (tournamentResult?.exists()) {
          setTournament({ id: tournamentResult.id, ...tournamentResult.data() } as TournamentDoc);
        }

        // Process matches
        const ms = matchesResult.docs
          .map((d) => ({ id: d.id, ...d.data() } as MatchDoc))
          .sort((a, b) => a.id.localeCompare(b.id));
        setMatches(ms);

        // Process course
        if (courseResult?.exists()) {
          setCourse({ id: courseResult.id, ...courseResult.data() } as CourseDoc);
        }

        // 3. Bulk fetch players (depends on matches result)
        const playerIds = new Set<string>();
        ms.forEach(m => {
          m.teamAPlayers?.forEach(p => p.playerId && playerIds.add(p.playerId));
          m.teamBPlayers?.forEach(p => p.playerId && playerIds.add(p.playerId));
        });

        if (playerIds.size > 0) {
          const pIds = Array.from(playerIds);
          // Firestore 'in' limit is 10, so chunk and fetch all chunks in parallel
          const chunks: string[][] = [];
          for (let i = 0; i < pIds.length; i += 10) {
            chunks.push(pIds.slice(i, i + 10));
          }

          const playerMap: Record<string, PlayerDoc> = {};
          const chunkResults = await Promise.all(
            chunks.map(chunk => 
              getDocs(query(collection(db, "players"), where(documentId(), "in", chunk)))
            )
          );
          
          chunkResults.forEach(pSnap => {
            pSnap.forEach(doc => { 
              playerMap[doc.id] = { id: doc.id, ...doc.data() } as PlayerDoc; 
            });
          });
          setPlayers(playerMap);
        }

      } catch (err) {
        console.error("Error loading round data", err);
        setError("Unable to load round data. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchRound();
  }, [roundId]);

  const stats = useMemo(() => {
    let fA = 0, fB = 0, pA = 0, pB = 0;
    const pv = round?.pointsValue ?? 1;
    for (const m of matches) {
      const w = m.result?.winner;
      const ptsA = w === "teamA" ? pv : w === "AS" ? pv / 2 : 0;
      const ptsB = w === "teamB" ? pv : w === "AS" ? pv / 2 : 0;
      const isClosed = m.status?.closed === true;
      const isStarted = (m.status?.thru ?? 0) > 0;

      if (isClosed) { fA += ptsA; fB += ptsB; } 
      else if (isStarted) { pA += ptsA; pB += ptsB; }
    }
    return { fA, fB, pA, pB };
  }, [matches, round]);

  // Use shared player helper - this returns short name format (F. LastName)
  const getPlayerShortName = (pid: string) => getPlayerShortNameFromLookup(pid, players);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="spinner-lg"></div>
    </div>
  );
  if (error) return (
    <div className="p-5 text-center text-red-600">
      <div className="text-2xl mb-2">⚠️</div>
      <div>{error}</div>
    </div>
  );
  if (!round) return (
    <div className="empty-state">
      <div className="empty-state-icon">🔍</div>
      <div className="empty-state-text">Round not found.</div>
    </div>
  );

  const tName = tournament?.name || "Round Detail";
  const tSeries = tournament?.series;
  const tLogo = tournament?.tournamentLogo;

  return (
    <Layout title={tName} series={tSeries} showBack tournamentLogo={tLogo}>
      <div style={{ padding: 16, display: "grid", gap: 20 }}>
        
        {/* ROUND HEADER / SCOREBOARD */}
        <section className="card" style={{ padding: 20, textAlign: 'center' }}>
          <h1 style={{ margin: "0 0 4px 0", fontSize: "1.4rem" }}>
            Round {round.day ?? ""}
          </h1>
          <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: 4 }}>
            {formatRoundType(round.format)}
          </div>
          {(course?.name || round.course?.name) && (
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 12 }}>
              {course?.name || round.course?.name}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1px 1fr", gap: 12, alignItems: "center", borderTop: "1px solid var(--divider)", paddingTop: 16 }}>
             {/* Team A */}
             <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {tournament?.teamA?.logo && (
                  <img 
                    src={tournament.teamA.logo} 
                    alt={tournament.teamA?.name || "Team A"}
                    style={{ width: 40, height: 40, objectFit: "contain", marginBottom: 6 }}
                  />
                )}
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: tournament?.teamA?.color || "var(--team-a-default)", marginBottom: 2 }}>
                  {tournament?.teamA?.name}
                </div>
                <div style={{ fontSize: "1.8rem", fontWeight: 800, lineHeight: 1, position: 'relative', display: 'inline-block' }}>
                  <span style={{ color: tournament?.teamA?.color || "var(--team-a-default)" }}>{stats.fA}</span>
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

              <div style={{ height: "100%", background: "var(--divider)" }}></div>

              {/* Team B */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {tournament?.teamB?.logo && (
                  <img 
                    src={tournament.teamB.logo} 
                    alt={tournament.teamB?.name || "Team B"}
                    style={{ width: 40, height: 40, objectFit: "contain", marginBottom: 6 }}
                  />
                )}
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: tournament?.teamB?.color || "var(--team-b-default)", marginBottom: 2 }}>
                  {tournament?.teamB?.name}
                </div>
                <div style={{ fontSize: "1.8rem", fontWeight: 800, lineHeight: 1, position: 'relative', display: 'inline-block' }}>
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
                  <span style={{ color: tournament?.teamB?.color || "var(--team-b-default)" }}>{stats.fB}</span>
                </div>
              </div>
          </div>
        </section>

        {/* MATCH CARDS */}
        <section style={{ display: "grid", gap: 12 }}>
          {matches.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-text">No matches scheduled.</div>
            </div>
          ) : (
            matches.map((m) => {
              const statusText = formatMatchStatus(m.status, tournament?.teamA?.name, tournament?.teamB?.name);
              const isClosed = m.status?.closed === true;
              const thru = m.status?.thru ?? 0;
              const isStarted = thru > 0;
              const leader = m.status?.leader;
              const winner = m.result?.winner;
              
              // Determine styling based on match state
              let borderColor = "transparent";
              let bgStyle: React.CSSProperties = {};
              let textColor = "text-slate-900";
              
              if (isClosed && winner && winner !== "AS") {
                // Completed match with a winner - full team color background
                const winnerColor = winner === "teamA" 
                  ? (tournament?.teamA?.color || "var(--team-a-default)")
                  : (tournament?.teamB?.color || "var(--team-b-default)");
                bgStyle = { backgroundColor: winnerColor };
                textColor = "text-white";
              } else if (isClosed && winner === "AS") {
                // Halved match - grey background with team color borders
                bgStyle = { 
                  backgroundColor: "#cbd5e1",
                  borderLeft: `4px solid ${tournament?.teamA?.color || 'var(--team-a-default)'}`,
                  borderRight: `4px solid ${tournament?.teamB?.color || 'var(--team-b-default)'}`
                };
                textColor = "text-slate-700";
              } else if (leader === 'teamA') {
                borderColor = tournament?.teamA?.color || "var(--team-a-default)";
                bgStyle = { background: `linear-gradient(90deg, ${borderColor}11 0%, transparent 30%)` };
              } else if (leader === 'teamB') {
                borderColor = tournament?.teamB?.color || "var(--team-b-default)";
                bgStyle = { background: `linear-gradient(-90deg, ${borderColor}11 0%, transparent 30%)` };
              }

              // Team color for in-progress status text
              let statusColor: string;
              if (leader === 'teamA') {
                statusColor = tournament?.teamA?.color || "var(--team-a-default)";
              } else if (leader === 'teamB') {
                statusColor = tournament?.teamB?.color || "var(--team-b-default)";
              } else {
                statusColor = "#94a3b8"; // slate-400
              }

              return (
                <Link 
                  key={m.id} 
                  to={`/match/${m.id}`} 
                  className="card card-hover"
                  style={{ 
                    display: "grid", 
                    gridTemplateColumns: "1fr auto 1fr",
                    gap: 12,
                    alignItems: "center",
                    borderLeft: !isClosed && leader === 'teamA' 
                      ? `4px solid ${borderColor}` 
                      : `4px solid transparent`,
                    borderRight: !isClosed && leader === 'teamB' 
                      ? `4px solid ${borderColor}` 
                      : `4px solid transparent`,
                    ...bgStyle
                  }}
                >
                  {/* Left: Team A Players */}
                  <div className={`text-left text-sm leading-tight ${textColor}`}>
                    {(m.teamAPlayers || []).map((p, i) => (
                        <div key={i} className="font-semibold">
                            {getPlayerShortName(p.playerId)}
                        </div>
                    ))}
                  </div>

                  {/* Center: Status - fixed height for consistency, content vertically centered */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 52 }}>
                    {isClosed ? (
                      // Completed match
                      winner === 'AS' ? (
                        // Halved/Tied match - simple text
                        <>
                          <div style={{ 
                            whiteSpace: 'nowrap',
                            fontSize: '1rem',
                            fontWeight: 700,
                            color: '#334155'
                          }}>
                            TIED
                          </div>
                          <div style={{ 
                            fontSize: '0.65rem', 
                            fontWeight: 600, 
                            color: '#64748b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}>
                            FINAL
                          </div>
                        </>
                      ) : (
                        // Match with a winner
                        <>
                          <div style={{ 
                            fontSize: '0.65rem', 
                            fontWeight: 600, 
                            color: 'rgba(255,255,255,0.85)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}>
                            {winner === 'teamA' 
                              ? (tournament?.teamA?.name || 'Team A')
                              : (tournament?.teamB?.name || 'Team B')
                            }
                          </div>
                          <div style={{ 
                            whiteSpace: 'nowrap',
                            fontSize: '1rem',
                            fontWeight: 700,
                            color: 'white'
                          }}>
                            {statusText.includes("wins") ? statusText.split(" wins ")[1] : statusText}
                          </div>
                          <div style={{ 
                            fontSize: '0.65rem', 
                            fontWeight: 600, 
                            color: 'rgba(255,255,255,0.85)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}>
                            FINAL
                          </div>
                        </>
                      )
                    ) : isStarted && leader ? (
                      // In progress with leader: team name on top, margin, then thru at bottom
                      <>
                        <div style={{ 
                          fontSize: '0.65rem', 
                          fontWeight: 600, 
                          color: statusColor,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        }}>
                          {leader === 'teamA' 
                            ? (tournament?.teamA?.name || 'Team A')
                            : (tournament?.teamB?.name || 'Team B')
                          }
                        </div>
                        <div style={{ 
                          whiteSpace: 'nowrap',
                          fontSize: '1rem',
                          fontWeight: 700,
                          color: statusColor
                        }}>
                          {m.status?.margin} UP
                        </div>
                        <div style={{ 
                          fontSize: '0.65rem', 
                          fontWeight: 600, 
                          color: '#94a3b8',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        }}>
                          THRU {thru}
                        </div>
                      </>
                    ) : isStarted ? (
                      // In progress, All Square
                      <>
                        <div style={{ 
                          whiteSpace: 'nowrap',
                          fontSize: '1rem',
                          fontWeight: 700,
                          color: '#94a3b8'
                        }}>
                          ALL SQUARE
                        </div>
                        <div style={{ 
                          fontSize: '0.65rem', 
                          fontWeight: 600, 
                          color: '#94a3b8',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        }}>
                          THRU {thru}
                        </div>
                      </>
                    ) : (
                      // Not started
                      <div style={{ 
                        whiteSpace: 'nowrap',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#94a3b8'
                      }}>
                        Not Started
                      </div>
                    )}
                  </div>

                  {/* Right: Team B Players */}
                  <div className={`text-right text-sm leading-tight ${textColor}`}>
                    {(m.teamBPlayers || []).map((p, i) => (
                        <div key={i} className="font-semibold">
                            {getPlayerShortName(p.playerId)}
                        </div>
                    ))}
                  </div>
                </Link>
              );
            })
          )}
        </section>
        <LastUpdated />
      </div>
    </Layout>
  );
}