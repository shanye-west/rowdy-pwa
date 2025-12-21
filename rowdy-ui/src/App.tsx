import { Link } from "react-router-dom";
import { useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useTournamentData } from "./hooks/useTournamentData";
import Layout from "./components/Layout";
import LastUpdated from "./components/LastUpdated";
import ScoreBlock from "./components/ScoreBlock";
import ScoreTrackerBar from "./components/ScoreTrackerBar";
import OfflineImage from "./components/OfflineImage";
import { formatRoundType } from "./utils";

export default function App() {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  
  // PWA update handler
  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      setShowUpdatePrompt(true);
    },
    onRegisteredSW(swUrl: string, r: ServiceWorkerRegistration | undefined) {
      console.log("Service Worker registered:", swUrl);
      // Check for updates every 60 seconds
      if (r) {
        setInterval(() => {
          r.update();
        }, 60000);
      }
    },
  });

  const handleUpdateClick = () => {
    setShowUpdatePrompt(false);
    updateServiceWorker(true);
  };

  const {
    loading,
    tournament,
    rounds,
    coursesByRound,
    stats,
    roundStats,
    totalPointsAvailable,
  } = useTournamentData({ fetchActive: true });

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="spinner-lg"></div>
    </div>
  );

  const tName = tournament?.name || "Rowdy Cup";
  const tSeries = tournament?.series; // "rowdyCup" or "christmasClassic"
  const tLogo = tournament?.tournamentLogo;
  const pointsToWin = totalPointsAvailable ? (totalPointsAvailable / 2 + 0.5) : null;
  const pointsToWinDisplay = pointsToWin !== null ? (Number.isInteger(pointsToWin) ? String(pointsToWin) : pointsToWin.toFixed(1)) : "";

  return (
    <Layout title={tName} series={tSeries} tournamentLogo={tLogo}>
      {!tournament ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏌️</div>
          <div className="empty-state-text">No active tournament found.</div>
        </div>
      ) : (
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
              Total Score
            </h2>

            {/* Score Tracker Bar (above logos) */}
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
                <Link to="/teams?team=A">
                  <OfflineImage 
                    src={tournament.teamA?.logo} 
                    alt={tournament.teamA?.name || "Team A"}
                    fallbackIcon="🔵"
                    style={{ width: 48, height: 48, objectFit: "contain", marginBottom: 8, cursor: "pointer" }}
                  />
                </Link>
                <div style={{ 
                  fontWeight: 800, 
                  color: tournament.teamA?.color || "var(--team-a-default)", 
                  fontSize: "1.1rem", 
                  marginBottom: 4 
                }}>
                  {tournament.teamA?.name || "Team A"}
                </div>
                <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1, position: 'relative', display: 'inline-block' }}>
                  <span style={{ color: tournament.teamA?.color || "var(--team-a-default)" }}>{stats.teamAConfirmed}</span>
                </div>
              </div>

              {/* Center spacer (midpoint marker moved into ScoreTrackerBar) */}
              <div style={{ height: 40, width: 2 }}></div>

              {/* Team B */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Link to="/teams?team=B">
                  <OfflineImage 
                    src={tournament.teamB?.logo} 
                    alt={tournament.teamB?.name || "Team B"}
                    fallbackIcon="🔴"
                    style={{ width: 48, height: 48, objectFit: "contain", marginBottom: 8, cursor: "pointer" }}
                  />
                </Link>
                <div style={{ 
                  fontWeight: 800, 
                  color: tournament.teamB?.color || "var(--team-b-default)", 
                  fontSize: "1.1rem", 
                  marginBottom: 4 
                }}>
                  {tournament.teamB?.name || "Team B"}
                </div>
                <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1, position: 'relative', display: 'inline-block' }}>
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
              Schedule
            </h3>
            
            {rounds.map((r, idx) => {
              const rs = roundStats[r.id];
              const course = coursesByRound[r.id];
              // Get course name only (no tees) for round tiles
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
      )}

      {/* PWA Update Prompt */}
      {showUpdatePrompt && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            maxWidth: "90%",
            width: "400px",
          }}
        >
          <div
            className="card"
            style={{
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              backgroundColor: "var(--brand-primary, #1e40af)",
              color: "white",
              boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Update Available</div>
              <div style={{ fontSize: "0.85rem", opacity: 0.9 }}>
                A new version is ready. Reload to update.
              </div>
            </div>
            <button
              onClick={handleUpdateClick}
              className="btn btn-primary"
              style={{
                padding: "8px 16px",
                backgroundColor: "white",
                color: "var(--brand-primary, #1e40af)",
                fontWeight: 600,
              }}
            >
              Reload
            </button>
            <button
              onClick={() => setShowUpdatePrompt(false)}
              style={{
                padding: "8px",
                background: "none",
                border: "none",
                color: "white",
                cursor: "pointer",
                opacity: 0.7,
              }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}