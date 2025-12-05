import { memo } from "react";
import { useParams, Link } from "react-router-dom";
import { useRoundData } from "../hooks/useRoundData";
import { formatRoundType } from "../utils";
import { getPlayerShortName as getPlayerShortNameFromLookup } from "../utils/playerHelpers";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import OfflineImage from "../components/OfflineImage";
import { MatchStatusBadge, getMatchCardStyles } from "../components/MatchStatusBadge";
import { RoundPageSkeleton } from "../components/Skeleton";

function RoundComponent() {
  const { roundId } = useParams();
  
  const {
    loading,
    error,
    round,
    tournament,
    course,
    matches,
    players,
    stats: { finalTeamA: fA, finalTeamB: fB, projectedTeamA: pA, projectedTeamB: pB },
  } = useRoundData(roundId);

  // Alias stats for template compatibility
  const stats = { fA, fB, pA, pB };

  // Use shared player helper - this returns short name format (F. LastName)
  const getPlayerShortName = (pid: string) => getPlayerShortNameFromLookup(pid, players);

  if (loading) return (
    <Layout title="Loading..." showBack>
      <RoundPageSkeleton />
    </Layout>
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
                <OfflineImage 
                  src={tournament?.teamA?.logo} 
                  alt={tournament?.teamA?.name || "Team A"}
                  fallbackIcon="🔵"
                  style={{ width: 40, height: 40, objectFit: "contain", marginBottom: 6 }}
                />
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
                <OfflineImage 
                  src={tournament?.teamB?.logo} 
                  alt={tournament?.teamB?.name || "Team B"}
                  fallbackIcon="🔴"
                  style={{ width: 40, height: 40, objectFit: "contain", marginBottom: 6 }}
                />
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
        <section style={{ display: "grid", gap: 12 }} role="list" aria-label="Matches">
          {matches.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-text">No matches scheduled.</div>
            </div>
          ) : (
            matches.map((m) => {
              const teamAColor = tournament?.teamA?.color || "var(--team-a-default)";
              const teamBColor = tournament?.teamB?.color || "var(--team-b-default)";
              const { bgStyle, borderStyle, textColor } = getMatchCardStyles(
                m.status,
                m.result,
                teamAColor,
                teamBColor
              );

              // Build player names for aria-label
              const teamANames = (m.teamAPlayers || []).map(p => getPlayerShortName(p.playerId)).join(", ");
              const teamBNames = (m.teamBPlayers || []).map(p => getPlayerShortName(p.playerId)).join(", ");

              return (
                <Link 
                  key={m.id} 
                  to={`/match/${m.id}`} 
                  className="card card-hover"
                  role="listitem"
                  aria-label={`Match: ${teamANames} vs ${teamBNames}`}
                  style={{ 
                    display: "grid", 
                    gridTemplateColumns: "1fr auto 1fr",
                    gap: 12,
                    alignItems: "center",
                    ...bgStyle,
                    ...borderStyle,
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

                  {/* Center: Status */}
                  <MatchStatusBadge
                    status={m.status}
                    result={m.result}
                    teamAColor={teamAColor}
                    teamBColor={teamBColor}
                    teamAName={tournament?.teamA?.name}
                    teamBName={tournament?.teamB?.name}
                  />

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

export default memo(RoundComponent);