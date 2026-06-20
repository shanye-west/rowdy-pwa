import { useEffect, useState, useMemo } from "react";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import LoadingScreen from "../components/LoadingScreen";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import OfflineImage from "../components/OfflineImage";
import { getTournamentWinner } from "../utils";
// TeamName removed from history list (only logos shown)
import type { TournamentDoc, RoundDoc } from "../types";

type TournamentWinner = { winnerKey: "teamA" | "teamB"; viaTiebreaker: boolean } | null;

type TournamentSeries = "rowdyCup" | "christmasClassic";

const SERIES_CONFIG: Record<TournamentSeries, { label: string; icon: string; color: string }> = {
  // Use public assets for series logos
  rowdyCup: { label: "Rowdy Cup", icon: "/images/rc-logo.png", color: "var(--brand-primary)" },
  christmasClassic: { label: "Christmas Classic", icon: "/images/rowdycup-logo-christmas.svg", color: "#dc2626" },
};

export default function History() {
  const [loading, setLoading] = useState(true);
  const [tournaments, setTournaments] = useState<TournamentDoc[]>([]);
  const [winnersByTournament, setWinnersByTournament] = useState<Record<string, TournamentWinner>>({});
  const [selectedSeries, setSelectedSeries] = useState<TournamentSeries>("rowdyCup");

  // Fetch all non-active tournaments (one-time read - historical data doesn't change)
  useEffect(() => {
    let cancelled = false;
    
    async function fetchHistory() {
      try {
        const snap = await getDocs(
          query(
            collection(db, "tournaments"),
            where("active", "==", false),
            orderBy("year", "desc"),
            limit(20)
          )
        );
        if (cancelled) return;
        
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as TournamentDoc));
        // Filter out test tournaments (they should not appear in History)
        const publicTournaments = docs.filter(t => t.test !== true);
        // Already sorted by query orderBy
        setTournaments(publicTournaments);
      } catch (err) {
        console.error("History fetch error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    
    fetchHistory();
    return () => { cancelled = true; };
  }, []);

  // Determine each tournament's champion from denormalized round point totals.
  // Historical data is static, so a one-time read is fine; we batch all listed
  // tournaments into `in` queries (Firestore caps `in` at 30 values) so this is
  // a couple of reads rather than one per tournament.
  useEffect(() => {
    if (tournaments.length === 0) return;
    let cancelled = false;

    async function fetchWinners() {
      try {
        const ids = tournaments.map(t => t.id);
        const batches: string[][] = [];
        for (let i = 0; i < ids.length; i += 30) batches.push(ids.slice(i, i + 30));

        // Accumulate confirmed points + available points per tournament.
        const acc: Record<string, { aConf: number; bConf: number; totalPts: number }> = {};
        for (const t of tournaments) acc[t.id] = { aConf: 0, bConf: 0, totalPts: 0 };

        await Promise.all(batches.map(async (batch) => {
          const snap = await getDocs(
            query(collection(db, "rounds"), where("tournamentId", "in", batch))
          );
          snap.docs.forEach(d => {
            const r = { id: d.id, ...d.data() } as RoundDoc;
            const bucket = r.tournamentId ? acc[r.tournamentId] : undefined;
            const pt = r.pointTotals;
            if (!bucket || !pt) return;
            bucket.aConf += pt.teamAConfirmed;
            bucket.bConf += pt.teamBConfirmed;
            bucket.totalPts += (r.pointsValue ?? 1) * (pt.matchCount ?? 0);
          });
        }));

        if (cancelled) return;

        const winners: Record<string, TournamentWinner> = {};
        for (const t of tournaments) {
          const a = acc[t.id];
          const totalPts = t.totalPointsAvailable ?? a.totalPts;
          winners[t.id] = getTournamentWinner(t.tiebreakerWinner, a.aConf, a.bConf, totalPts);
        }
        setWinnersByTournament(winners);
      } catch (err) {
        console.error("History winners fetch error:", err);
      }
    }

    fetchWinners();
    return () => { cancelled = true; };
  }, [tournaments]);

  // Filter tournaments by selected series
  const filteredTournaments = useMemo(() => {
    return tournaments.filter(t => t.series === selectedSeries);
  }, [tournaments, selectedSeries]);

  // Get available series (ones that have at least one tournament)
  const availableSeries = useMemo(() => {
    const seriesSet = new Set(tournaments.map(t => t.series).filter(Boolean));
    return Object.keys(SERIES_CONFIG).filter(s => seriesSet.has(s)) as TournamentSeries[];
  }, [tournaments]);

  if (loading) {
    return (
      <LoadingScreen />
    );
  }

  return (
    <Layout title="History" showBack>
      <div style={{ padding: 16, display: "grid", gap: 16, maxWidth: 800, margin: "0 auto" }}>
        
        {/* Series Selector Tabs */}
        {availableSeries.length > 1 && (
          <div 
            style={{ 
              display: "grid", 
              // Make tabs equal-width
              gridTemplateColumns: `repeat(${availableSeries.length}, 1fr)`, 
              borderRadius: 12, 
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              border: "1px solid var(--divider)",
            }}
          >
            {availableSeries.map((series, idx) => {
              const config = SERIES_CONFIG[series];
              const isSelected = selectedSeries === series;
              
              return (
                <button
                  key={series}
                  onClick={() => setSelectedSeries(series)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "12px 10px",
                    border: "none",
                    borderLeft: idx > 0 ? "1px solid var(--divider)" : "none",
                    cursor: "pointer",
                    background: isSelected
                      ? `color-mix(in srgb, ${config.color} 15%, var(--card-bg))`
                      : "var(--card-bg)",
                    borderBottom: isSelected ? `3px solid ${config.color}` : "3px solid transparent",
                    transition: "all 0.2s ease",
                  }}
                >
                  <OfflineImage
                    src={config.icon}
                    alt={config.label}
                    fallbackIcon={series === "rowdyCup" ? "🏆" : "🎄"}
                    style={{ width: 36, height: 36, objectFit: "contain" }}
                  />
                  <span style={{ 
                    fontWeight: 700, 
                    fontSize: "0.95rem",
                    color: isSelected ? config.color : "var(--text-secondary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                    whiteSpace: "nowrap",
                  }}>
                    {config.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Single series header when only one exists */}
        {availableSeries.length === 1 && (
          <div 
            style={{ 
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "14px 12px",
              borderRadius: 12,
              background: `color-mix(in srgb, ${SERIES_CONFIG[availableSeries[0]].color} 15%, var(--card-bg))`,
              border: "1px solid var(--divider)",
            }}
          >
            <OfflineImage
              src={SERIES_CONFIG[availableSeries[0]].icon}
              alt={SERIES_CONFIG[availableSeries[0]].label}
              fallbackIcon={availableSeries[0] === "rowdyCup" ? "🏆" : "🎄"}
              style={{ width: 28, height: 28, objectFit: "contain" }}
            />
            <span style={{ 
              fontWeight: 700, 
              fontSize: "0.95rem",
              color: SERIES_CONFIG[availableSeries[0]].color,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              whiteSpace: "nowrap",
            }}>
              {SERIES_CONFIG[availableSeries[0]].label}
            </span>
          </div>
        )}

        {/* No past tournaments */}
        {availableSeries.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">📜</div>
            <div className="empty-state-text">No past tournaments found.</div>
          </div>
        )}

        {/* Tournament List */}
        {filteredTournaments.length === 0 && availableSeries.length > 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📜</div>
            <div className="empty-state-text">No past tournaments found for this series.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {filteredTournaments.map(t => {
              const winner = winnersByTournament[t.id];
              // Golden halo tracing the logo silhouette — no clipping box.
              const championGlow = {
                filter: "drop-shadow(0 0 6px rgba(251,191,36,0.95)) drop-shadow(0 0 14px rgba(245,158,11,0.5))",
              };
              return (
              <ViewTransitionLink
                key={t.id}
                to={`/tournament/${t.id}`}
                className="card card-hover"
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  alignItems: "center",
                  gap: 12,
                  padding: "16px 20px",
                }}
              >
                {/* Team A - show only logo (bigger) */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <OfflineImage
                    src={t.teamA?.logo}
                    alt={t.teamA?.name || "Team A"}
                    fallbackIcon="🔵"
                    loading="lazy"
                    width={56}
                    height={56}
                    style={{ width: 56, height: 56, objectFit: "contain", ...(winner?.winnerKey === "teamA" ? championGlow : {}) }}
                  />
                  {winner?.winnerKey === "teamA" && (
                    <span style={{ fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b45309" }}>
                      🏆 Champs
                    </span>
                  )}
                </div>

                {/* Year / Name */}
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 800, fontSize: "1.3rem", color: "var(--text-primary)" }}>
                    {t.year}
                  </div>
                  {t.name && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 2 }}>
                      {t.name}
                    </div>
                  )}
                </div>

                {/* Team B - show only logo (bigger) */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <OfflineImage
                    src={t.teamB?.logo}
                    alt={t.teamB?.name || "Team B"}
                    fallbackIcon="🔴"
                    loading="lazy"
                    width={56}
                    height={56}
                    style={{ width: 56, height: 56, objectFit: "contain", ...(winner?.winnerKey === "teamB" ? championGlow : {}) }}
                  />
                  {winner?.winnerKey === "teamB" && (
                    <span style={{ fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b45309" }}>
                      🏆 Champs
                    </span>
                  )}
                </div>
              </ViewTransitionLink>
              );
            })}
          </div>
        )}

        <LastUpdated />
      </div>
    </Layout>
  );
}
