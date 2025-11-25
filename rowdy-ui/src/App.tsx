import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "./firebase";
import type { TournamentDoc, RoundDoc, MatchDoc } from "./types";
import Layout from "./components/Layout";
import LastUpdated from "./components/LastUpdated"; 

// Small helper for score display
function ScoreBlock({ final, proj, color }: { final: number; proj: number; color?: string }) {
  return (
    <span>
      <span style={{ color: color || "inherit" }}>{final}</span>
      {proj > 0 && (
        <span style={{ fontSize: "0.6em", color: "#64748b", marginLeft: 6, verticalAlign: "middle" }}>
          (+{proj})
        </span>
      )}
    </span>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [rounds, setRounds] = useState<RoundDoc[]>([]);
  const [matchesByRound, setMatchesByRound] = useState<Record<string, MatchDoc[]>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) Find active tournament
        const tSnap = await getDocs(query(collection(db, "tournaments"), where("active", "==", true), limit(1)));
        if (tSnap.empty) { 
          setTournament(null); 
          setRounds([]); 
          setMatchesByRound({}); 
          setLoading(false); 
          return; 
        }
        
        const tData = tSnap.docs[0].data();
        const t = { id: tSnap.docs[0].id, ...tData } as TournamentDoc;
        setTournament(t);

        // 2) Load rounds
        const rQuery = query(collection(db, "rounds"), where("tournamentId", "==", t.id));
        const rSnap = await getDocs(rQuery);
        let rds = rSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as RoundDoc));
        // Sort by day, then ID
        rds = rds.sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.id.localeCompare(b.id));
        setRounds(rds);

        // 3) Load matches for stats
        const matchesPromises = rds.map(async (r) => {
          const mSnap = await getDocs(query(collection(db, "matches"), where("roundId", "==", r.id)));
          const matches = mSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MatchDoc));
          return { roundId: r.id, matches };
        });

        const results = await Promise.all(matchesPromises);
        const bucket: Record<string, MatchDoc[]> = {};
        results.forEach((res) => { bucket[res.roundId] = res.matches; });
        setMatchesByRound(bucket);

      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // --- Stats Calculation ---
  const { stats, roundStats } = useMemo(() => {
    let fA = 0, fB = 0, pA = 0, pB = 0;
    const rStats: Record<string, { fA: number; fB: number; pA: number; pB: number }> = {};

    rounds.forEach(r => { rStats[r.id] = { fA: 0, fB: 0, pA: 0, pB: 0 }; });

    const allMatches = Object.values(matchesByRound).flat();

    for (const m of allMatches) {
      const pv = m.pointsValue ?? 1;
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

  if (loading) return <div style={{ padding: 16, textAlign: 'center', marginTop: 40 }}>Loading...</div>;

  const tName = tournament?.name || "Rowdy Cup";
  const tSeries = tournament?.series; // "rowdyCup" or "christmasClassic"

  return (
    <Layout title={tName} series={tSeries}>
      {!tournament ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
          No active tournament found.
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
              <div>
                {tournament.teamA?.logo && (
                  <img 
                    src={tournament.teamA.logo} 
                    alt={tournament.teamA?.name || "Team A"}
                    style={{ width: 48, height: 48, objectFit: "contain", marginBottom: 8 }}
                  />
                )}
                <div style={{ 
                  fontWeight: 800, 
                  color: tournament.teamA?.color || "var(--team-a-default)", 
                  fontSize: "1.1rem", 
                  marginBottom: 4 
                }}>
                  {tournament.teamA?.name || "Team A"}
                </div>
                <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1 }}>
                  <ScoreBlock final={stats.fA} proj={stats.pA} color={tournament.teamA?.color || "var(--team-a-default)"} />
                </div>
              </div>

              {/* Divider Line */}
              <div style={{ height: 40, width: 1, background: "var(--divider)" }}></div>

              {/* Team B */}
              <div>
                {tournament.teamB?.logo && (
                  <img 
                    src={tournament.teamB.logo} 
                    alt={tournament.teamB?.name || "Team B"}
                    style={{ width: 48, height: 48, objectFit: "contain", marginBottom: 8 }}
                  />
                )}
                <div style={{ 
                  fontWeight: 800, 
                  color: tournament.teamB?.color || "var(--team-b-default)", 
                  fontSize: "1.1rem", 
                  marginBottom: 4 
                }}>
                  {tournament.teamB?.name || "Team B"}
                </div>
                <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1 }}>
                  <ScoreBlock final={stats.fB} proj={stats.pB} color={tournament.teamB?.color || "var(--team-b-default)"} />
                </div>
              </div>
            </div>
          </section>

          {/* ACTIONS BUTTON */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <Link to="/teams" style={{ textDecoration: 'none' }}>
              <button style={{ 
                width: '100%', 
                padding: '14px', 
                background: 'white', 
                color: 'var(--brand-primary)',
                border: '1px solid var(--divider)',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.9rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
              }}>
                View Team Rosters
              </button>
            </Link>
          </div>

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
              return (
                <Link 
                  key={r.id} 
                  to={`/round/${r.id}`} 
                  className="card" 
                  style={{ 
                    display: "flex", 
                    justifyContent: "space-between", 
                    alignItems: "center", 
                    textDecoration: "none", 
                    color: "inherit",
                    transition: "transform 0.1s active"
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 2 }}>Round {idx + 1}</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{r.format}</div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "1.2rem", fontWeight: "bold" }}>
                    <ScoreBlock final={rs.fA} proj={rs.pA} color={tournament.teamA?.color} />
                    <span style={{ margin: "0 8px", opacity: 0.3, fontWeight: 400 }}>-</span>
                    <ScoreBlock final={rs.fB} proj={rs.pB} color={tournament.teamB?.color} />
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