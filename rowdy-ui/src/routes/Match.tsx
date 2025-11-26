import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot, getDoc, updateDoc, getDocs, collection, where, query, documentId } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, PlayerDoc, MatchDoc, RoundDoc, RoundFormat, CourseDoc } from "../types";
import { formatMatchStatus } from "../utils";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";

export default function Match() {
  const { matchId } = useParams();
  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [course, setCourse] = useState<CourseDoc | null>(null);
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

  // 2. Listen to ROUND and fetch Course
  useEffect(() => {
    if (!match?.roundId) return;
    const unsub = onSnapshot(doc(db, "rounds", match.roundId), async (rSnap) => {
      if (rSnap.exists()) {
        const rData = { id: rSnap.id, ...(rSnap.data() as any) } as RoundDoc;
        setRound(rData);
        
        // Fetch tournament
        if (rData.tournamentId) {
            const tSnap = await getDoc(doc(db, "tournaments", rData.tournamentId));
            if (tSnap.exists()) {
                setTournament({ id: tSnap.id, ...(tSnap.data() as any) } as TournamentDoc);
            }
        }
        
        // Fetch course if courseId exists
        if (rData.courseId) {
          const cSnap = await getDoc(doc(db, "courses", rData.courseId));
          if (cSnap.exists()) {
            setCourse({ id: cSnap.id, ...(cSnap.data() as any) } as CourseDoc);
          }
        }
      }
    });
    return () => unsub();
  }, [match?.roundId]);

  const format: RoundFormat = (round?.format as RoundFormat) || "twoManBestBall";
  
  // DRIVE_TRACKING: Check if drive tracking is enabled for this round
  const trackDrives = !!round?.trackDrives && (format === "twoManScramble" || format === "twoManShamble");
  
  // --- LOCKING LOGIC ---
  const roundLocked = !!round?.locked;
  const isMatchClosed = !!match?.status?.closed;
  const matchThru = match?.status?.thru ?? 0;

  // Build holes data - use course from separate fetch or embedded in round
  const holes = useMemo(() => {
    const hMatch = match?.holes || {};
    // Try course from separate fetch first, then fall back to embedded round.course
    const hCourse = course?.holes || round?.course?.holes || [];
    return Array.from({ length: 18 }, (_, i) => {
      const num = i + 1;
      const k = String(num);
      const info = hCourse.find(h => h.number === num);
      return { k, num, input: hMatch[k]?.input || {}, par: info?.par ?? 4, hcpIndex: info?.hcpIndex };
    });
  }, [match, round, course]);

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

  function getPlayerName(pid?: string) {
    if (!pid) return "Player";
    const p = players[pid];
    if (!p) return "...";
    return p.displayName || p.username || "Unknown";
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

  // DRIVE_TRACKING: Get current drive selection for a hole
  function getDriveValue(hole: typeof holes[0], team: "A" | "B"): 0 | 1 | null {
    const { input } = hole;
    const v = team === "A" ? input?.teamADrive : input?.teamBDrive;
    return v === 0 || v === 1 ? v : null;
  }

  // DRIVE_TRACKING: Update drive selection for a hole
  function updateDrive(hole: typeof holes[0], team: "A" | "B", playerIdx: 0 | 1) {
    const { k, input } = hole;
    const currentDrive = team === "A" ? input?.teamADrive : input?.teamBDrive;
    // Toggle: if same player, clear it; otherwise set to new player
    const newDrive = currentDrive === playerIdx ? null : playerIdx;
    
    if (format === "twoManScramble") {
      const newInput = {
        teamAGross: input?.teamAGross ?? null,
        teamBGross: input?.teamBGross ?? null,
        teamADrive: team === "A" ? newDrive : (input?.teamADrive ?? null),
        teamBDrive: team === "B" ? newDrive : (input?.teamBDrive ?? null),
      };
      saveHole(k, newInput);
    } else if (format === "twoManShamble") {
      const newInput = {
        teamAPlayersGross: input?.teamAPlayersGross ?? [null, null],
        teamBPlayersGross: input?.teamBPlayersGross ?? [null, null],
        teamADrive: team === "A" ? newDrive : (input?.teamADrive ?? null),
        teamBDrive: team === "B" ? newDrive : (input?.teamBDrive ?? null),
      };
      saveHole(k, newInput);
    }
  }

  // DRIVE_TRACKING: Calculate drives used per player per team
  const drivesUsed = useMemo(() => {
    if (!trackDrives) return null;
    
    const teamA = [0, 0]; // [player0, player1]
    const teamB = [0, 0];
    
    holes.forEach(h => {
      const aDrive = h.input?.teamADrive;
      const bDrive = h.input?.teamBDrive;
      if (aDrive === 0) teamA[0]++;
      else if (aDrive === 1) teamA[1]++;
      if (bDrive === 0) teamB[0]++;
      else if (bDrive === 1) teamB[1]++;
    });
    
    return { teamA, teamB };
  }, [holes, trackDrives]);

  // DRIVE_TRACKING: Calculate drives still needed (6 min per player, minus holes remaining)
  const drivesNeeded = useMemo(() => {
    if (!trackDrives || !drivesUsed) return null;
    
    const holesRemaining = 18 - matchThru;
    const calc = (used: number) => Math.max(0, 6 - used - holesRemaining);
    
    return {
      teamA: [calc(drivesUsed.teamA[0]), calc(drivesUsed.teamA[1])],
      teamB: [calc(drivesUsed.teamB[0]), calc(drivesUsed.teamB[1])],
    };
  }, [drivesUsed, matchThru, trackDrives]);

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
      let holeComplete = false;
      
      if (format === "twoManScramble") {
        const aGross = input?.teamAGross ?? null;
        const bGross = input?.teamBGross ?? null;
        // Scramble: hole complete when both team grosses are entered
        holeComplete = aGross != null && bGross != null;
        teamAScore = aGross;
        teamBScore = bGross;
      } else if (format === "singles") {
        const aGross = input?.teamAPlayerGross ?? null;
        const bGross = input?.teamBPlayerGross ?? null;
        // Singles: hole complete when both player grosses are entered
        holeComplete = aGross != null && bGross != null;
        
        if (holeComplete) {
          // Apply strokes for singles
          const teamAStroke = (match?.teamAPlayers?.[0]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
          const teamBStroke = (match?.teamBPlayers?.[0]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
          teamAScore = aGross! - teamAStroke;
          teamBScore = bGross! - teamBStroke;
        }
      } else {
        // Best Ball / Shamble - calculate net for each player, then take best
        const aArr = input?.teamAPlayersGross;
        const bArr = input?.teamBPlayersGross;
        
        // Check if all 4 players have entered scores
        const a0 = Array.isArray(aArr) ? aArr[0] : null;
        const a1 = Array.isArray(aArr) ? aArr[1] : null;
        const b0 = Array.isArray(bArr) ? bArr[0] : null;
        const b1 = Array.isArray(bArr) ? bArr[1] : null;
        
        holeComplete = a0 != null && a1 != null && b0 != null && b1 != null;
        
        if (holeComplete) {
          // Calculate net for each player individually
          const a0Stroke = (match?.teamAPlayers?.[0]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
          const a1Stroke = (match?.teamAPlayers?.[1]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
          const b0Stroke = (match?.teamBPlayers?.[0]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
          const b1Stroke = (match?.teamBPlayers?.[1]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
          
          const a0Net = a0! - a0Stroke;
          const a1Net = a1! - a1Stroke;
          const b0Net = b0! - b0Stroke;
          const b1Net = b1! - b1Stroke;
          
          // Best (lowest) net for each team
          teamAScore = Math.min(a0Net, a1Net);
          teamBScore = Math.min(b0Net, b1Net);
        }
      }
      
      // Compare scores only if hole is complete (lower is better in golf)
      if (holeComplete && teamAScore != null && teamBScore != null) {
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
      
      if (!holeComplete) {
        // Hole not complete - leave blank
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
      { team: "A", pIdx: 0, label: getPlayerName(match.teamAPlayers?.[0]?.playerId), color: tournament?.teamA?.color || "var(--team-a-default)" },
      { team: "A", pIdx: 1, label: getPlayerName(match.teamAPlayers?.[1]?.playerId), color: tournament?.teamA?.color || "var(--team-a-default)" },
      { team: "B", pIdx: 0, label: getPlayerName(match.teamBPlayers?.[0]?.playerId), color: tournament?.teamB?.color || "var(--team-b-default)" },
      { team: "B", pIdx: 1, label: getPlayerName(match.teamBPlayers?.[1]?.playerId), color: tournament?.teamB?.color || "var(--team-b-default)" },
    );
  } else {
    // 2 rows: Player A, Player B (singles or scramble)
    playerRows.push(
      { team: "A", pIdx: 0, label: getPlayerName(match.teamAPlayers?.[0]?.playerId), color: tournament?.teamA?.color || "var(--team-a-default)" },
      { team: "B", pIdx: 0, label: getPlayerName(match.teamBPlayers?.[0]?.playerId), color: tournament?.teamB?.color || "var(--team-b-default)" },
    );
  }

  const cellWidth = 44;
  const labelWidth = 120;
  const totalColWidth = 48;

  return (
    <Layout title={tName} series={tSeries} showBack tournamentLogo={tournament?.tournamentLogo}>
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

        {/* DRIVE_TRACKING: Drives Remaining Warning Banner */}
        {trackDrives && drivesUsed && drivesNeeded && !isMatchClosed && (
          <div className="card p-3 space-y-2">
            <div className="text-xs font-bold uppercase text-slate-500">Drives Tracking</div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {/* Team A */}
              <div>
                <div className="font-semibold" style={{ color: teamAColor }}>{tournament?.teamA?.name || "Team A"}</div>
                <div className="flex gap-3 mt-1">
                  <div>
                    <span className="text-slate-500">P1:</span>{" "}
                    <span className={`font-bold ${drivesNeeded.teamA[0] > 0 ? "text-red-500" : "text-green-600"}`}>
                      {drivesUsed.teamA[0]}/6
                    </span>
                    {drivesNeeded.teamA[0] > 0 && (
                      <span className="text-red-500 text-xs ml-1">⚠️ Need {drivesNeeded.teamA[0]}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-500">P2:</span>{" "}
                    <span className={`font-bold ${drivesNeeded.teamA[1] > 0 ? "text-red-500" : "text-green-600"}`}>
                      {drivesUsed.teamA[1]}/6
                    </span>
                    {drivesNeeded.teamA[1] > 0 && (
                      <span className="text-red-500 text-xs ml-1">⚠️ Need {drivesNeeded.teamA[1]}</span>
                    )}
                  </div>
                </div>
              </div>
              {/* Team B */}
              <div>
                <div className="font-semibold" style={{ color: teamBColor }}>{tournament?.teamB?.name || "Team B"}</div>
                <div className="flex gap-3 mt-1">
                  <div>
                    <span className="text-slate-500">P1:</span>{" "}
                    <span className={`font-bold ${drivesNeeded.teamB[0] > 0 ? "text-red-500" : "text-green-600"}`}>
                      {drivesUsed.teamB[0]}/6
                    </span>
                    {drivesNeeded.teamB[0] > 0 && (
                      <span className="text-red-500 text-xs ml-1">⚠️ Need {drivesNeeded.teamB[0]}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-500">P2:</span>{" "}
                    <span className={`font-bold ${drivesNeeded.teamB[1] > 0 ? "text-red-500" : "text-green-600"}`}>
                      {drivesUsed.teamB[1]}/6
                    </span>
                    {drivesNeeded.teamB[1] > 0 && (
                      <span className="text-red-500 text-xs ml-1">⚠️ Need {drivesNeeded.teamB[1]}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

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
                <tr style={{ 
                  backgroundColor: tSeries === "christmasClassic" ? "#b8860b" : "#1e293b",
                  color: "white" 
                }}>
                  <th 
                    className="sticky left-0 z-10 font-bold text-left px-3 py-2"
                    style={{ 
                      width: labelWidth, 
                      minWidth: labelWidth,
                      backgroundColor: tSeries === "christmasClassic" ? "#b8860b" : "#1e293b"
                    }}
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
                  <th 
                    className="font-bold py-2 border-l-2" 
                    style={{ 
                      width: totalColWidth, 
                      minWidth: totalColWidth,
                      backgroundColor: tSeries === "christmasClassic" ? "#996f00" : "#334155",
                      borderColor: tSeries === "christmasClassic" ? "#8b6914" : "#475569"
                    }}
                  >OUT</th>
                  {/* Back 9 */}
                  {holes.slice(9, 18).map(h => (
                    <th 
                      key={h.k} 
                      className="font-bold py-2 border-l-2"
                      style={{ 
                        width: cellWidth, 
                        minWidth: cellWidth,
                        borderColor: tSeries === "christmasClassic" ? "#8b6914" : "#475569"
                      }}
                    >
                      {h.num}
                    </th>
                  ))}
                  <th 
                    className="font-bold py-2 border-l-2" 
                    style={{ 
                      width: totalColWidth, 
                      minWidth: totalColWidth,
                      backgroundColor: tSeries === "christmasClassic" ? "#996f00" : "#334155",
                      borderColor: tSeries === "christmasClassic" ? "#8b6914" : "#475569"
                    }}
                  >IN</th>
                  <th 
                    className="font-bold py-2" 
                    style={{ 
                      width: totalColWidth, 
                      minWidth: totalColWidth,
                      backgroundColor: tSeries === "christmasClassic" ? "#8b6914" : "#475569"
                    }}
                  >TOT</th>
                </tr>
              </thead>
              <tbody>
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

                {/* Team A Player Rows */}
                {playerRows.filter(pr => pr.team === "A").map((pr, rowIdx, teamRows) => {
                  const isLastOfTeamA = rowIdx === teamRows.length - 1;
                  // DRIVE_TRACKING: Show drive buttons on first row of team for scramble/shamble
                  const showDriveButtons = trackDrives && pr.pIdx === 0;
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
                      </td>
                      {/* Front 9 holes */}
                      {holes.slice(0, 9).map(h => {
                        const locked = isHoleLocked(h.num);
                        const stroke = hasStroke(pr.team, pr.pIdx, h.num - 1);
                        const currentDrive = showDriveButtons ? getDriveValue(h, "A") : null;
                        return (
                          <td key={h.k} className="p-0.5">
                            <div className="relative flex flex-col items-center">
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
                                  ${stroke ? "" : ""}
                                `}
                                value={getCellValue(h, pr.team, pr.pIdx)}
                                disabled={locked}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? null : Number(e.target.value);
                                  updateCell(h, pr.team, pr.pIdx, val);
                                }}
                              />
                              {stroke && (
                                <div className="absolute top-1 right-1 w-2 h-2 bg-sky-400 rounded-full"></div>
                              )}
                              {/* DRIVE_TRACKING: Drive selector buttons */}
                              {showDriveButtons && !locked && (
                                <div className="flex gap-0.5 mt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => updateDrive(h, "A", 0)}
                                    className={`text-[9px] px-1 py-0 rounded ${
                                      currentDrive === 0 
                                        ? "bg-blue-500 text-white" 
                                        : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                                    }`}
                                  >
                                    P1
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateDrive(h, "A", 1)}
                                    className={`text-[9px] px-1 py-0 rounded ${
                                      currentDrive === 1 
                                        ? "bg-blue-500 text-white" 
                                        : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                                    }`}
                                  >
                                    P2
                                  </button>
                                </div>
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
                        const currentDrive = showDriveButtons ? getDriveValue(h, "A") : null;
                        return (
                          <td key={h.k} className={`p-0.5 ${i === 0 ? "border-l-2 border-slate-200" : ""}`}>
                            <div className="relative flex flex-col items-center">
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
                                  ${stroke ? "" : ""}
                                `}
                                value={getCellValue(h, pr.team, pr.pIdx)}
                                disabled={locked}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? null : Number(e.target.value);
                                  updateCell(h, pr.team, pr.pIdx, val);
                                }}
                              />
                              {stroke && (
                                <div className="absolute top-1 right-1 w-2 h-2 bg-sky-400 rounded-full"></div>
                              )}
                              {/* DRIVE_TRACKING: Drive selector buttons */}
                              {showDriveButtons && !locked && (
                                <div className="flex gap-0.5 mt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => updateDrive(h, "A", 0)}
                                    className={`text-[9px] px-1 py-0 rounded ${
                                      currentDrive === 0 
                                        ? "bg-blue-500 text-white" 
                                        : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                                    }`}
                                  >
                                    P1
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateDrive(h, "A", 1)}
                                    className={`text-[9px] px-1 py-0 rounded ${
                                      currentDrive === 1 
                                        ? "bg-blue-500 text-white" 
                                        : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                                    }`}
                                  >
                                    P2
                                  </button>
                                </div>
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
                  // DRIVE_TRACKING: Show drive buttons on first row of team for scramble/shamble
                  const showDriveButtons = trackDrives && pr.pIdx === 0;
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
                      </td>
                      {/* Front 9 holes */}
                      {holes.slice(0, 9).map(h => {
                        const locked = isHoleLocked(h.num);
                        const stroke = hasStroke(pr.team, pr.pIdx, h.num - 1);
                        const currentDrive = showDriveButtons ? getDriveValue(h, "B") : null;
                        return (
                          <td key={h.k} className="p-0.5">
                            <div className="relative flex flex-col items-center">
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
                                  ${stroke ? "" : ""}
                                `}
                                value={getCellValue(h, pr.team, pr.pIdx)}
                                disabled={locked}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? null : Number(e.target.value);
                                  updateCell(h, pr.team, pr.pIdx, val);
                                }}
                              />
                              {stroke && (
                                <div className="absolute top-1 right-1 w-2 h-2 bg-sky-400 rounded-full"></div>
                              )}
                              {/* DRIVE_TRACKING: Drive selector buttons */}
                              {showDriveButtons && !locked && (
                                <div className="flex gap-0.5 mt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => updateDrive(h, "B", 0)}
                                    className={`text-[9px] px-1 py-0 rounded ${
                                      currentDrive === 0 
                                        ? "bg-blue-500 text-white" 
                                        : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                                    }`}
                                  >
                                    P1
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateDrive(h, "B", 1)}
                                    className={`text-[9px] px-1 py-0 rounded ${
                                      currentDrive === 1 
                                        ? "bg-blue-500 text-white" 
                                        : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                                    }`}
                                  >
                                    P2
                                  </button>
                                </div>
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
                        const currentDrive = showDriveButtons ? getDriveValue(h, "B") : null;
                        return (
                          <td key={h.k} className={`p-0.5 ${i === 0 ? "border-l-2 border-slate-200" : ""}`}>
                            <div className="relative flex flex-col items-center">
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
                                  ${stroke ? "" : ""}
                                `}
                                value={getCellValue(h, pr.team, pr.pIdx)}
                                disabled={locked}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? null : Number(e.target.value);
                                  updateCell(h, pr.team, pr.pIdx, val);
                                }}
                              />
                              {stroke && (
                                <div className="absolute top-1 right-1 w-2 h-2 bg-sky-400 rounded-full"></div>
                              )}
                              {/* DRIVE_TRACKING: Drive selector buttons */}
                              {showDriveButtons && !locked && (
                                <div className="flex gap-0.5 mt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => updateDrive(h, "B", 0)}
                                    className={`text-[9px] px-1 py-0 rounded ${
                                      currentDrive === 0 
                                        ? "bg-blue-500 text-white" 
                                        : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                                    }`}
                                  >
                                    P1
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateDrive(h, "B", 1)}
                                    className={`text-[9px] px-1 py-0 rounded ${
                                      currentDrive === 1 
                                        ? "bg-blue-500 text-white" 
                                        : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                                    }`}
                                  >
                                    P2
                                  </button>
                                </div>
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
