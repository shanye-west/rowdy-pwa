import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "./firebase";
import type { TournamentDoc, RoundDoc, MatchDoc } from "./types";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [rounds, setRounds] = useState<RoundDoc[]>([]);
  const [matchesByRound, setMatchesByRound] = useState<Record<string, MatchDoc[]>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) Find the active tournament
        const tSnap = await getDocs(query(collection(db, "tournaments"), where("active", "==", true), limit(1)));
        if (tSnap.empty) { setTournament(null); setRounds([]); setMatchesByRound({}); setLoading(false); return; }
        const t = { id: tSnap.docs[0].id, ...(tSnap.docs[0].data() as any) } as TournamentDoc;
        setTournament(t);

        // 2) Load rounds for that tournament (ordered by day if present)
        const rQuery = query(collection(db, "rounds"), where("tournamentId", "==", t.id));
        const rSnap = await getDocs(rQuery);
        let rds = rSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as RoundDoc));
        // sort by 'day' if present, otherwise by id
        rds = rds.sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.id.localeCompare(b.id));
        setRounds(rds);

        // 3) For each round, load matches (simple where on roundId)
        const bucket: Record<string, MatchDoc[]> = {};
        for (const r of rds) {
          const mSnap = await getDocs(query(collection(db, "matches"), where("roundId", "==", r.id)));
          bucket[r.id] = mSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as MatchDoc))
            // optional: sort by doc id for stable order
            .sort((a, b) => a.id.localeCompare(b.id));
        }
        setMatchesByRound(bucket);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (!tournament) return <div style={{ padding: 16 }}>No active tournament found.</div>;

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      <h1>{tournament.name}</h1>

      {rounds.map((r, idx) => {
        const matches = matchesByRound[r.id] ?? [];
        return (
          <div key={r.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ margin: 0 }}>
                Round {idx + 1} • {r.format} {typeof r.day === "number" ? `(Day ${r.day})` : ""}
              </h2>
              <small style={{ opacity: 0.7 }}>{r.id}</small>
            </div>

            {matches.length === 0 ? (
              <div style={{ padding: "8px 0" }}>No matches yet.</div>
            ) : (
              <ul style={{ listStyle: "none", paddingLeft: 0 }}>
                {matches.map((m) => (
                  <li key={m.id} style={{ padding: "6px 0", display: "flex", justifyContent: "space-between" }}>
                    <Link to={`/match/${m.id}`}>Match {m.id}</Link>
                    <span style={{ opacity: 0.7 }}>
                      {m.status
                        ? `${m.status.leader ?? "AS"} ${m.status.margin ?? 0} • thru ${m.status.thru ?? 0} • ${m.status.closed ? "Final" : "Live"}`
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}