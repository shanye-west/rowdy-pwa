import { memo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useSkinsData } from "../hooks/useSkinsData";
import type { SkinType } from "../hooks/useSkinsData";
import { formatTeeTime } from "../utils";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";

function SkinsComponent() {
  const { roundId } = useParams();
  const {
    loading,
    error,
    round,
    tournament,
    skinsEnabled,
    holeSkinsData,
    playerTotals,
  } = useSkinsData(roundId);

  const [selectedTab, setSelectedTab] = useState<SkinType>("gross");
  const [expandedHole, setExpandedHole] = useState<number | null>(null);

  if (loading) {
    return (
      <Layout title="Loading..." showBack>
        <div className="p-5 text-center text-slate-500">Loading skins...</div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Error" showBack>
        <div className="p-5 text-center text-red-600">
          <div className="text-2xl mb-2">⚠️</div>
          <div>{error}</div>
        </div>
      </Layout>
    );
  }

  if (!round || !skinsEnabled) {
    if (!round) {
      return (
        <Layout title="Skins" showBack>
          <div className="empty-state">
            <div className="empty-state-icon">🎯</div>
            <div className="empty-state-text">Round not found</div>
            <Link to="/" className="btn btn-primary mt-4">Go Home</Link>
          </div>
        </Layout>
      );
    }

    return (
      <Layout title="Skins" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">🎯</div>
          <div className="empty-state-text">No skins game configured for this round</div>
        </div>
      </Layout>
    );
  }

  const tName = tournament?.name || "Skins Game";
  const tSeries = tournament?.series;
  const tLogo = tournament?.tournamentLogo;

  const hasGross = (round.skinsGrossPot ?? 0) > 0;
  const hasNet = (round.skinsNetPot ?? 0) > 0;

  // Filter player totals by selected tab
  const leaderboard = playerTotals
    .filter(p => selectedTab === "gross" ? p.grossSkinsWon > 0 : p.netSkinsWon > 0)
    .sort((a, b) => {
      if (selectedTab === "gross") {
        return b.grossSkinsWon - a.grossSkinsWon || b.grossEarnings - a.grossEarnings;
      } else {
        return b.netSkinsWon - a.netSkinsWon || b.netEarnings - a.netEarnings;
      }
    });

  const totalPot = selectedTab === "gross" ? round.skinsGrossPot : round.skinsNetPot;
  const skinsWon = holeSkinsData.filter(h => 
    selectedTab === "gross" ? h.grossWinner !== null : h.netWinner !== null
  ).length;
  const valuePerSkin = skinsWon > 0 ? (totalPot ?? 0) / skinsWon : 0;

  return (
    <Layout title={tName} series={tSeries} showBack tournamentLogo={tLogo}>
      <div style={{ padding: 16, display: "grid", gap: 20 }}>
        
        {/* HEADER */}
        <section className="card" style={{ padding: 20, textAlign: "center" }}>
          <h1 style={{ margin: "0 0 4px 0", fontSize: "1.4rem" }}>
            Skins Game
          </h1>
          <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: 12 }}>
            Round {round.day ?? ""}
          </div>

          {/* TABS */}
          {hasGross && hasNet && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
              <button
                onClick={() => setSelectedTab("gross")}
                className={`px-4 py-2 rounded font-semibold text-sm transition-colors ${
                  selectedTab === "gross"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                }`}
              >
                Gross Skins
              </button>
              <button
                onClick={() => setSelectedTab("net")}
                className={`px-4 py-2 rounded font-semibold text-sm transition-colors ${
                  selectedTab === "net"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                }`}
              >
                Net Skins
              </button>
            </div>
          )}

          {/* POT INFO */}
          <div style={{ marginTop: 16, padding: 12, backgroundColor: "#f1f5f9", borderRadius: 8 }}>
            <div style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.05em" }}>
              Total Pot
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b", marginTop: 4 }}>
              ${totalPot?.toFixed(0)}
            </div>
            {skinsWon > 0 && (
              <div style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 4 }}>
                {skinsWon} skin{skinsWon !== 1 ? "s" : ""} won · ${valuePerSkin.toFixed(2)} per skin
              </div>
            )}
            {skinsWon === 0 && (
              <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: 4 }}>
                No skins won yet
              </div>
            )}
          </div>
        </section>

        {/* LEADERBOARD */}
        <section className="card" style={{ padding: 20 }}>
          <h2 style={{ margin: "0 0 16px 0", fontSize: "1.1rem", fontWeight: 700 }}>
            Leaderboard
          </h2>
          
          {leaderboard.length === 0 ? (
            <div className="empty-state" style={{ padding: "20px 0" }}>
              <div className="empty-state-icon" style={{ fontSize: "2rem" }}>🎯</div>
              <div className="empty-state-text" style={{ fontSize: "0.9rem" }}>
                No skins won yet
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {leaderboard.map((player, idx) => {
                const skinsWon = selectedTab === "gross" ? player.grossSkinsWon : player.netSkinsWon;
                const holes = selectedTab === "gross" ? player.grossHoles : player.netHoles;
                const earnings = selectedTab === "gross" ? player.grossEarnings : player.netEarnings;

                return (
                  <div
                    key={player.playerId}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      gap: 12,
                      alignItems: "center",
                      padding: "12px 16px",
                      backgroundColor: "#f8fafc",
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    {/* Rank */}
                    <div style={{ 
                      fontSize: "1.2rem", 
                      fontWeight: 800, 
                      color: "#64748b",
                      minWidth: 32,
                      textAlign: "center"
                    }}>
                      {idx + 1}
                    </div>

                    {/* Player Info */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1e293b" }}>
                        {player.playerName}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 2 }}>
                        {skinsWon} skin{skinsWon !== 1 ? "s" : ""} · Hole{holes.length !== 1 ? "s" : ""} {holes.join(", ")}
                      </div>
                    </div>

                    {/* Earnings */}
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#16a34a" }}>
                        ${earnings.toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* HOLE BREAKDOWN */}
        <section className="card" style={{ padding: 20 }}>
          <h2 style={{ margin: "0 0 16px 0", fontSize: "1.1rem", fontWeight: 700 }}>
            Hole-by-Hole Results
          </h2>

          <div style={{ display: "grid", gap: 10 }}>
            {holeSkinsData.map(hole => {
              const isExpanded = expandedHole === hole.holeNumber;
              const winner = selectedTab === "gross" ? hole.grossWinner : hole.netWinner;
              const lowScore = selectedTab === "gross" ? hole.grossLowScore : hole.netLowScore;
              const par = hole.par;
              const scoreLabel = (score: number | null, parVal: number) => {
                if (score === null) return "";
                const diff = score - parVal;
                if (diff === 0) return "Par";
                if (diff === -1) return "Birdie";
                if (diff === -2) return "Eagle";
                if (diff === -3) return "Albatross";
                if (diff === 1) return "Bogey";
                if (diff === 2) return "Double Bogey";
                if (diff === 3) return "Triple Bogey";
                if (diff < -3) return `${Math.abs(diff)} under par`;
                return `${diff} over par`;
              };
              const tiedCount = selectedTab === "gross" ? hole.grossTiedCount : hole.netTiedCount;
              
              let winnerText = "—";
              if (lowScore !== null) {
                if (winner) {
                  const playerName = hole.allScores.find(s => s.playerId === winner)?.playerName || winner;
                  winnerText = playerName;
                } else if (tiedCount > 1) {
                  winnerText = `${tiedCount} players tied`;
                }
              }

              // Emphasize only on the collapsed hole header when there is a single outright winner
              const allPlayersCompleted = hole.allPlayersCompleted;
              const isHoleWinner = !!winner && lowScore !== null;

              return (
                <div
                  key={hole.holeNumber}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    overflow: "hidden",
                    backgroundColor: allPlayersCompleted ? "#f0fdf4" : "#ffffff",
                  }}
                >
                  {/* Hole Header (clickable) */}
                  <button
                    onClick={() => setExpandedHole(isExpanded ? null : hole.holeNumber)}
                    style={{
                      width: "100%",
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto auto",
                      gap: 12,
                      alignItems: "center",
                      padding: "12px 16px",
                      backgroundColor: allPlayersCompleted ? "#dcfce7" : "#f8fafc",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {/* Hole Number */}
                    <div style={{ 
                      fontSize: "0.9rem", 
                      fontWeight: 700, 
                      color: "#64748b",
                      minWidth: 40
                    }}>
                      Hole {hole.holeNumber}
                    </div>

                    {/* Winner */}
                    <div style={isHoleWinner ? { fontSize: "0.95rem", fontWeight: 800, color: "#1e293b" } : { fontSize: "0.85rem", color: "#1e293b" }}>
                      {winnerText}
                    </div>

                    {/* Score */}
                    {lowScore !== null && (
                      <div style={{ 
                        fontSize: "0.9rem", 
                        fontWeight: 700, 
                        color: allPlayersCompleted ? "#16a34a" : "#64748b"
                      }}>
                        {scoreLabel(lowScore, par)}
                      </div>
                    )}

                    {/* Expand Icon */}
                    <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                      {isExpanded ? "▼" : "▶"}
                    </div>
                  </button>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div style={{ padding: "12px 16px", backgroundColor: "#ffffff" }}>
                      <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 8, fontWeight: 600 }}>
                        All Scores (Par {hole.par})
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {(() => {
                          const sorted = [...hole.allScores].sort((a, b) => {
                            const aStarted = a.playerThru > 0 || (selectedTab === "gross" ? a.gross !== null : a.net !== null);
                            const bStarted = b.playerThru > 0 || (selectedTab === "gross" ? b.gross !== null : b.net !== null);

                            // If one started and the other not, the started player comes first
                            if (aStarted && !bStarted) return -1;
                            if (!aStarted && bStarted) return 1;

                            // Both started: sort by score (lowest first)
                            if (aStarted && bStarted) {
                              const aVal = selectedTab === "gross" ? a.gross ?? Number.POSITIVE_INFINITY : a.net ?? Number.POSITIVE_INFINITY;
                              const bVal = selectedTab === "gross" ? b.gross ?? Number.POSITIVE_INFINITY : b.net ?? Number.POSITIVE_INFINITY;
                              if (aVal !== bVal) return aVal - bVal;
                              return a.playerName.localeCompare(b.playerName);
                            }

                            // Both not started: sort by tee time (earliest first)
                            const aT = a.playerTeeTime ? (a.playerTeeTime.toDate ? a.playerTeeTime.toDate().getTime() : new Date(a.playerTeeTime).getTime()) : null;
                            const bT = b.playerTeeTime ? (b.playerTeeTime.toDate ? b.playerTeeTime.toDate().getTime() : new Date(b.playerTeeTime).getTime()) : null;

                            if (aT !== null && bT !== null) return aT - bT;
                            if (aT !== null && bT === null) return -1;
                            if (aT === null && bT !== null) return 1;

                            // Fallback to name
                            return a.playerName.localeCompare(b.playerName);
                          });

                          return sorted.map(score => {
                            const displayScore = selectedTab === "gross" ? score.gross : score.net;
                            const isWinner = score.playerId === winner;

                            return (
                              <div
                                key={score.playerId}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr auto",
                                  gap: 8,
                                  padding: "6px 12px",
                                  backgroundColor: isWinner ? "#dcfce7" : "#f8fafc",
                                  borderRadius: 4,
                                  border: isWinner ? "1px solid #86efac" : "1px solid #e2e8f0",
                                }}
                              >
                                <div style={{ fontSize: "0.85rem", color: "#1e293b" }}>
                                  {score.playerName}
                                  {selectedTab === "net" && score.hasStroke && (
                                    <span style={{ marginLeft: 4, fontSize: "0.7rem", color: "#3b82f6" }}>●</span>
                                  )}
                                </div>
                                <div style={{ 
                                  fontSize: "0.85rem", 
                                  fontWeight: 600,
                                  color: displayScore === null ? "#cbd5e1" : "#1e293b"
                                }}>
                                  {displayScore !== null ? (
                                    displayScore
                                  ) : (
                                    // If player hasn't started (thru === 0), show tee time when available
                                    score.playerThru === 0 && score.playerTeeTime
                                      ? formatTeeTime(score.playerTeeTime)
                                      : `Thru ${score.playerThru}`
                                  )}
                                </div>
                              </div>
                            );
                          })
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <LastUpdated />
      </div>
    </Layout>
  );
}

export default memo(SkinsComponent);
