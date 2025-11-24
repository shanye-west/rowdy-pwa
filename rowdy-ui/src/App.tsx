import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "./firebase";
import type { TournamentDoc, RoundDoc, MatchDoc } from "./types";
import Layout from "./components/Layout"; // <--- IMPORT THE NEW LAYOUT

// Reusable score component (kept simple for now)
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
        if (tSnap.empty) { setTournament(null); setRounds([]); setMatchesByRound({}); setLoading(false); return; }
        const t = { id: tSnap.docs[0].id, ...(tSnap.docs[0].data() as any) } as TournamentDoc;
        setTournament(t);

        // 2) Load rounds
        const rQuery = query(collection(db, "rounds"), where("tournamentId", "==", t.id));
        const rSnap = await getDocs(rQuery);
        let rds = rSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as RoundDoc));
        rds = rds.sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.id.localeCompare(b.id));
        setRounds(rds);

        // 3) Load matches
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

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  
  // PASS THE TOURNAMENT NAME TO LAYOUT TO TRIGGER THE CORRECT THEME
  const tName = tournament?.name || "No Tournament";

  return (
    <Layout title={tName} tournamentName={tName}>
      {!tournament ? (
        <div style={{ padding: 16 }}>No active tournament found.</div>
      ) : (
        <div style={{ padding: 16, display: "grid", gap: 24 }}>
          {/* HERO SCOREBOARD */}
          <section className="card" style={{textAlign: 'center', padding: 24}}>
            <h2 style={{margin: "0 0 16px 0", fontSize: "0.9rem", color: "var(--text-secondary)", textTransform: "uppercase"}}>Total Score</h2>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center" }}>
              {/* Team A */}
              <div>
                <div style={{ fontWeight: 800, color: tournament.teamA?.color || "var(--team-a-default)", fontSize: "1.1rem", marginBottom: 4 }}>
                  {tournament.teamA?.name || "Team A"}
                </div>
                <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1 }}>
                  <ScoreBlock final={stats.fA} proj={stats.pA} color={tournament.teamA?.color || "var(--team-a-default)"} />
                </div>
              </div>

              {/* VS Divider */}
              <div style={{height: 40, width: 1, background: "var(--divider)"}}></div>

              {/* Team B */}
              <div>
                <div style={{ fontWeight: 800, color: tournament.teamB?.color || "var(--team-b-default)", fontSize: "1.1rem", marginBottom: 4 }}>
                  {tournament.teamB?.name || "Team B"}
                </div>
                <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1 }}>
                  <ScoreBlock final={stats.fB} proj={stats.pB} color={tournament.teamB?.color || "var(--team-b-default)"} />
                </div>
              </div>
            </div>
          </section>

          {/* ROUNDS LIST */}
          <section style={{ display: "grid", gap: 12 }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "1rem", textTransform: "uppercase", color: "var(--text-secondary)" }}>Schedule</h3>
            {rounds.map((r, idx) => {
              const rs = roundStats[r.id];
              return (
                <Link key={r.id} to={`/round/${r.id}`} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none", color: "inherit" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>Round {idx + 1}</div>
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
        </div>
      )}
    </Layout>
  );
}