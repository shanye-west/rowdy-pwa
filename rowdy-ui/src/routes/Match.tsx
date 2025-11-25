import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot, getDoc, updateDoc, getDocs, collection, where, query, documentId } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, PlayerDoc, MatchDoc, RoundDoc, RoundFormat } from "../types";
import { formatMatchStatus } from "../utils";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";

export default function Match() {
  const { matchId } = useParams();
  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  const [loading, setLoading] = useState(true);

  // 1. Listen to MATCH
  useEffect(() => {
    if (!matchId) return;
    setLoading(true);

    const unsub = onSnapshot(doc(db, "matches", matchId), (mSnap) => {
      if (!mSnap.exists()) { setMatch(null); setLoading(false); return; }
      
      const mData = { id: mSnap.id, ...(mSnap.data() as any) } as MatchDoc;
      setMatch(mData);

      // Load players 
      const ids = Array.from(new Set([
        ...(mData.teamAPlayers || []).map((p) => p.playerId).filter(Boolean),
        ...(mData.teamBPlayers || []).map((p) => p.playerId).filter(Boolean),
      ]));
      
      if (ids.length === 0) {
        setLoading(false);
        return;
      }

      const fetchPlayers = async () => {
        const batches = [];
        for (let i = 0; i < ids.length; i += 10) batches.push(ids.slice(i, i + 10));
        
        const newPlayers: Record<string, PlayerDoc> = {};
        for (const batch of batches) {
            const q = query(collection(db, "players"), where(documentId(), "in", batch));
            const snap = await getDocs(q);
            snap.forEach(d => { newPlayers[d.id] = { id: d.id, ...d.data() } as PlayerDoc; });
        }
        setPlayers(prev => ({ ...prev, ...newPlayers }));
      };

      fetchPlayers().finally(() => setLoading(false));
    });

    return () => unsub();
  }, [matchId]);

  // 2. Listen to ROUND
  useEffect(() => {
    if (!match?.roundId) return;
    const unsub = onSnapshot(doc(db, "rounds", match.roundId), async (rSnap) => {
      if (rSnap.exists()) {
        const rData = { id: rSnap.id, ...(rSnap.data() as any) } as RoundDoc;
        setRound(rData);
        if (rData.tournamentId) {
            const tSnap = await getDoc(doc(db, "tournaments", rData.tournamentId));
            if (tSnap.exists()) {
                setTournament({ id: tSnap.id, ...(tSnap.data() as any) } as TournamentDoc);
            }
        }
      }
    });
    return () => unsub();
  }, [match?.roundId]);

  const format: RoundFormat = (round?.format as RoundFormat) || "twoManBestBall";
  
  // --- LOCKING LOGIC ---
  const roundLocked = !!round?.locked;
  const isMatchClosed = !!match?.status?.closed;
  const matchThru = match?.status?.thru ?? 0;

  // Build holes data
  const holes = useMemo(() => {
    const hMatch = match?.holes || {};
    const hCourse = round?.course?.holes || [];
    return Array.from({ length: 18 }, (_, i) => {
      const num = i + 1;
      const k = String(num);
      const info = hCourse.find(h => h.number === num);
      return { k, num, input: hMatch[k]?.input || {}, par: info?.par ?? 4, hcpIndex: info?.hcpIndex };
    });
  }, [match, round]);

  // Calculate totals
  const totals = useMemo(() => {
    const front = holes.slice(0, 9);
    const back = holes.slice(9, 18);
    
    const sumPar = (arr: typeof holes) => arr.reduce((s, h) => s + (h.par || 0), 0);
    
    const getScore = (h: typeof holes[0], team: "A" | "B", pIdx: number) => {
      if (format === "twoManScramble") {
        return team === "A" ? h.input?.teamAGross : h.input?.teamBGross;
      }
      if (format === "singles") {
        return team === "A" ? h.input?.teamAPlayerGross : h.input?.teamBPlayerGross;
      }
      // Best Ball / Shamble
      const arr = team === "A" ? h.input?.teamAPlayersGross : h.input?.teamBPlayersGross;
      return Array.isArray(arr) ? arr[pIdx] : null;
    };

    const sumScores = (arr: typeof holes, team: "A" | "B", pIdx: number) => {
      let total = 0;
      let hasAny = false;
      arr.forEach(h => {
        const v = getScore(h, team, pIdx);
        if (v != null) { total += v; hasAny = true; }
      });
      return hasAny ? total : null;
    };

    return {
      parOut: sumPar(front),
      parIn: sumPar(back),
      parTotal: sumPar(holes),
      // For each player position
      getOut: (team: "A" | "B", pIdx: number) => sumScores(front, team, pIdx),
      getIn: (team: "A" | "B", pIdx: number) => sumScores(back, team, pIdx),
      getTotal: (team: "A" | "B", pIdx: number) => sumScores(holes, team, pIdx),
    };
  }, [holes, format]);

  function getInitials(pid?: string) {
    if (!pid) return "P";
    const p = players[pid];
    if (!p) return "?";
    if (p.displayName) {
      const parts = p.displayName.split(" ");
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      return p.displayName.slice(0, 2).toUpperCase();
    }
    return (p.username || "??").slice(0, 2).toUpperCase();
  }

  function hasStroke(team: "A" | "B", pIdx: number, holeIdx: number) {
    const roster = team === "A" ? match?.teamAPlayers : match?.teamBPlayers;
    return (roster?.[pIdx]?.strokesReceived?.[holeIdx] ?? 0) > 0;
  }

  // For twoManBestBall: get the team's low net score for a hole
  function getTeamLowNet(hole: typeof holes[0], team: "A" | "B"): number | null {
    if (format !== "twoManBestBall") return null;
    
    const { input } = hole;
    const holeIdx = hole.num - 1;
    const arr = team === "A" ? input?.teamAPlayersGross : input?.teamBPlayersGross;
    
    if (!Array.isArray(arr)) return null;
    
    const p0Gross = arr[0];
    const p1Gross = arr[1];
    
    // Calculate net scores
    const roster = team === "A" ? match?.teamAPlayers : match?.teamBPlayers;
    const p0Stroke = (roster?.[0]?.strokesReceived?.[holeIdx] ?? 0) > 0 ? 1 : 0;
    const p1Stroke = (roster?.[1]?.strokesReceived?.[holeIdx] ?? 0) > 0 ? 1 : 0;
    
    const p0Net = p0Gross != null ? p0Gross - p0Stroke : null;
    const p1Net = p1Gross != null ? p1Gross - p1Stroke : null;
    
    // Return the lower net score
    if (p0Net == null && p1Net == null) return null;
    if (p0Net == null) return p1Net;
    if (p1Net == null) return p0Net;
    return Math.min(p0Net, p1Net);
  }

  // Calculate team totals for low net (for OUT/IN/TOT columns)
  const teamLowNetTotals = useMemo(() => {
    if (format !== "twoManBestBall") return null;
    
    const front = holes.slice(0, 9);
    const back = holes.slice(9, 18);
    
    const sumLowNet = (arr: typeof holes, team: "A" | "B") => {
      let total = 0;
      let hasAny = false;
      arr.forEach(h => {
        const v = getTeamLowNet(h, team);
        if (v != null) { total += v; hasAny = true; }
      });
      return hasAny ? total : null;
    };
    
    return {
      getOut: (team: "A" | "B") => sumLowNet(front, team),
      getIn: (team: "A" | "B") => sumLowNet(back, team),
      getTotal: (team: "A" | "B") => sumLowNet(holes, team),
    };
  }, [holes, format, match]);

  async function saveHole(k: string, nextInput: any) {
    if (!match?.id || roundLocked) return;
    try {
      await updateDoc(doc(db, "matches", match.id), { [`holes.${k}.input`]: nextInput });
    } catch (e) {
      console.error("Save failed", e);
    }
  }

  // Get current value for a cell
  function getCellValue(hole: typeof holes[0], team: "A" | "B", pIdx: number): number | "" {
    const { input } = hole;
    if (format === "twoManScramble") {
      const v = team === "A" ? input?.teamAGross : input?.teamBGross;
      return v ?? "";
    }
    if (format === "singles") {
      const v = team === "A" ? input?.teamAPlayerGross : input?.teamBPlayerGross;
      return v ?? "";
    }
    // Best Ball / Shamble
    const arr = team === "A" ? input?.teamAPlayersGross : input?.teamBPlayersGross;
    return Array.isArray(arr) ? (arr[pIdx] ?? "") : "";
  }

  // Update a cell value
  function updateCell(hole: typeof holes[0], team: "A" | "B", pIdx: number, value: number | null) {
    const { k, input } = hole;
    
    if (format === "twoManScramble") {
      const newInput = {
        teamAGross: team === "A" ? value : (input?.teamAGross ?? null),
        teamBGross: team === "B" ? value : (input?.teamBGross ?? null),
      };
      saveHole(k, newInput);
      return;
    }
    
    if (format === "singles") {
      const newInput = {
        teamAPlayerGross: team === "A" ? value : (input?.teamAPlayerGross ?? null),
        teamBPlayerGross: team === "B" ? value : (input?.teamBPlayerGross ?? null),
      };
      saveHole(k, newInput);
      return;
    }
    
    // Best Ball / Shamble
    const aArr = Array.isArray(input?.teamAPlayersGross) ? [...input.teamAPlayersGross] : [null, null];
    const bArr = Array.isArray(input?.teamBPlayersGross) ? [...input.teamBPlayersGross] : [null, null];
    
    if (team === "A") aArr[pIdx] = value;
    else bArr[pIdx] = value;
    
    saveHole(k, { teamAPlayersGross: aArr, teamBPlayersGross: bArr });
  }

  // Check if hole is locked
  function isHoleLocked(holeNum: number) {
    return roundLocked || (isMatchClosed && holeNum > matchThru);
  }

  // Calculate running match status after each hole
  // Returns array of { status: string, leader: "A" | "B" | null } for each hole
  const runningMatchStatus = useMemo(() => {
    const result: { status: string; leader: "A" | "B" | null }[] = [];
    let teamAUp = 0; // Positive = Team A ahead, Negative = Team B ahead
    
    for (let i = 0; i < 18; i++) {
      const hole = holes[i];
      const input = hole.input;
      
      // Get the team scores for this hole based on format
      let teamAScore: number | null = null;
      let teamBScore: number | null = null;
      
      if (format === "twoManScramble") {
        teamAScore = input?.teamAGross ?? null;
        teamBScore = input?.teamBGross ?? null;
      } else if (format === "singles") {
        teamAScore = input?.teamAPlayerGross ?? null;
        teamBScore = input?.teamBPlayerGross ?? null;
      } else {
        // Best Ball / Shamble - use the best (lowest) of each team's scores
        const aArr = input?.teamAPlayersGross;
        const bArr = input?.teamBPlayersGross;
        if (Array.isArray(aArr)) {
          const validA = aArr.filter((v: number | null) => v != null) as number[];
          teamAScore = validA.length > 0 ? Math.min(...validA) : null;
        }
        if (Array.isArray(bArr)) {
          const validB = bArr.filter((v: number | null) => v != null) as number[];
          teamBScore = validB.length > 0 ? Math.min(...validB) : null;
        }
      }
      
      // Apply strokes if applicable (subtract stroke from net score)
      // For best ball, check if either player gets a stroke on this hole
      if (format !== "twoManScramble" && format !== "singles") {
        // Check if Team A gets any strokes on this hole
        const teamAStroke = (match?.teamAPlayers || []).some((_, pIdx) => 
          (match?.teamAPlayers?.[pIdx]?.strokesReceived?.[i] ?? 0) > 0
        );
        const teamBStroke = (match?.teamBPlayers || []).some((_, pIdx) => 
          (match?.teamBPlayers?.[pIdx]?.strokesReceived?.[i] ?? 0) > 0
        );
        
        if (teamAScore != null && teamAStroke) teamAScore -= 1;
        if (teamBScore != null && teamBStroke) teamBScore -= 1;
      } else if (format === "singles") {
        // Singles: check strokesReceived for the single player
        const teamAStroke = (match?.teamAPlayers?.[0]?.strokesReceived?.[i] ?? 0) > 0;
        const teamBStroke = (match?.teamBPlayers?.[0]?.strokesReceived?.[i] ?? 0) > 0;
        
        if (teamAScore != null && teamAStroke) teamAScore -= 1;
        if (teamBScore != null && teamBStroke) teamBScore -= 1;
      }
      
      // Compare scores (lower is better in golf)
      if (teamAScore != null && teamBScore != null) {
        if (teamAScore < teamBScore) {
          teamAUp += 1; // Team A won the hole
        } else if (teamBScore < teamAScore) {
          teamAUp -= 1; // Team B won the hole
        }
        // If tied, no change
      }
      
      // Format the status text
      let status: string;
      let leader: "A" | "B" | null;
      
      if (teamAScore == null || teamBScore == null) {
        // Hole not complete - leave blank (don't carry forward)
        status = "";
        leader = null;
      } else if (teamAUp === 0) {
        status = "AS";
        leader = null;
      } else if (teamAUp > 0) {
        status = `${teamAUp}UP`;
        leader = "A";
      } else {
        status = `${Math.abs(teamAUp)}UP`;
        leader = "B";
      }
      
      result.push({ status, leader });
    }
    
    return result;
  }, [holes, format, match]);

  // Get team colors
  const teamAColor = tournament?.teamA?.color || "var(--team-a-default)";
  const teamBColor = tournament?.teamB?.color || "var(--team-b-default)";

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="spinner-lg"></div>
    </div>
  );
  
  if (!match) return (
    <div className="empty-state">
      <div className="empty-state-icon">🔍</div>
      <div className="empty-state-text">Match not found.</div>
    </div>
  );

  const tName = tournament?.name || "Match Scoring";
  const tSeries = tournament?.series;
  const isFourPlayer = format !== "singles" && format !== "twoManScramble";

  // Build player rows config
  type PlayerRowConfig = { team: "A" | "B"; pIdx: number; label: string; color: string };
  const playerRows: PlayerRowConfig[] = [];
  
  if (isFourPlayer) {
    // 4 players: A1, A2, B1, B2
    playerRows.push(
      { team: "A", pIdx: 0, label: getInitials(match.teamAPlayers?.[0]?.playerId), color: tournament?.teamA?.color || "var(--team-a-default)" },
      { team: "A", pIdx: 1, label: getInitials(match.teamAPlayers?.[1]?.playerId), color: tournament?.teamA?.color || "var(--team-a-default)" },
      { team: "B", pIdx: 0, label: getInitials(match.teamBPlayers?.[0]?.playerId), color: tournament?.teamB?.color || "var(--team-b-default)" },
      { team: "B", pIdx: 1, label: getInitials(match.teamBPlayers?.[1]?.playerId), color: tournament?.teamB?.color || "var(--team-b-default)" },
    );
  } else {
    // 2 rows: Team A, Team B
    playerRows.push(
      { team: "A", pIdx: 0, label: tournament?.teamA?.name || "Team A", color: tournament?.teamA?.color || "var(--team-a-default)" },
      { team: "B", pIdx: 0, label: tournament?.teamB?.name || "Team B", color: tournament?.teamB?.color || "var(--team-b-default)" },
    );
  }

  const cellWidth = 44;
  const labelWidth = 72;
  const totalColWidth = 48;

  return (
    <Layout title={tName} series={tSeries} showBack>
      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        
        {/* MATCH STATUS BANNER */}
        <div 
          className="rounded-xl text-center shadow-md"
          style={{ 
            background: isMatchClosed ? "var(--brand-secondary)" : "var(--brand-primary)", 
            color: "var(--brand-accent)", 
            padding: "16px 12px",
          }}
        >
          <div className="text-xs uppercase tracking-wider opacity-90">
            {isMatchClosed ? "Final Result" : `Thru ${matchThru}`}
          </div>
          <div className="text-2xl font-extrabold my-1">
            {formatMatchStatus(match.status, tournament?.teamA?.name, tournament?.teamB?.name)}
          </div>
          <div className="text-xs opacity-80">{format}</div>
        </div>

        {/* SCORECARD TABLE - Horizontally Scrollable (all 18 holes) */}
        <div className="card p-0 overflow-hidden">
          <div 
            className="overflow-x-auto"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <table 
              className="w-max border-collapse text-center text-sm"
              style={{ minWidth: "100%" }}
            >
              {/* HEADER ROW - Hole Numbers: 1-9 | OUT | 10-18 | IN | TOT */}
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th 
                    className="sticky left-0 z-10 bg-slate-800 font-bold text-left px-3 py-2"
                    style={{ width: labelWidth, minWidth: labelWidth }}
                  >
                    HOLE
                  </th>
                  {/* Front 9 */}
                  {holes.slice(0, 9).map(h => (
                    <th 
                      key={h.k} 
                      className="font-bold py-2"
                      style={{ width: cellWidth, minWidth: cellWidth }}
                    >
                      {h.num}
                    </th>
                  ))}
                  <th className="font-bold py-2 bg-slate-700 border-l-2 border-slate-600" style={{ width: totalColWidth, minWidth: totalColWidth }}>OUT</th>
                  {/* Back 9 */}
                  {holes.slice(9, 18).map(h => (
                    <th 
                      key={h.k} 
                      className="font-bold py-2 border-l-2 border-slate-600 first:border-l-2"
                      style={{ width: cellWidth, minWidth: cellWidth }}
                    >
                      {h.num}
                    </th>
                  ))}
                  <th className="font-bold py-2 bg-slate-700 border-l-2 border-slate-600" style={{ width: totalColWidth, minWidth: totalColWidth }}>IN</th>
                  <th className="font-bold py-2 bg-slate-600" style={{ width: totalColWidth, minWidth: totalColWidth }}>TOT</th>
                </tr>
              </thead>
              <tbody>
                {/* Par Row */}
                <tr className="bg-slate-100 text-slate-600 text-xs font-semibold">
                  <td className="sticky left-0 z-10 bg-slate-100 text-left px-3 py-1.5">Par</td>
                  {holes.slice(0, 9).map(h => (
                    <td key={h.k} className="py-1.5">{h.par}</td>
                  ))}
                  <td className="py-1.5 bg-slate-200 font-bold border-l-2 border-slate-300">{totals.parOut}</td>
                  {holes.slice(9, 18).map((h, i) => (
                    <td key={h.k} className={`py-1.5 ${i === 0 ? "border-l-2 border-slate-300" : ""}`}>{h.par}</td>
                  ))}
                  <td className="py-1.5 bg-slate-200 font-bold border-l-2 border-slate-300">{totals.parIn}</td>
                  <td className="py-1.5 bg-slate-300 font-bold">{totals.parTotal}</td>
                </tr>
                
                {/* Handicap Row */}
                <tr className="bg-slate-50 text-slate-400 text-xs border-b border-slate-200">
                  <td className="sticky left-0 z-10 bg-slate-50 text-left px-3 py-1">Hcp</td>
                  {holes.slice(0, 9).map(h => (
                    <td key={h.k} className="py-1">{h.hcpIndex || ""}</td>
                  ))}
                  <td className="py-1 bg-slate-100 border-l-2 border-slate-200"></td>
                  {holes.slice(9, 18).map((h, i) => (
                    <td key={h.k} className={`py-1 ${i === 0 ? "border-l-2 border-slate-200" : ""}`}>{h.hcpIndex || ""}</td>
                  ))}
                  <td className="py-1 bg-slate-100 border-l-2 border-slate-200"></td>
                  <td className="py-1 bg-slate-200"></td>
                </tr>

                {/* Team A Player Rows */}
                {playerRows.filter(pr => pr.team === "A").map((pr, rowIdx, teamRows) => {
                  const isLastOfTeamA = rowIdx === teamRows.length - 1;
                  return (
                    <tr 
                      key={`row-${pr.team}-${pr.pIdx}`}
                      className={`${isLastOfTeamA ? "" : "border-b border-slate-100"}`}
                    >
                      <td 
                        className="sticky left-0 z-10 bg-white text-left px-3 py-1 font-semibold whitespace-nowrap"
                        style={{ color: pr.color }}
                      >
                        {pr.label}
                        {/* Show dot if player has any strokes */}
                        {holes.some((_, i) => hasStroke(pr.team, pr.pIdx, i)) && (
                          <span className="ml-1 text-red-500">•</span>
                        )}
                      </td>
                      {/* Front 9 holes */}
                      {holes.slice(0, 9).map(h => {
                        const locked = isHoleLocked(h.num);
                        const stroke = hasStroke(pr.team, pr.pIdx, h.num - 1);
                        return (
                          <td key={h.k} className="p-0.5">
                            <div className="relative">
                              <input
                                type="number"
                                inputMode="numeric"
                                className={`
                                  w-10 h-10 text-center text-base font-semibold rounded-md border
                                  focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent
                                  transition-colors duration-100
                                  ${locked 
                                    ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed" 
                                    : "bg-white border-slate-200 hover:border-slate-300"
                                  }
                                  ${stroke ? "ring-1 ring-red-300" : ""}
                                `}
                                value={getCellValue(h, pr.team, pr.pIdx)}
                                disabled={locked}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? null : Number(e.target.value);
                                  updateCell(h, pr.team, pr.pIdx, val);
                                }}
                              />
                              {stroke && (
                                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full"></div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      {/* OUT total */}
                      <td className="py-1 bg-slate-50 font-bold text-slate-700 border-l-2 border-slate-200">
                        {totals.getOut(pr.team, pr.pIdx) ?? "–"}
                      </td>
                      {/* Back 9 holes */}
                      {holes.slice(9, 18).map((h, i) => {
                        const locked = isHoleLocked(h.num);
                        const stroke = hasStroke(pr.team, pr.pIdx, h.num - 1);
                        return (
                          <td key={h.k} className={`p-0.5 ${i === 0 ? "border-l-2 border-slate-200" : ""}`}>
                            <div className="relative">
                              <input
                                type="number"
                                inputMode="numeric"
                                className={`
                                  w-10 h-10 text-center text-base font-semibold rounded-md border
                                  focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent
                                  transition-colors duration-100
                                  ${locked 
                                    ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed" 
                                    : "bg-white border-slate-200 hover:border-slate-300"
                                  }
                                  ${stroke ? "ring-1 ring-red-300" : ""}
                                `}
                                value={getCellValue(h, pr.team, pr.pIdx)}
                                disabled={locked}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? null : Number(e.target.value);
                                  updateCell(h, pr.team, pr.pIdx, val);
                                }}
                              />
                              {stroke && (
                                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full"></div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      {/* IN total */}
                      <td className="py-1 bg-slate-50 font-bold text-slate-700 border-l-2 border-slate-200">
                        {totals.getIn(pr.team, pr.pIdx) ?? "–"}
                      </td>
                      {/* TOTAL */}
                      <td className="py-1 bg-slate-200 font-bold text-slate-900 text-base">
                        {totals.getTotal(pr.team, pr.pIdx) ?? "–"}
                      </td>
                    </tr>
                  );
                })}

                {/* Team A Score Row (twoManBestBall only) - Low Net */}
                {format === "twoManBestBall" && (
                  <tr style={{ backgroundColor: teamAColor }}>
                    <td className="sticky left-0 z-10 text-left px-3 py-1.5 text-white text-xs font-bold uppercase tracking-wide" style={{ backgroundColor: teamAColor }}>
                      {tournament?.teamA?.name || "Team A"}
                    </td>
                    {/* Front 9 low net */}
                    {holes.slice(0, 9).map(h => {
                      const lowNet = getTeamLowNet(h, "A");
                      return (
                        <td key={`teamA-${h.k}`} className="py-1 text-center text-white font-bold text-sm">
                          {lowNet ?? ""}
                        </td>
                      );
                    })}
                    {/* OUT total */}
                    <td className="py-1 text-center text-white font-bold border-l-2 border-white/30" style={{ backgroundColor: "rgba(0,0,0,0.15)" }}>
                      {teamLowNetTotals?.getOut("A") ?? "–"}
                    </td>
                    {/* Back 9 low net */}
                    {holes.slice(9, 18).map((h, i) => {
                      const lowNet = getTeamLowNet(h, "A");
                      return (
                        <td key={`teamA-${h.k}`} className={`py-1 text-center text-white font-bold text-sm ${i === 0 ? "border-l-2 border-white/30" : ""}`}>
                          {lowNet ?? ""}
                        </td>
                      );
                    })}
                    {/* IN total */}
                    <td className="py-1 text-center text-white font-bold border-l-2 border-white/30" style={{ backgroundColor: "rgba(0,0,0,0.15)" }}>
                      {teamLowNetTotals?.getIn("A") ?? "–"}
                    </td>
                    {/* TOTAL */}
                    <td className="py-1 text-center text-white font-extrabold text-base" style={{ backgroundColor: "rgba(0,0,0,0.25)" }}>
                      {teamLowNetTotals?.getTotal("A") ?? "–"}
                    </td>
                  </tr>
                )}

                {/* MATCH STATUS ROW - Between Team A and Team B */}
                <tr className="bg-white border-y-2 border-slate-300">
                  <td className="sticky left-0 z-10 bg-white text-left px-3 py-1.5 text-slate-600 text-xs font-bold uppercase tracking-wide">
                    Status
                  </td>
                  {/* Front 9 match status */}
                  {holes.slice(0, 9).map((h, i) => {
                    const { status, leader } = runningMatchStatus[i];
                    const bgColor = leader === "A" ? teamAColor : leader === "B" ? teamBColor : "transparent";
                    const textColor = leader ? "#fff" : "#94a3b8";
                    return (
                      <td key={`status-${h.k}`} className="py-1 px-0.5">
                        <div 
                          className="text-xs font-bold rounded px-1 py-0.5 text-center"
                          style={{ color: textColor, backgroundColor: bgColor }}
                        >
                          {status}
                        </div>
                      </td>
                    );
                  })}
                  {/* OUT status - always blank */}
                  <td className="py-1 bg-slate-100 border-l-2 border-slate-300"></td>
                  {/* Back 9 match status */}
                  {holes.slice(9, 18).map((h, i) => {
                    const { status, leader } = runningMatchStatus[9 + i];
                    const bgColor = leader === "A" ? teamAColor : leader === "B" ? teamBColor : "transparent";
                    const textColor = leader ? "#fff" : "#94a3b8";
                    return (
                      <td key={`status-${h.k}`} className={`py-1 px-0.5 ${i === 0 ? "border-l-2 border-slate-300" : ""}`}>
                        <div 
                          className="text-xs font-bold rounded px-1 py-0.5 text-center"
                          style={{ color: textColor, backgroundColor: bgColor }}
                        >
                          {status}
                        </div>
                      </td>
                    );
                  })}
                  {/* IN status - always blank */}
                  <td className="py-1 bg-slate-100 border-l-2 border-slate-300"></td>
                  {/* TOTAL status - always blank */}
                  <td className="py-1 bg-slate-200"></td>
                </tr>

                {/* Team B Score Row (twoManBestBall only) - Low Net */}
                {format === "twoManBestBall" && (
                  <tr style={{ backgroundColor: teamBColor }}>
                    <td className="sticky left-0 z-10 text-left px-3 py-1.5 text-white text-xs font-bold uppercase tracking-wide" style={{ backgroundColor: teamBColor }}>
                      {tournament?.teamB?.name || "Team B"}
                    </td>
                    {/* Front 9 low net */}
                    {holes.slice(0, 9).map(h => {
                      const lowNet = getTeamLowNet(h, "B");
                      return (
                        <td key={`teamB-${h.k}`} className="py-1 text-center text-white font-bold text-sm">
                          {lowNet ?? ""}
                        </td>
                      );
                    })}
                    {/* OUT total */}
                    <td className="py-1 text-center text-white font-bold border-l-2 border-white/30" style={{ backgroundColor: "rgba(0,0,0,0.15)" }}>
                      {teamLowNetTotals?.getOut("B") ?? "–"}
                    </td>
                    {/* Back 9 low net */}
                    {holes.slice(9, 18).map((h, i) => {
                      const lowNet = getTeamLowNet(h, "B");
                      return (
                        <td key={`teamB-${h.k}`} className={`py-1 text-center text-white font-bold text-sm ${i === 0 ? "border-l-2 border-white/30" : ""}`}>
                          {lowNet ?? ""}
                        </td>
                      );
                    })}
                    {/* IN total */}
                    <td className="py-1 text-center text-white font-bold border-l-2 border-white/30" style={{ backgroundColor: "rgba(0,0,0,0.15)" }}>
                      {teamLowNetTotals?.getIn("B") ?? "–"}
                    </td>
                    {/* TOTAL */}
                    <td className="py-1 text-center text-white font-extrabold text-base" style={{ backgroundColor: "rgba(0,0,0,0.25)" }}>
                      {teamLowNetTotals?.getTotal("B") ?? "–"}
                    </td>
                  </tr>
                )}

                {/* Team B Player Rows */}
                {playerRows.filter(pr => pr.team === "B").map((pr, rowIdx, teamRows) => {
                  const isLastOfTeamB = rowIdx === teamRows.length - 1;
                  return (
                    <tr 
                      key={`row-${pr.team}-${pr.pIdx}`}
                      className={`${isLastOfTeamB ? "border-b-2 border-slate-300" : "border-b border-slate-100"}`}
                    >
                      <td 
                        className="sticky left-0 z-10 bg-white text-left px-3 py-1 font-semibold whitespace-nowrap"
                        style={{ color: pr.color }}
                      >
                        {pr.label}
                        {/* Show dot if player has any strokes */}
                        {holes.some((_, i) => hasStroke(pr.team, pr.pIdx, i)) && (
                          <span className="ml-1 text-red-500">•</span>
                        )}
                      </td>
                      {/* Front 9 holes */}
                      {holes.slice(0, 9).map(h => {
                        const locked = isHoleLocked(h.num);
                        const stroke = hasStroke(pr.team, pr.pIdx, h.num - 1);
                        return (
                          <td key={h.k} className="p-0.5">
                            <div className="relative">
                              <input
                                type="number"
                                inputMode="numeric"
                                className={`
                                  w-10 h-10 text-center text-base font-semibold rounded-md border
                                  focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent
                                  transition-colors duration-100
                                  ${locked 
                                    ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed" 
                                    : "bg-white border-slate-200 hover:border-slate-300"
                                  }
                                  ${stroke ? "ring-1 ring-red-300" : ""}
                                `}
                                value={getCellValue(h, pr.team, pr.pIdx)}
                                disabled={locked}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? null : Number(e.target.value);
                                  updateCell(h, pr.team, pr.pIdx, val);
                                }}
                              />
                              {stroke && (
                                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full"></div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      {/* OUT total */}
                      <td className="py-1 bg-slate-50 font-bold text-slate-700 border-l-2 border-slate-200">
                        {totals.getOut(pr.team, pr.pIdx) ?? "–"}
                      </td>
                      {/* Back 9 holes */}
                      {holes.slice(9, 18).map((h, i) => {
                        const locked = isHoleLocked(h.num);
                        const stroke = hasStroke(pr.team, pr.pIdx, h.num - 1);
                        return (
                          <td key={h.k} className={`p-0.5 ${i === 0 ? "border-l-2 border-slate-200" : ""}`}>
                            <div className="relative">
                              <input
                                type="number"
                                inputMode="numeric"
                                className={`
                                  w-10 h-10 text-center text-base font-semibold rounded-md border
                                  focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent
                                  transition-colors duration-100
                                  ${locked 
                                    ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed" 
                                    : "bg-white border-slate-200 hover:border-slate-300"
                                  }
                                  ${stroke ? "ring-1 ring-red-300" : ""}
                                `}
                                value={getCellValue(h, pr.team, pr.pIdx)}
                                disabled={locked}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? null : Number(e.target.value);
                                  updateCell(h, pr.team, pr.pIdx, val);
                                }}
                              />
                              {stroke && (
                                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full"></div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      {/* IN total */}
                      <td className="py-1 bg-slate-50 font-bold text-slate-700 border-l-2 border-slate-200">
                        {totals.getIn(pr.team, pr.pIdx) ?? "–"}
                      </td>
                      {/* TOTAL */}
                      <td className="py-1 bg-slate-200 font-bold text-slate-900 text-base">
                        {totals.getTotal(pr.team, pr.pIdx) ?? "–"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <LastUpdated />
      </div>
    </Layout>
  );
}
