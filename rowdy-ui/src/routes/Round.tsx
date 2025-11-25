import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where, documentId } from "firebase/firestore";
import { db } from "../firebase";
import type { RoundDoc, TournamentDoc, MatchDoc, PlayerDoc } from "../types";
import { formatMatchStatus, formatRoundType } from "../utils";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import ScoreBlock from "../components/ScoreBlock";

export default function Round() {
  const { roundId } = useParams();
  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
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
        // 1. Get Round
        const rSnap = await getDoc(doc(db, "rounds", roundId));
        if (!rSnap.exists()) {
          setError("Round not found.");
          setRound(null);
          return;
        }
        const rData = { id: rSnap.id, ...rSnap.data() } as RoundDoc;
        setRound(rData);

        // 2. Get Tournament (for Theme & Colors)
        if (rData.tournamentId) {
          const tSnap = await getDoc(doc(db, "tournaments", rData.tournamentId));
          if (tSnap.exists()) {
            setTournament({ id: tSnap.id, ...tSnap.data() } as TournamentDoc);
          }
        }

        // 3. Get Matches
        const q = query(collection(db, "matches"), where("roundId", "==", roundId));
        const mSnap = await getDocs(q);
        const ms = mSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as MatchDoc))
          .sort((a, b) => a.id.localeCompare(b.id));
        setMatches(ms);

        // 4. Bulk Fetch Players (so we can show names on the cards)
        const playerIds = new Set<string>();
        ms.forEach(m => {
          m.teamAPlayers?.forEach(p => p.playerId && playerIds.add(p.playerId));
          m.teamBPlayers?.forEach(p => p.playerId && playerIds.add(p.playerId));
        });

        if (playerIds.size > 0) {
          const pIds = Array.from(playerIds);
          // Firestore 'in' limit is 10, so chunk if necessary (simple version here assumes <10 for now or does 1 batch)
          // For production with many players, you'd chunk this.
          const chunks = [];
          for (let i=0; i<pIds.length; i+=10) chunks.push(pIds.slice(i, i+10));

          const playerMap: Record<string, PlayerDoc> = {};
          for (const chunk of chunks) {
            const pSnap = await getDocs(query(collection(db, "players"), where(documentId(), "in", chunk)));
            pSnap.forEach(doc => { playerMap[doc.id] = { id: doc.id, ...doc.data() } as PlayerDoc; });
          }
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

  const getPlayerName = (pid: string) => {
    const p = players[pid];
    if (!p) return "Unknown";
    // Try First Last -> First L. -> Username
    if (p.displayName) {
        const parts = p.displayName.split(" ");
        if (parts.length > 1) return `${parts[0]} ${parts[parts.length-1][0]}.`;
        return p.displayName;
    }
    return p.username || "Unknown";
  };

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
          <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: 16 }}>
            {formatRoundType(round.format)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1px 1fr", gap: 12, alignItems: "center", borderTop: "1px solid var(--divider)", paddingTop: 16 }}>
             {/* Team A */}
             <div>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: tournament?.teamA?.color || "var(--team-a-default)", marginBottom: 2 }}>
                  {tournament?.teamA?.name}
                </div>
                <div style={{ fontSize: "1.8rem", fontWeight: 800, lineHeight: 1 }}>
                  <ScoreBlock final={stats.fA} proj={stats.pA} color={tournament?.teamA?.color || "var(--team-a-default)"} />
                </div>
              </div>

              <div style={{ height: "100%", background: "var(--divider)" }}></div>

              {/* Team B */}
              <div>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: tournament?.teamB?.color || "var(--team-b-default)", marginBottom: 2 }}>
                  {tournament?.teamB?.name}
                </div>
                <div style={{ fontSize: "1.8rem", fontWeight: 800, lineHeight: 1 }}>
                  <ScoreBlock final={stats.fB} proj={stats.pB} color={tournament?.teamB?.color || "var(--team-b-default)"} />
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
              const isStarted = (m.status?.thru ?? 0) > 0;
              
              // Determine border color based on leader
              let borderColor = "transparent";
              let bgStyle = {};
              const leader = m.status?.leader;
              
              if (leader === 'teamA') {
                 borderColor = tournament?.teamA?.color || "var(--team-a-default)";
                 bgStyle = { background: `linear-gradient(90deg, ${borderColor}11 0%, transparent 30%)` };
              } else if (leader === 'teamB') {
                 borderColor = tournament?.teamB?.color || "var(--team-b-default)";
                 bgStyle = { background: `linear-gradient(-90deg, ${borderColor}11 0%, transparent 30%)` };
              }

              // Badge style based on match state
              const badgeClass = isClosed 
                ? "badge-success" 
                : isStarted 
                  ? "badge-info" 
                  : "badge-default";

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
                    borderLeft: leader === 'teamA' ? `4px solid ${borderColor}` : `4px solid transparent`,
                    borderRight: leader === 'teamB' ? `4px solid ${borderColor}` : `4px solid transparent`,
                    ...bgStyle
                  }}
                >
                  {/* Left: Team A Players */}
                  <div className="text-left text-sm leading-tight">
                    {(m.teamAPlayers || []).map((p, i) => (
                        <div key={i} className="font-semibold text-slate-900">
                            {getPlayerName(p.playerId)}
                        </div>
                    ))}
                  </div>

                  {/* Center: Status */}
                  <div className={badgeClass} style={{ whiteSpace: 'nowrap' }}>
                    {statusText.includes("wins") 
                        ? statusText.split(" wins ")[1] // "3 & 2" instead of "Team A wins 3 & 2"
                        : statusText
                    }
                  </div>

                  {/* Right: Team B Players */}
                  <div className="text-right text-sm leading-tight">
                    {(m.teamBPlayers || []).map((p, i) => (
                        <div key={i} className="font-semibold text-slate-900">
                            {getPlayerName(p.playerId)}
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