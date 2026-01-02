import { useEffect, useState, useMemo, memo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collection, query, where, documentId, getDocs, collectionGroup } from "firebase/firestore";
import { db } from "../firebase";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import OfflineImage from "../components/OfflineImage";
import TeamName from "../components/TeamName";
import type { PlayerDoc, TierMap } from "../types";
import { useTournamentData } from "../hooks/useTournamentData";

// We define a local type for the aggregated tournament stats
type TournamentStat = {
  wins: number;
  losses: number;
  halves: number;
};

function TeamsComponent() {
  const [searchParams] = useSearchParams();
  const teamParam = searchParams.get("team");
  const tournamentIdParam = searchParams.get("tournamentId");
  
  // Use shared tournament hook instead of creating a duplicate subscription
  // This eliminates 1 real-time subscription per Teams page view
  const tournamentOptions = useMemo(() => 
    tournamentIdParam 
      ? { tournamentId: tournamentIdParam } 
      : { fetchActive: true },
    [tournamentIdParam]
  );
  const { tournament, rounds, loading: tournamentLoading, error: tournamentError } = useTournamentData(tournamentOptions);
  
  // Create a stable trigger for refetching stats when rounds lock
  // This will change when any round.locked value changes
  const roundsLockState = useMemo(() => 
    rounds.map(r => `${r.id}:${r.locked ? '1' : '0'}`).join(','),
    [rounds]
  );
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  const [stats, setStats] = useState<Record<string, TournamentStat>>({});
  const [selectedTeam, setSelectedTeam] = useState<"A" | "B">(teamParam === "B" ? "B" : "A");

  // Track loading states
  const [playersLoaded, setPlayersLoaded] = useState(false);
  const [factsLoaded, setFactsLoaded] = useState(false);

  // Sync error from tournament hook
  useEffect(() => {
    if (tournamentError) setError(tournamentError);
  }, [tournamentError]);

  // 2) Fetch players when tournament loads (one-time read, refreshes on tournament update)
  useEffect(() => {
    if (!tournament) {
      setPlayers({});
      setPlayersLoaded(true);
      return;
    }

    const teamAIds = Object.values(tournament.teamA?.rosterByTier || {}).flat();
    const teamBIds = Object.values(tournament.teamB?.rosterByTier || {}).flat();
    const allIds = [...teamAIds, ...teamBIds];

    if (allIds.length === 0) {
      setPlayers({});
      setPlayersLoaded(true);
      return;
    }

    // Mark as loading while fetching
    setPlayersLoaded(false);

    // Firestore 'in' limit is 30, so we need to chunk
    // Using getDocs instead of onSnapshot to reduce active listeners
    const chunks: string[][] = [];
    for (let i = 0; i < allIds.length; i += 30) {
      chunks.push(allIds.slice(i, i + 30));
    }

    // Fetch all chunks in parallel
    Promise.all(
      chunks.map(chunk => 
        getDocs(query(collection(db, "players"), where(documentId(), "in", chunk)))
      )
    )
      .then(snapshots => {
        const merged: Record<string, PlayerDoc> = {};
        snapshots.forEach(snap => {
          snap.forEach(d => {
            merged[d.id] = { id: d.id, ...d.data() } as PlayerDoc;
          });
        });
        setPlayers(merged);
        setPlayersLoaded(true);
      })
      .catch(err => {
        console.error("Players fetch error:", err);
        setPlayersLoaded(true);
      });
  }, [tournament]); // Refetch when tournament updates (triggers when rounds lock via useTournamentData subscription)

  // 3) Fetch pre-aggregated byTournament stats using collection group query (one-time read)
  useEffect(() => {
    if (!tournament?.id) {
      setStats({});
      setFactsLoaded(!tournamentLoading);
      return;
    }

    // Wait for players to load before fetching stats
    if (!playersLoaded) {
      return;
    }

    const playerIds = Object.keys(players);
    if (playerIds.length === 0) {
      setFactsLoaded(true);
      return;
    }

    // Use getDocs instead of onSnapshot to fetch stats once per tournament update
    getDocs(
      query(
        collectionGroup(db, "byTournament"),
        where("tournamentId", "==", tournament.id)
      )
    )
      .then(snap => {
        const newStats: Record<string, TournamentStat> = {};
        snap.docs.forEach(doc => {
          const data = doc.data();
          const playerId = data.playerId;
          if (playerId && playerIds.includes(playerId)) {
            newStats[playerId] = {
              wins: data.wins || 0,
              losses: data.losses || 0,
              halves: data.halves || 0,
            };
          }
        });
        // Fill in zeros for players without stats
        playerIds.forEach(pid => {
          if (!newStats[pid]) {
            newStats[pid] = { wins: 0, losses: 0, halves: 0 };
          }
        });
        setStats(newStats);
        setFactsLoaded(true);
      })
      .catch(err => {
        console.error("Stats collection group query error:", err);
        setFactsLoaded(true);
      });
  }, [tournament?.id, players, playersLoaded, tournamentLoading, roundsLockState]); // Refetch when any round locks/unlocks

  // Coordinated loading state
  useEffect(() => {
    const allLoaded = !tournamentLoading && (!tournament || (playersLoaded && factsLoaded));
    setLoading(!allLoaded);
  }, [tournamentLoading, tournament, playersLoaded, factsLoaded]);

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

            // Sort player IDs by handicap (lowest to highest). Players without a handicap
            // are placed after those with defined handicaps.
            const sortedPIds = [...pIds].sort((a, b) => {
              const ha = handicaps?.[a];
              const hb = handicaps?.[b];
              if (ha == null && hb == null) return 0;
              if (ha == null) return 1;
              if (hb == null) return -1;
              return Number(ha) - Number(hb);
            });

            return (
              <div key={tier}>
                {/* Tier header (single letter) - keep font size, reduce vertical padding */}
                <div className="section-header py-0 text-xs">
                  {tier}
                </div>

                {/* Player Rows */}
                {sortedPIds.map(pid => {
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
                        <Link
                          to={`/player/${pid}`}
                          className="font-semibold text-slate-900 hover:text-slate-700"
                        >
                          {name}
                        </Link>
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
