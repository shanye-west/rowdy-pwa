import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import type { RoundDoc, TournamentDoc, MatchDoc } from "../types";

function ScoreBlock({ final, proj, color }: { final: number; proj: number; color?: string }) {
  return (
    <span>
      <span style={{ color: color || "inherit" }}>{final}</span>
      {proj > 0 && (
        <span style={{ fontSize: "0.6em", color: "#999", marginLeft: 6, verticalAlign: "middle" }}>
          (+{proj})
        </span>
      )}
    </span>
  );
}

export default function Round() {
  const { roundId } = useParams();
  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [matches, setMatches] = useState<MatchDoc[]>([]);

  useEffect(() => {
    if (!roundId) return;
    (async () => {
      setLoading(true);
      try {
        const rSnap = await getDoc(doc(db, "rounds", roundId));
        if (!rSnap.exists()) { setLoading(false); return; }
        const rData = { id: rSnap.id, ...rSnap.data() } as RoundDoc;
        setRound(rData);

        if (rData.tournamentId) {
          const tSnap = await getDoc(doc(db, "tournaments", rData.tournamentId));
          if (tSnap.exists()) {
            setTournament({ id: tSnap.id, ...tSnap.data() } as TournamentDoc);
          }
        }

        const q = query(collection(db, "matches"), where("roundId", "==", roundId));
        const mSnap = await getDocs(q);
        const ms = mSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as MatchDoc))
          .sort((a, b) => a.id.localeCompare(b.id));
        setMatches(ms);
      } finally {
        setLoading(false);
      }
    })();
  }, [roundId]);

  const stats = useMemo(() => {
    let fA = 0, fB = 0, pA = 0, pB = 0;
    for (const m of matches) {
      const pv = m.pointsValue ?? 1;
      const w = m.result?.winner;
      
      const ptsA = w === "teamA" ? pv : w === "AS" ? pv / 2 : 0;
      const ptsB = w === "teamB" ? pv : w === "AS" ? pv / 2 : 0;

      const isClosed = m.status?.closed === true;
      const isStarted = (m.status?.thru ?? 0) > 0;

      if (isClosed) { fA += ptsA; fB += ptsB; } 
      else if (isStarted) { pA += ptsA; pB += ptsB; }
    }
    return { fA, fB, pA, pB };
  }, [matches]);

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;
  if (!round) return <div style={{ padding: 16 }}>Round not found.</div>;

  return (
    <div style={{ padding: 16, display: "grid", gap: 24 }}>
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: "1.8rem" }}>
            Round {round.day ?? ""} <span style={{fontSize:'0.6em', opacity: 0.6, fontWeight:400}}>{round.format}</span>
          </h1>
          <Link to="/" style={{ textDecoration: 'none', fontSize: '0.9rem' }}>Home</Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, textAlign: "center", background: "#fafafa" }}>
            <div style={{ fontWeight: 700, color: tournament?.teamA?.color || "#333", marginBottom: 4 }}>
              {tournament?.teamA?.name || "Team A"}
            </div>
            <div style={{ fontSize: 32, fontWeight: "bold", lineHeight: 1 }}>
              <ScoreBlock final={stats.fA} proj={stats.pA} color={tournament?.teamA?.color} />
            </div>
          </div>
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, textAlign: "center", background: "#fafafa" }}>
            <div style={{ fontWeight: 700, color: tournament?.teamB?.color || "#333", marginBottom: 4 }}>
              {tournament?.teamB?.name || "Team B"}
            </div>
            <div style={{ fontSize: 32, fontWeight: "bold", lineHeight: 1 }}>
              <ScoreBlock final={stats.fB} proj={stats.pB} color={tournament?.teamB?.color} />
            </div>
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h3 style={{ margin: "0 0 8px 0", borderBottom: "1px solid #eee", paddingBottom: 8 }}>Matches</h3>
        {matches.length === 0 ? (
          <div style={{ padding: "8px 0", fontStyle: "italic", opacity: 0.6 }}>No matches.</div>
        ) : (
          <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0, display: 'grid', gap: 12 }}>
            {matches.map((m) => (
              <li key={m.id}>
                <Link to={`/match/${m.id}`} style={{ textDecoration: "none", color: "inherit", display: "block", border: "1px solid #eee", borderRadius: 8, padding: 12, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 600 }}>Match {m.id}</span>
                    <span style={{ fontSize: "0.9em", opacity: 0.8 }}>
                      {m.status?.leader 
                        ? `${m.status.leader === "teamA" ? (tournament?.teamA.name || "Team A") : (tournament?.teamB.name || "Team B")} ${m.status.margin}`
                        : (m.status?.thru ?? 0) > 0 ? "AS" : "—"
                      } 
                      <span style={{ opacity: 0.6, marginLeft: 6 }}>
                        {m.status?.closed ? "(F)" : (m.status?.thru ?? 0) > 0 ? `(${m.status?.thru})` : ""}
                      </span>
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85em", color: "#666" }}>
                    {(m.teamAPlayers || []).length > 0 && <span>vs</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}