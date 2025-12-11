import { useEffect, useState, memo } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, query, where, documentId, onSnapshot, limit, doc } from "firebase/firestore";
import { db } from "../firebase";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import OfflineImage from "../components/OfflineImage";
import TeamName from "../components/TeamName";
import type { TournamentDoc, PlayerDoc, PlayerMatchFact, TierMap } from "../types";
import { ensureTournamentTeamColors } from "../utils/teamColors";

// We define a local type for the aggregated tournament stats
type TournamentStat = {
  wins: number;
  losses: number;
  halves: number;
};

function TeamsComponent() {
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

  // 1) Subscribe to tournament: use `tournamentId` search param when provided,
  // otherwise fall back to the active tournament.
  useEffect(() => {
    let unsub = () => {};

    if (searchParams.get("tournamentId")) {
      const tid = searchParams.get("tournamentId") as string;
      const docRef = doc(db, "tournaments", tid);
      const listener = onSnapshot(
        docRef,
        (snap) => {
          if (snap.exists()) setTournament(ensureTournamentTeamColors({ id: snap.id, ...snap.data() } as TournamentDoc));
          else {
            setTournament(null);
            setError("Tournament not found.");
          }
          setTournamentLoaded(true);
        },
        (err) => {
          console.error("Tournament subscription error:", err);
          setError("Failed to load tournament");
          setTournamentLoaded(true);
        }
      );
      unsub = listener;
    } else {
      const listener = onSnapshot(
        query(collection(db, "tournaments"), where("active", "==", true), limit(1)),
        (snap) => {
          if (snap.empty) {
            setTournament(null);
          } else {
            const doc = snap.docs[0];
            setTournament(ensureTournamentTeamColors({ id: doc.id, ...doc.data() } as TournamentDoc));
          }
          setTournamentLoaded(true);
        },
        (err) => {
          console.error("Tournament subscription error:", err);
          setError("Failed to load tournament");
          setTournamentLoaded(true);
        }
      );
      unsub = listener;
    }

    return () => unsub();
  }, [searchParams]);

  // 2) Subscribe to players when tournament loads (using onSnapshot for offline cache)
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

    // Firestore 'in' limit is 30, so we need to chunk
    // For real-time updates, we create multiple subscriptions
    const chunks: string[][] = [];
    for (let i = 0; i < allIds.length; i += 30) {
      chunks.push(allIds.slice(i, i + 30));
    }

    // Track players from all chunks
    const playersByChunk: Record<number, Record<string, PlayerDoc>> = {};
    const unsubscribers: (() => void)[] = [];

    chunks.forEach((chunk, chunkIndex) => {
      const unsub = onSnapshot(
        query(collection(db, "players"), where(documentId(), "in", chunk)),
        (snap) => {
          const chunkPlayers: Record<string, PlayerDoc> = {};
          snap.forEach(d => {
            chunkPlayers[d.id] = { id: d.id, ...d.data() } as PlayerDoc;
          });
          playersByChunk[chunkIndex] = chunkPlayers;
          
          // Merge all chunks into players state
          const merged: Record<string, PlayerDoc> = {};
          Object.values(playersByChunk).forEach(chunkData => {
            Object.assign(merged, chunkData);
          });
          setPlayers(merged);
        },
        (err) => {
          console.error("Players subscription error:", err);
        }
      );
      unsubscribers.push(unsub);
    });

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
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

  const renderRoster = (teamColor: string, roster?: TierMap, handicaps?: Record<string, number>, captainId?: string, _coCaptainId?: string) => {
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
                {/* Tier header (single letter) - keep font size, reduce vertical padding */}
                <div className="section-header py-0 text-xs">
                  {tier}
                </div>

                {/* Player Rows */}
                {pIds.map(pid => {
                  const p = players[pid];
                  const s = stats[pid];
                  const name = p?.displayName || "Unknown";
                  const hcp = handicaps?.[pid];
                  const isCaptain = pid === captainId;
                  
                  return (
                    <div 
                      key={pid} 
                      className="flex justify-between items-center px-4 py-2 border-b border-slate-200 hover:bg-slate-50 transition-colors duration-150"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold">{name}</span>
                        {hcp != null && (
                          <span className="text-xs text-slate-500">({Number(hcp).toFixed(1)})</span>
                        )}
                        {isCaptain && (
                          <span 
                            style={{ 
                              fontSize: '0.65rem', 
                              fontWeight: 700,
                              color: teamColor,
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                              padding: '1px 5px',
                              borderRadius: 4,
                              background: `color-mix(in srgb, ${teamColor} 15%, white)`,
                              marginLeft: 6,
                            }}
                          >
                            Captain
                          </span>
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
            <OfflineImage 
              src={teamALogo} 
              alt={teamAName}
              fallbackIcon="🔵"
              style={{ width: 28, height: 28, objectFit: "contain" }}
            />
            <TeamName
              name={teamAName}
              variant="inline"
              style={{
                fontWeight: 700,
                fontSize: '0.95rem',
                color: selectedTeam === 'A' ? teamAColor : 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            />
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
            <OfflineImage 
              src={teamBLogo} 
              alt={teamBName}
              fallbackIcon="🔴"
              style={{ width: 28, height: 28, objectFit: "contain" }}
            />
            <TeamName
              name={teamBName}
              variant="inline"
              style={{
                fontWeight: 700,
                fontSize: '0.95rem',
                color: selectedTeam === 'B' ? teamBColor : 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            />
          </button>
        </div>

        {/* Selected Team Roster */}
        {selectedTeam === "A" ? (
          renderRoster(
            teamAColor, 
            tournament?.teamA?.rosterByTier,
            tournament?.teamA?.handicapByPlayer,
            tournament?.teamA?.captainId,
            tournament?.teamA?.coCaptainId
          )
        ) : (
          renderRoster(
            teamBColor, 
            tournament?.teamB?.rosterByTier,
            tournament?.teamB?.handicapByPlayer,
            tournament?.teamB?.captainId,
            tournament?.teamB?.coCaptainId
          )
        )}

        <LastUpdated />
      </div>
    </Layout>
  );
}

export default memo(TeamsComponent);