import { memo } from "react";
import { Link, useParams } from "react-router-dom";
import { useTournamentData } from "../hooks/useTournamentData";
import Layout from "../components/Layout";
import TeamName from "../components/TeamName";
import LastUpdated from "../components/LastUpdated";
import ScoreBlock from "../components/ScoreBlock";
import ScoreTrackerBar from "../components/ScoreTrackerBar";
import OfflineImage from "../components/OfflineImage";
import { formatRoundType } from "../utils";
// RedirectCountdown removed; show Go Home button instead

/**
 * Tournament detail page for viewing historical (archived) tournaments.
 * This is a read-only view - no score editing allowed.
 */
function TournamentComponent() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  
  const {
    loading,
    tournament,
    rounds,
    coursesByRound,
    stats,
    roundStats,
    totalPointsAvailable,
  } = useTournamentData({ tournamentId });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner-lg"></div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <Layout title="Tournament" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-text">Tournament not found.</div>
          <Link to="/" className="btn btn-primary mt-4">Go Home</Link>
        </div>
      </Layout>
    );
  }
  const tName = tournament?.name || "Tournament";
  const tSeries = tournament?.series;
  const tLogo = tournament?.tournamentLogo;
  const teamLinkA = `/teams?tournamentId=${encodeURIComponent(tournament.id)}&team=A`;
  const teamLinkB = `/teams?tournamentId=${encodeURIComponent(tournament.id)}&team=B`;
  const pointsToWin = totalPointsAvailable ? (totalPointsAvailable / 2 + 0.5) : null;
  const pointsToWinDisplay = pointsToWin !== null ? (Number.isInteger(pointsToWin) ? String(pointsToWin) : pointsToWin.toFixed(1)) : "";

  return (
    <Layout title={tName} series={tSeries} showBack tournamentLogo={tLogo}>
      <div style={{ padding: 16, display: "grid", gap: 24 }}>
        
        {/* HERO SCOREBOARD */}
        <section className="card" style={{ textAlign: 'center', padding: 24 }}>
          <h2 style={{ 
            margin: "0 0 6px 0", 
            fontSize: "0.85rem", 
            color: "var(--text-secondary)", 
            textTransform: "uppercase", 
            letterSpacing: "0.1em" 
          }}>
            Final Score
          </h2>

          {/* Score Tracker Bar */}
          {totalPointsAvailable > 0 && (
            <div style={{ margin: "4px 0 16px 0" }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                {pointsToWinDisplay} points needed to win
              </div>
              <ScoreTrackerBar
                totalPoints={totalPointsAvailable}
                teamAConfirmed={stats.teamAConfirmed}
                teamBConfirmed={stats.teamBConfirmed}
                teamAPending={stats.teamAPending}
                teamBPending={stats.teamBPending}
                teamAColor={tournament.teamA?.color}
                teamBColor={tournament.teamB?.color}
              />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center" }}>
            {/* Team A */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Link to={teamLinkA} aria-label="View Team A roster">
                <OfflineImage 
                  src={tournament.teamA?.logo} 
                  alt={tournament.teamA?.name || "Team A"}
                  fallbackIcon="🔵"
                  style={{ width: 48, height: 48, objectFit: "contain", marginBottom: 8 }}
                />
              </Link>
              <div style={{ 
                fontWeight: 800, 
                color: tournament.teamA?.color || "var(--team-a-default)", 
                fontSize: "1.1rem", 
                marginBottom: 4 
              }}>
                <TeamName name={tournament.teamA?.name || "Team A"} variant="inline" maxFontPx={14} minFontPx={10} style={{ color: tournament.teamA?.color || "var(--team-a-default)", marginBottom: 4 }} />
              </div>
              <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1 }}>
                <span style={{ color: tournament.teamA?.color || "var(--team-a-default)" }}>{stats.teamAConfirmed}</span>
              </div>
            </div>

            {/* Center spacer */}
            <div style={{ height: 40, width: 2 }}></div>

            {/* Team B */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Link to={teamLinkB} aria-label="View Team B roster">
                <OfflineImage 
                  src={tournament.teamB?.logo} 
                  alt={tournament.teamB?.name || "Team B"}
                  fallbackIcon="🔴"
                  style={{ width: 48, height: 48, objectFit: "contain", marginBottom: 8 }}
                />
              </Link>
              <div style={{ 
                fontWeight: 800, 
                color: tournament.teamB?.color || "var(--team-b-default)", 
                fontSize: "1.1rem", 
                marginBottom: 4 
              }}>
                <TeamName name={tournament.teamB?.name || "Team B"} variant="inline" maxFontPx={14} minFontPx={10} style={{ color: tournament.teamB?.color || "var(--team-b-default)", marginBottom: 4 }} />
              </div>
              <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1 }}>
                <span style={{ color: tournament.teamB?.color || "var(--team-b-default)" }}>{stats.teamBConfirmed}</span>
              </div>
            </div>
          </div>
        </section>

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
            Rounds
          </h3>
          
          {rounds.map((r, idx) => {
            const rs = roundStats[r.id];
            const course = coursesByRound[r.id];
            const courseName = course?.name || r.course?.name;
            
            return (
              <Link 
                key={r.id} 
                to={`/round/${r.id}`} 
                className="card card-hover"
                style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12 }}
              >
                {/* Team A - Left */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <OfflineImage 
                    src={tournament.teamA?.logo} 
                    alt={tournament.teamA?.name || "Team A"}
                    fallbackIcon="🔵"
                    style={{ width: 28, height: 28, objectFit: "contain" }}
                  />
                  <span style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
                    <ScoreBlock
                      final={rs?.teamAConfirmed ?? 0}
                      proj={rs?.teamAPending ?? 0}
                      color={tournament.teamA?.color}
                    />
                  </span>
                </div>

                {/* Round Info - Center */}
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 2 }}>Round {idx + 1}</div>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{formatRoundType(r.format)}</div>
                  {courseName && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 2 }}>{courseName}</div>
                  )}
                </div>

                {/* Team B - Right */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>  
                  <span style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
                    <ScoreBlock
                      final={rs?.teamBConfirmed ?? 0}
                      proj={rs?.teamBPending ?? 0}
                      color={tournament.teamB?.color}
                      projLeft
                    />
                  </span>
                  <OfflineImage 
                    src={tournament.teamB?.logo} 
                    alt={tournament.teamB?.name || "Team B"}
                    fallbackIcon="🔴"
                    style={{ width: 28, height: 28, objectFit: "contain" }}
                  />
                </div>
              </Link>
            );
          })}
        </section>

        <LastUpdated />
      </div>
    </Layout>
  );
}

export default memo(TournamentComponent);
