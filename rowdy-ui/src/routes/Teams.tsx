import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, getDocs, query, where, documentId, onSnapshot, limit } from "firebase/firestore";
import { db } from "../firebase";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import type { TournamentDoc, PlayerDoc, PlayerMatchFact, TierMap } from "../types";

// We define a local type for the aggregated tournament stats
type TournamentStat = {
  wins: number;
  losses: number;
  halves: number;
};

export default function Teams() {
  const [searchParams] = useSearchParams();
  const teamParam = searchParams.get("team");
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  const [stats, setStats] = useState<Record<string, TournamentStat>>({});
  const [selectedTeam, setSelectedTeam] = useState<"A" | "B">(teamParam === "B" ? "B" : "A");

  // Track loading states
  const [tournamentLoaded, setTournamentLoaded] = useState(false);
  const [factsLoaded, setFactsLoaded] = useState(false);

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
        setError("Failed to load tournament");
        setTournamentLoaded(true);
      }
    );
    return () => unsub();
  }, []);

  // 2) Fetch players when tournament loads (one-time fetch is fine for player docs)
  useEffect(() => {
    if (!tournament) {
      setPlayers({});
      return;
    }

    const teamAIds = Object.values(tournament.teamA?.rosterByTier || {}).flat();
    const teamBIds = Object.values(tournament.teamB?.rosterByTier || {}).flat();
    const allIds = [...teamAIds, ...teamBIds];

    if (allIds.length === 0) {
      setPlayers({});
      return;
    }

    // Firestore 'in' limit is 30
    const chunks: string[][] = [];
    for (let i = 0; i < allIds.length; i += 30) {
      chunks.push(allIds.slice(i, i + 30));
    }

    Promise.all(
      chunks.map(chunk =>
        getDocs(query(collection(db, "players"), where(documentId(), "in", chunk)))
      )
    ).then(results => {
      const pMap: Record<string, PlayerDoc> = {};
      results.forEach(snap => {
        snap.forEach(d => {
          pMap[d.id] = { id: d.id, ...d.data() } as PlayerDoc;
        });
      });
      setPlayers(pMap);
    }).catch(err => {
      console.error("Players fetch error:", err);
    });
  }, [tournament]);

  // 3) Subscribe to playerMatchFacts for this tournament (real-time for live stats)
  useEffect(() => {
    if (!tournament?.id) {
      setStats({});
      setFactsLoaded(tournamentLoaded);
      return;
    }

    const unsub = onSnapshot(
      query(collection(db, "playerMatchFacts"), where("tournamentId", "==", tournament.id)),
      (snap) => {
        const sMap: Record<string, TournamentStat> = {};
        
        snap.docs.forEach(d => {
          const f = d.data() as PlayerMatchFact;
          const pid = f.playerId;
          
          if (!sMap[pid]) sMap[pid] = { wins: 0, losses: 0, halves: 0 };
          
          if (f.outcome === "win") sMap[pid].wins++;
          else if (f.outcome === "loss") sMap[pid].losses++;
          else if (f.outcome === "halve") sMap[pid].halves++;
        });
        
        setStats(sMap);
        setFactsLoaded(true);
      },
      (err) => {
        console.error("Facts subscription error:", err);
        setFactsLoaded(true);
      }
    );
    return () => unsub();
  }, [tournament?.id, tournamentLoaded]);

  // Coordinated loading state
  useEffect(() => {
    if (tournamentLoaded && (!tournament || factsLoaded)) {
      setLoading(false);
    }
  }, [tournamentLoaded, tournament, factsLoaded]);

  const renderRoster = (teamColor: string, roster?: TierMap, handicaps?: Record<string, number>) => {
    if (!roster) return (
      <div className="card p-4 opacity-60">
        <div className="text-center text-slate-400">No roster defined.</div>
      </div>
    );

    // Sort tiers alphabetically (A, B, C...)
    const tiers = Object.keys(roster).sort();

    return (
      <div className="card" style={{ padding: 0, overflow: "hidden", borderTop: `4px solid ${teamColor}` }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {tiers.map((tier) => {
            const pIds = roster[tier as keyof TierMap] || [];
            if (pIds.length === 0) return null;

            return (
              <div key={tier}>
                {/* Tier Label */}
                <div className="section-header">
                  Tier {tier}
                </div>

                {/* Player Rows */}
                {pIds.map(pid => {
                  const p = players[pid];
                  const s = stats[pid];
                  const name = p?.displayName || p?.username || "Unknown";
                  const hcp = handicaps?.[pid];
                  
                  return (
                    <div 
                      key={pid} 
                      className="flex justify-between items-center px-4 py-3 border-b border-slate-200 
                                 hover:bg-slate-50 transition-colors duration-150"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold">{name}</span>
                        {hcp != null && (
                          <span className="text-xs text-slate-500">({hcp})</span>
                        )}
                      </div>
                      <div className="text-sm text-slate-500 font-mono">
                        {s ? `${s.wins}-${s.losses}-${s.halves}` : "0-0-0"}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
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

  const teamAName = tournament?.teamA?.name || "Team A";
  const teamBName = tournament?.teamB?.name || "Team B";
  const teamAColor = tournament?.teamA?.color || "var(--team-a-default)";
  const teamBColor = tournament?.teamB?.color || "var(--team-b-default)";
  const teamALogo = tournament?.teamA?.logo;
  const teamBLogo = tournament?.teamB?.logo;

  return (
    <Layout title="Team Rosters" series={tournament?.series} showBack tournamentLogo={tournament?.tournamentLogo}>
      <div style={{ padding: 16, display: "grid", gap: 16, maxWidth: 800, margin: "0 auto" }}>
        
        {/* Team Selector Tabs */}
        <div 
          style={{ 
            display: "grid", 
            gridTemplateColumns: "1fr 1fr", 
            borderRadius: 12, 
            overflow: "hidden",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            border: "1px solid var(--divider)",
          }}
        >
          {/* Team A Tab */}
          <button
            onClick={() => setSelectedTeam("A")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "14px 12px",
              border: "none",
              cursor: "pointer",
              background: selectedTeam === "A" 
                ? `color-mix(in srgb, ${teamAColor} 15%, white)` 
                : "white",
              borderBottom: selectedTeam === "A" ? `3px solid ${teamAColor}` : "3px solid transparent",
              transition: "all 0.2s ease",
            }}
          >
            {teamALogo && (
              <img 
                src={teamALogo} 
                alt={teamAName}
                style={{ width: 28, height: 28, objectFit: "contain" }}
              />
            )}
            <span style={{ 
              fontWeight: 700, 
              fontSize: "0.95rem",
              color: selectedTeam === "A" ? teamAColor : "var(--text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
            }}>
              {teamAName}
            </span>
          </button>

          {/* Team B Tab */}
          <button
            onClick={() => setSelectedTeam("B")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "14px 12px",
              border: "none",
              borderLeft: "1px solid var(--divider)",
              cursor: "pointer",
              background: selectedTeam === "B" 
                ? `color-mix(in srgb, ${teamBColor} 15%, white)` 
                : "white",
              borderBottom: selectedTeam === "B" ? `3px solid ${teamBColor}` : "3px solid transparent",
              transition: "all 0.2s ease",
            }}
          >
            {teamBLogo && (
              <img 
                src={teamBLogo} 
                alt={teamBName}
                style={{ width: 28, height: 28, objectFit: "contain" }}
              />
            )}
            <span style={{ 
              fontWeight: 700, 
              fontSize: "0.95rem",
              color: selectedTeam === "B" ? teamBColor : "var(--text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
            }}>
              {teamBName}
            </span>
          </button>
        </div>

        {/* Selected Team Roster */}
        {selectedTeam === "A" ? (
          renderRoster(
            teamAColor, 
            tournament?.teamA?.rosterByTier,
            tournament?.teamA?.handicapByPlayer
          )
        ) : (
          renderRoster(
            teamBColor, 
            tournament?.teamB?.rosterByTier,
            tournament?.teamB?.handicapByPlayer
          )
        )}

        <LastUpdated />
      </div>
    </Layout>
  );
}