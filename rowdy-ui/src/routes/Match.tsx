import { useMemo, useState, useCallback, memo } from "react";
import { useParams, Link } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { RoundFormat } from "../types";
import { formatMatchStatus, formatRoundType } from "../utils";
import { getPlayerName as getPlayerNameFromLookup, getPlayerShortName as getPlayerShortNameFromLookup, getPlayerInitials as getPlayerInitialsFromLookup } from "../utils/playerHelpers";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import { useAuth } from "../contexts/AuthContext";
import { MatchFlowGraph } from "../components/match/MatchFlowGraph";
import { PostMatchStats } from "../components/match/PostMatchStats";
import { useMatchData } from "../hooks/useMatchData";
import { useDebouncedSave } from "../hooks/useDebouncedSave";

// --- MATCH CLOSING HELPERS ---

/** Calculates if a score change would close the match */
function wouldCloseMatch(
  holes: Array<{ k: string; num: number; input: any; par: number }>,
  pendingHoleKey: string,
  pendingInput: any,
  format: RoundFormat,
  teamAPlayers?: any[],
  teamBPlayers?: any[]
): { wouldClose: boolean; winner: "teamA" | "teamB" | "AS" | null; margin: number; thru: number } {
  let teamAUp = 0;
  let thru = 0;
  
  for (let i = 0; i < 18; i++) {
    const hole = holes[i];
    // Use pending input if this is the hole being edited
    const input = hole.k === pendingHoleKey ? pendingInput : hole.input;
    
    let teamAScore: number | null = null;
    let teamBScore: number | null = null;
    let holeComplete = false;
    
    if (format === "twoManScramble") {
      const aGross = input?.teamAGross ?? null;
      const bGross = input?.teamBGross ?? null;
      holeComplete = aGross != null && bGross != null;
      teamAScore = aGross;
      teamBScore = bGross;
    } else if (format === "singles") {
      const aGross = input?.teamAPlayerGross ?? null;
      const bGross = input?.teamBPlayerGross ?? null;
      holeComplete = aGross != null && bGross != null;
      if (holeComplete) {
        const teamAStroke = (teamAPlayers?.[0]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
        const teamBStroke = (teamBPlayers?.[0]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
        teamAScore = aGross! - teamAStroke;
        teamBScore = bGross! - teamBStroke;
      }
    } else if (format === "twoManShamble") {
      const aArr = input?.teamAPlayersGross;
      const bArr = input?.teamBPlayersGross;
      const a0 = Array.isArray(aArr) ? aArr[0] : null;
      const a1 = Array.isArray(aArr) ? aArr[1] : null;
      const b0 = Array.isArray(bArr) ? bArr[0] : null;
      const b1 = Array.isArray(bArr) ? bArr[1] : null;
      holeComplete = a0 != null && a1 != null && b0 != null && b1 != null;
      if (holeComplete) {
        teamAScore = Math.min(a0!, a1!);
        teamBScore = Math.min(b0!, b1!);
      }
    } else {
      // Best Ball
      const aArr = input?.teamAPlayersGross;
      const bArr = input?.teamBPlayersGross;
      const a0 = Array.isArray(aArr) ? aArr[0] : null;
      const a1 = Array.isArray(aArr) ? aArr[1] : null;
      const b0 = Array.isArray(bArr) ? bArr[0] : null;
      const b1 = Array.isArray(bArr) ? bArr[1] : null;
      holeComplete = a0 != null && a1 != null && b0 != null && b1 != null;
      if (holeComplete) {
        const a0Stroke = (teamAPlayers?.[0]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
        const a1Stroke = (teamAPlayers?.[1]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
        const b0Stroke = (teamBPlayers?.[0]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
        const b1Stroke = (teamBPlayers?.[1]?.strokesReceived?.[i] ?? 0) > 0 ? 1 : 0;
        const a0Net = a0! - a0Stroke;
        const a1Net = a1! - a1Stroke;
        const b0Net = b0! - b0Stroke;
        const b1Net = b1! - b1Stroke;
        teamAScore = Math.min(a0Net, a1Net);
        teamBScore = Math.min(b0Net, b1Net);
      }
    }
    
    if (holeComplete && teamAScore != null && teamBScore != null) {
      thru = hole.num;
      if (teamAScore < teamBScore) teamAUp += 1;
      else if (teamBScore < teamAScore) teamAUp -= 1;
    }
  }
  
  const margin = Math.abs(teamAUp);
  const holesLeft = 18 - thru;
  const leader = teamAUp > 0 ? "teamA" : teamAUp < 0 ? "teamB" : null;
  
  // Match closes when margin > holesLeft OR all 18 holes complete
  const wouldClose = (leader !== null && margin > holesLeft) || thru === 18;
  const winner = wouldClose ? (thru === 18 && teamAUp === 0 ? "AS" : leader) : null;
  
  return { wouldClose, winner, margin, thru };
}

// --- MEMOIZED COMPONENTS ---

/** Props for ScoreInputCell */
interface ScoreInputCellProps {
  holeKey: string;
  value: number | "";
  locked: boolean;
  hasStroke: boolean;
  hasDrive: boolean;
  lowScoreStatus: 'solo' | 'tied' | null;
  teamColor: 'A' | 'B';
  onChange: (holeKey: string, value: number | null) => void;
}

/** Memoized score input cell - prevents re-render unless props change */
const ScoreInputCell = memo(function ScoreInputCell({
  holeKey,
  value,
  locked,
  hasStroke,
  hasDrive,
  lowScoreStatus,
  teamColor,
  onChange,
}: ScoreInputCellProps) {
  // Use team-specific colors for low score highlighting
  const lowScoreBg = teamColor === 'A'
    ? (lowScoreStatus === 'solo' ? 'bg-blue-100' : lowScoreStatus === 'tied' ? 'bg-blue-50' : '')
    : (lowScoreStatus === 'solo' ? 'bg-red-100' : lowScoreStatus === 'tied' ? 'bg-red-50' : '');

  return (
    <div className="relative flex flex-col items-center">
      <input
        type="number"
        inputMode="numeric"
        className={`
          w-10 h-10 text-center text-base font-semibold rounded-md border
          focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent
          transition-colors duration-100
          ${locked 
            ? "bg-slate-50 text-slate-600 border-slate-200 cursor-default" 
            : lowScoreBg ? `${lowScoreBg} border-slate-200 hover:border-slate-300` : "bg-white border-slate-200 hover:border-slate-300"
          }
        `}
        value={value}
        disabled={locked}
        onChange={(e) => {
          const val = e.target.value === "" ? null : Number(e.target.value);
          onChange(holeKey, val);
        }}
      />
      {hasStroke && (
        <div className="absolute top-1 right-1 w-2 h-2 bg-sky-400 rounded-full"></div>
      )}
      {hasDrive && (
        <div className="absolute bottom-0.5 left-0.5 text-[8px] font-bold text-green-600">D</div>
      )}
    </div>
  );
});

/** Props for PlayerScoreRow */
interface PlayerScoreRowProps {
  team: "A" | "B";
  pIdx: number;
  label: string;
  color: string;
  holes: Array<{ k: string; num: number; input: any; par: number; hcpIndex?: number; yards?: number }>;
  isLastOfTeam: boolean;
  isTeamB?: boolean; // For different bottom border style
  trackDrives: boolean;
  getCellValue: (holeKey: string) => number | "";
  isHoleLocked: (holeNum: number) => boolean;
  hasStroke: (holeIdx: number) => boolean;
  getDriveValue: (holeKey: string) => 0 | 1 | null;
  getLowScoreStatus: (holeKey: string) => 'solo' | 'tied' | null;
  onCellChange: (holeKey: string, value: number | null) => void;
  outTotal: number | null;
  inTotal: number | null;
  totalScore: number | null;
}

/** Memoized player score row - renders 18 ScoreInputCells + totals */
const PlayerScoreRow = memo(function PlayerScoreRow({
  team,
  pIdx,
  label,
  color,
  holes,
  isLastOfTeam,
  isTeamB,
  trackDrives,
  getCellValue,
  isHoleLocked,
  hasStroke,
  getDriveValue,
  getLowScoreStatus,
  onCellChange,
  outTotal,
  inTotal,
  totalScore,
}: PlayerScoreRowProps) {
  // Team B last row has thicker border
  const rowClassName = isTeamB && isLastOfTeam 
    ? "border-b-2 border-slate-300" 
    : isLastOfTeam 
      ? "" 
      : "border-b border-slate-100";

  return (
    <tr className={rowClassName}>
      <td 
        className="sticky left-0 z-10 bg-white text-left px-3 py-1 font-semibold whitespace-nowrap"
        style={{ color }}
      >
        {label}
      </td>
      {/* Front 9 holes */}
      {holes.slice(0, 9).map(h => (
        <td key={h.k} className="p-0.5">
          <ScoreInputCell
            holeKey={h.k}
            value={getCellValue(h.k)}
            locked={isHoleLocked(h.num)}
            hasStroke={hasStroke(h.num - 1)}
            hasDrive={trackDrives && getDriveValue(h.k) === pIdx}
            lowScoreStatus={getLowScoreStatus(h.k)}
            teamColor={team}
            onChange={onCellChange}
          />
        </td>
      ))}
      {/* OUT total */}
      <td className="py-1 bg-slate-50 font-bold text-slate-700 border-l-2 border-slate-200">
        {outTotal ?? "–"}
      </td>
      {/* Back 9 holes */}
      {holes.slice(9, 18).map((h, i) => (
        <td key={h.k} className={`p-0.5 ${i === 0 ? "border-l-2 border-slate-200" : ""}`}>
          <ScoreInputCell
            holeKey={h.k}
            value={getCellValue(h.k)}
            locked={isHoleLocked(h.num)}
            hasStroke={hasStroke(h.num - 1)}
            hasDrive={trackDrives && getDriveValue(h.k) === pIdx}
            lowScoreStatus={getLowScoreStatus(h.k)}
            teamColor={team}
            onChange={onCellChange}
          />
        </td>
      ))}
      {/* IN total */}
      <td className="py-1 bg-slate-50 font-bold text-slate-700 border-l-2 border-slate-200">
        {inTotal ?? "–"}
      </td>
      {/* TOTAL */}
      <td className="py-1 bg-slate-200 font-bold text-slate-900 text-base">
        {totalScore ?? "–"}
      </td>
    </tr>
  );
});

export default function Match() {
  const { matchId } = useParams();
  const { canEditMatch, player } = useAuth();
  
  // Use custom hook for all data fetching
  const { match, round, course, tournament, players, matchFacts, loading } = useMatchData(matchId);
  
  // DRIVE_TRACKING: Modal state for drive picker - using any for hole to avoid circular type reference
  const [driveModal, setDriveModal] = useState<{ hole: any; team: "A" | "B" } | null>(null);
  
  // CONFIRM CLOSE: Modal state for confirming match close
  const [confirmCloseModal, setConfirmCloseModal] = useState<{
    holeKey: string;
    pendingInput: any;
    winner: "teamA" | "teamB" | "AS" | null;
    margin: number;
    thru: number;
  } | null>(null);

  const format: RoundFormat = (round?.format as RoundFormat) || "twoManBestBall";
  
  // Only scramble uses team-level scoring (one score per team per hole)
  const isTeamFormat = format === "twoManScramble";
  
  // DRIVE_TRACKING: Check if drive tracking is enabled for this round (scramble or shamble)
  const trackDrives = !!round?.trackDrives && (format === "twoManScramble" || format === "twoManShamble");
  
  // --- LOCKING LOGIC ---
  const roundLocked = !!round?.locked;
  const isMatchClosed = !!match?.status?.closed;
  const matchThru = match?.status?.thru ?? 0;
  
  // --- AUTH / PERMISSIONS ---
  // Get player IDs from match rosters
  const teamAPlayerIds = useMemo(() => 
    match?.teamAPlayers?.map(p => p.playerId).filter(Boolean) || [], 
    [match?.teamAPlayers]
  );
  const teamBPlayerIds = useMemo(() => 
    match?.teamBPlayers?.map(p => p.playerId).filter(Boolean) || [], 
    [match?.teamBPlayers]
  );
  
  // Check if current user can edit this match
  const canEdit = canEditMatch(teamAPlayerIds, teamBPlayerIds);
  
  // Reason why user can't edit (for displaying message)
  const editBlockReason = useMemo(() => {
    if (!player) return "login";
    if (!canEdit) return "not-rostered";
    return null;
  }, [player, canEdit]);

  // Build holes data - use course from separate fetch or embedded in round
  const holes = useMemo(() => {
    const hMatch = match?.holes || {};
    // Try course from separate fetch first, then fall back to embedded round.course
    const hCourse = course?.holes || round?.course?.holes || [];
    return Array.from({ length: 18 }, (_, i) => {
      const num = i + 1;
      const k = String(num);
      const info = hCourse.find(h => h.number === num);
      return { k, num, input: hMatch[k]?.input || {}, par: info?.par ?? 4, hcpIndex: info?.hcpIndex, yards: info?.yards };
    });
  }, [match, round, course]);

  // Calculate totals
  const totals = useMemo(() => {
    const front = holes.slice(0, 9);
    const back = holes.slice(9, 18);
    
    const sumPar = (arr: typeof holes) => arr.reduce((s, h) => s + (h.par || 0), 0);
    
    const getScore = (h: typeof holes[0], team: "A" | "B", pIdx: number) => {
      if (format === "twoManScramble") {
        // Scramble: one score per team
        return team === "A" ? h.input?.teamAGross : h.input?.teamBGross;
      }
      if (format === "singles") {
        return team === "A" ? h.input?.teamAPlayerGross : h.input?.teamBPlayerGross;
      }
      // Best Ball & Shamble: individual player scores
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

  // Player name helpers - wrap shared utilities with local players state
  const getPlayerName = (pid?: string) => getPlayerNameFromLookup(pid, players);
  const getPlayerShortName = (pid?: string) => getPlayerShortNameFromLookup(pid, players);
  const getPlayerInitials = (pid?: string) => getPlayerInitialsFromLookup(pid, players);

  // For twoManBestBall: get the team's low net score for a hole
  // For twoManShamble: get the team's low gross score for a hole
  function getTeamLowScore(hole: typeof holes[0], team: "A" | "B"): number | null {
    if (format !== "twoManBestBall" && format !== "twoManShamble") return null;
    
    const { input } = hole;
    const holeIdx = hole.num - 1;
    const arr = team === "A" ? input?.teamAPlayersGross : input?.teamBPlayersGross;
    
    if (!Array.isArray(arr)) return null;
    
    const p0Gross = arr[0];
    const p1Gross = arr[1];
    
    if (format === "twoManShamble") {
      // Shamble: best GROSS (no strokes)
      if (p0Gross == null && p1Gross == null) return null;
      if (p0Gross == null) return p1Gross;
      if (p1Gross == null) return p0Gross;
      return Math.min(p0Gross, p1Gross);
    }
    
    // Best Ball: calculate net scores
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

  // Calculate team totals for low score (net for best ball, gross for shamble)
  const teamLowScoreTotals = useMemo(() => {
    if (format !== "twoManBestBall" && format !== "twoManShamble") return null;
    
    const front = holes.slice(0, 9);
    const back = holes.slice(9, 18);
    
    const sumLowScore = (arr: typeof holes, team: "A" | "B") => {
      let total = 0;
      let hasAny = false;
      arr.forEach(h => {
        const v = getTeamLowScore(h, team);
        if (v != null) { total += v; hasAny = true; }
      });
      return hasAny ? total : null;
    };
    
    return {
      getOut: (team: "A" | "B") => sumLowScore(front, team),
      getIn: (team: "A" | "B") => sumLowScore(back, team),
      getTotal: (team: "A" | "B") => sumLowScore(holes, team),
    };
  }, [holes, format, match]);

  // Memoized save function (used for immediate saves like drive selection)
  const saveHole = useCallback(async (k: string, nextInput: any) => {
    if (!match?.id || roundLocked || !canEdit) return;
    try {
      await updateDoc(doc(db, "matches", match.id), { [`holes.${k}.input`]: nextInput });
    } catch (e) {
      console.error("Save failed", e);
    }
  }, [match?.id, roundLocked, canEdit]);

  // Debounced save for score inputs - prevents Firestore writes on every keystroke
  // Uses 400ms delay so typing "45" only fires one save with "45", not two saves
  const { debouncedSave: debouncedSaveHole } = useDebouncedSave(saveHole, 400);

  // DRIVE_TRACKING: Get current drive selection for a hole
  function getDriveValue(hole: typeof holes[0], team: "A" | "B"): 0 | 1 | null {
    const { input } = hole;
    const v = team === "A" ? input?.teamADrive : input?.teamBDrive;
    return v === 0 || v === 1 ? v : null;
  }

  // DRIVE_TRACKING: Update drive selection for a hole (playerIdx can be null to clear)
  const updateDrive = useCallback((hole: typeof holes[0], team: "A" | "B", playerIdx: 0 | 1 | null) => {
    const { k, input } = hole;
    
    if (format === "twoManScramble") {
      const newInput = {
        teamAGross: input?.teamAGross ?? null,
        teamBGross: input?.teamBGross ?? null,
        teamADrive: team === "A" ? playerIdx : (input?.teamADrive ?? null),
        teamBDrive: team === "B" ? playerIdx : (input?.teamBDrive ?? null),
      };
      saveHole(k, newInput);
    } else if (format === "twoManShamble") {
      const newInput = {
        teamAPlayersGross: input?.teamAPlayersGross ?? [null, null],
        teamBPlayersGross: input?.teamBPlayersGross ?? [null, null],
        teamADrive: team === "A" ? playerIdx : (input?.teamADrive ?? null),
        teamBDrive: team === "B" ? playerIdx : (input?.teamBDrive ?? null),
      };
      saveHole(k, newInput);
    }
  }, [format, saveHole]);

  // DRIVE_TRACKING: Handle modal selection
  const handleDriveSelect = useCallback((playerIdx: 0 | 1 | null) => {
    if (driveModal) {
      updateDrive(driveModal.hole, driveModal.team, playerIdx);
      setDriveModal(null);
    }
  }, [driveModal, updateDrive]);

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

  // Memoized getter functions for PlayerScoreRow - lookup by hole key
  const createGetCellValue = useCallback((team: "A" | "B", pIdx: number) => {
    return (holeKey: string): number | "" => {
      const hole = holes.find(h => h.k === holeKey);
      if (!hole) return "";
      const { input } = hole;
      if (format === "twoManScramble") {
        const v = team === "A" ? input?.teamAGross : input?.teamBGross;
        return v ?? "";
      }
      if (format === "singles") {
        const v = team === "A" ? input?.teamAPlayerGross : input?.teamBPlayerGross;
        return v ?? "";
      }
      const arr = team === "A" ? input?.teamAPlayersGross : input?.teamBPlayersGross;
      return Array.isArray(arr) ? (arr[pIdx] ?? "") : "";
    };
  }, [holes, format]);

  const createHasStroke = useCallback((team: "A" | "B", pIdx: number) => {
    return (holeIdx: number): boolean => {
      const roster = team === "A" ? match?.teamAPlayers : match?.teamBPlayers;
      return (roster?.[pIdx]?.strokesReceived?.[holeIdx] ?? 0) > 0;
    };
  }, [match?.teamAPlayers, match?.teamBPlayers]);

  const createGetDriveValue = useCallback((team: "A" | "B") => {
    return (holeKey: string): 0 | 1 | null => {
      const hole = holes.find(h => h.k === holeKey);
      if (!hole) return null;
      const v = team === "A" ? hole.input?.teamADrive : hole.input?.teamBDrive;
      return v === 0 || v === 1 ? v : null;
    };
  }, [holes]);

  const createGetLowScoreStatus = useCallback((team: "A" | "B", pIdx: number) => {
    return (holeKey: string): 'solo' | 'tied' | null => {
      if (format !== "twoManBestBall" && format !== "twoManShamble") return null;
      const hole = holes.find(h => h.k === holeKey);
      if (!hole) return null;
      
      const { input, num } = hole;
      const holeIdx = num - 1;
      const arr = team === "A" ? input?.teamAPlayersGross : input?.teamBPlayersGross;
      
      if (!Array.isArray(arr)) return null;
      
      const p0Gross = arr[0];
      const p1Gross = arr[1];
      
      if (p0Gross == null || p1Gross == null) return null;
      
      if (format === "twoManShamble") {
        if (p0Gross === p1Gross) return 'tied';
        if (pIdx === 0 && p0Gross < p1Gross) return 'solo';
        if (pIdx === 1 && p1Gross < p0Gross) return 'solo';
        return null;
      }
      
      const roster = team === "A" ? match?.teamAPlayers : match?.teamBPlayers;
      const p0Stroke = (roster?.[0]?.strokesReceived?.[holeIdx] ?? 0) > 0 ? 1 : 0;
      const p1Stroke = (roster?.[1]?.strokesReceived?.[holeIdx] ?? 0) > 0 ? 1 : 0;
      
      const p0Net = p0Gross - p0Stroke;
      const p1Net = p1Gross - p1Stroke;
      
      if (p0Net === p1Net) return 'tied';
      if (pIdx === 0 && p0Net < p1Net) return 'solo';
      if (pIdx === 1 && p1Net < p0Net) return 'solo';
      return null;
    };
  }, [holes, format, match?.teamAPlayers, match?.teamBPlayers]);

  // Create stable getter instances for each player row
  const getCellValueA0 = useMemo(() => createGetCellValue("A", 0), [createGetCellValue]);
  const getCellValueA1 = useMemo(() => createGetCellValue("A", 1), [createGetCellValue]);
  const getCellValueB0 = useMemo(() => createGetCellValue("B", 0), [createGetCellValue]);
  const getCellValueB1 = useMemo(() => createGetCellValue("B", 1), [createGetCellValue]);
  
  const hasStrokeA0 = useMemo(() => createHasStroke("A", 0), [createHasStroke]);
  const hasStrokeA1 = useMemo(() => createHasStroke("A", 1), [createHasStroke]);
  const hasStrokeB0 = useMemo(() => createHasStroke("B", 0), [createHasStroke]);
  const hasStrokeB1 = useMemo(() => createHasStroke("B", 1), [createHasStroke]);
  
  const getDriveValueA = useMemo(() => createGetDriveValue("A"), [createGetDriveValue]);
  const getDriveValueB = useMemo(() => createGetDriveValue("B"), [createGetDriveValue]);
  
  const getLowScoreStatusA0 = useMemo(() => createGetLowScoreStatus("A", 0), [createGetLowScoreStatus]);
  const getLowScoreStatusA1 = useMemo(() => createGetLowScoreStatus("A", 1), [createGetLowScoreStatus]);
  const getLowScoreStatusB0 = useMemo(() => createGetLowScoreStatus("B", 0), [createGetLowScoreStatus]);
  const getLowScoreStatusB1 = useMemo(() => createGetLowScoreStatus("B", 1), [createGetLowScoreStatus]);

  // Check if hole is locked (includes auth check)
  const isHoleLocked = useCallback((holeNum: number) => {
    // Can't edit if: round locked, match closed past this hole, OR user can't edit
    return roundLocked || (isMatchClosed && holeNum > matchThru) || !canEdit;
  }, [roundLocked, isMatchClosed, matchThru, canEdit]);

  // Helper to build new input object based on format
  const buildNewInput = useCallback((hole: typeof holes[0], team: "A" | "B", pIdx: number, value: number | null) => {
    const { input } = hole;
    
    if (format === "twoManScramble") {
      return {
        teamAGross: team === "A" ? value : (input?.teamAGross ?? null),
        teamBGross: team === "B" ? value : (input?.teamBGross ?? null),
        ...(input?.teamADrive != null && { teamADrive: input.teamADrive }),
        ...(input?.teamBDrive != null && { teamBDrive: input.teamBDrive }),
      };
    }
    
    if (format === "singles") {
      return {
        teamAPlayerGross: team === "A" ? value : (input?.teamAPlayerGross ?? null),
        teamBPlayerGross: team === "B" ? value : (input?.teamBPlayerGross ?? null),
      };
    }
    
    // Best Ball & Shamble: individual player scores
    const aArr = Array.isArray(input?.teamAPlayersGross) ? [...input.teamAPlayersGross] : [null, null];
    const bArr = Array.isArray(input?.teamBPlayersGross) ? [...input.teamBPlayersGross] : [null, null];
    
    if (team === "A") aArr[pIdx] = value;
    else bArr[pIdx] = value;
    
    if (format === "twoManShamble") {
      return { 
        teamAPlayersGross: aArr, 
        teamBPlayersGross: bArr,
        ...(input?.teamADrive != null && { teamADrive: input.teamADrive }),
        ...(input?.teamBDrive != null && { teamBDrive: input.teamBDrive }),
      };
    }
    
    return { teamAPlayersGross: aArr, teamBPlayersGross: bArr };
  }, [format]);

  // Memoized cell change handlers for each player row (prevents re-creating on every render)
  const createCellChangeHandler = useCallback((team: "A" | "B", pIdx: number) => {
    return (holeKey: string, value: number | null) => {
      const hole = holes.find(h => h.k === holeKey);
      if (!hole) return;
      
      const newInput = buildNewInput(hole, team, pIdx, value);
      
      // Check if this score change would close the match (and match isn't already closed)
      if (!isMatchClosed) {
        const closeCheck = wouldCloseMatch(
          holes,
          holeKey,
          newInput,
          format,
          match?.teamAPlayers,
          match?.teamBPlayers
        );
        
        if (closeCheck.wouldClose) {
          // Show confirmation modal instead of saving
          setConfirmCloseModal({
            holeKey,
            pendingInput: newInput,
            winner: closeCheck.winner,
            margin: closeCheck.margin,
            thru: closeCheck.thru,
          });
          return;
        }
      }
      
      // Not closing match, save normally with debounce
      debouncedSaveHole(holeKey, newInput);
    };
  }, [holes, format, debouncedSaveHole, isMatchClosed, match?.teamAPlayers, match?.teamBPlayers, buildNewInput]);

  // Handle confirm close - save the pending score
  const handleConfirmClose = useCallback(async () => {
    if (!confirmCloseModal) return;
    
    // Save immediately (no debounce) since user confirmed
    await saveHole(confirmCloseModal.holeKey, confirmCloseModal.pendingInput);
    setConfirmCloseModal(null);
  }, [confirmCloseModal, saveHole]);

  // Handle cancel close - don't save, clear modal
  const handleCancelClose = useCallback(() => {
    setConfirmCloseModal(null);
  }, []);

  // Create stable handlers for each player row
  const cellChangeHandlerA0 = useMemo(() => createCellChangeHandler("A", 0), [createCellChangeHandler]);
  const cellChangeHandlerA1 = useMemo(() => createCellChangeHandler("A", 1), [createCellChangeHandler]);
  const cellChangeHandlerB0 = useMemo(() => createCellChangeHandler("B", 0), [createCellChangeHandler]);
  const cellChangeHandlerB1 = useMemo(() => createCellChangeHandler("B", 1), [createCellChangeHandler]);

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
        // Scramble: one gross score per team
        const aGross = input?.teamAGross ?? null;
        const bGross = input?.teamBGross ?? null;
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
      } else if (format === "twoManShamble") {
        // Shamble: individual player scores, best GROSS (no strokes)
        const aArr = input?.teamAPlayersGross;
        const bArr = input?.teamBPlayersGross;
        
        const a0 = Array.isArray(aArr) ? aArr[0] : null;
        const a1 = Array.isArray(aArr) ? aArr[1] : null;
        const b0 = Array.isArray(bArr) ? bArr[0] : null;
        const b1 = Array.isArray(bArr) ? bArr[1] : null;
        
        holeComplete = a0 != null && a1 != null && b0 != null && b1 != null;
        
        if (holeComplete) {
          // Best GROSS for each team (no handicap strokes in shamble)
          teamAScore = Math.min(a0!, a1!);
          teamBScore = Math.min(b0!, b1!);
        }
      } else {
        // Best Ball only - calculate net for each player, then take best
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
  // Four player rows: Best Ball and Shamble (individual player scores)
  const isFourPlayerRows = format === "twoManBestBall" || format === "twoManShamble";

  // Build player rows config with memoized handlers and getters
  type PlayerRowConfig = { 
    team: "A" | "B"; 
    pIdx: number; 
    label: string; 
    color: string;
    onCellChange: (holeKey: string, value: number | null) => void;
    getCellValue: (holeKey: string) => number | "";
    hasStroke: (holeIdx: number) => boolean;
    getDriveValue: (holeKey: string) => 0 | 1 | null;
    getLowScoreStatus: (holeKey: string) => 'solo' | 'tied' | null;
  };
  const playerRows: PlayerRowConfig[] = [];
  
  if (isFourPlayerRows) {
    // 4 players: A1, A2, B1, B2 (Best Ball & Shamble)
    playerRows.push(
      { team: "A", pIdx: 0, label: getPlayerName(match.teamAPlayers?.[0]?.playerId), color: tournament?.teamA?.color || "var(--team-a-default)", onCellChange: cellChangeHandlerA0, getCellValue: getCellValueA0, hasStroke: hasStrokeA0, getDriveValue: getDriveValueA, getLowScoreStatus: getLowScoreStatusA0 },
      { team: "A", pIdx: 1, label: getPlayerName(match.teamAPlayers?.[1]?.playerId), color: tournament?.teamA?.color || "var(--team-a-default)", onCellChange: cellChangeHandlerA1, getCellValue: getCellValueA1, hasStroke: hasStrokeA1, getDriveValue: getDriveValueA, getLowScoreStatus: getLowScoreStatusA1 },
      { team: "B", pIdx: 0, label: getPlayerName(match.teamBPlayers?.[0]?.playerId), color: tournament?.teamB?.color || "var(--team-b-default)", onCellChange: cellChangeHandlerB0, getCellValue: getCellValueB0, hasStroke: hasStrokeB0, getDriveValue: getDriveValueB, getLowScoreStatus: getLowScoreStatusB0 },
      { team: "B", pIdx: 1, label: getPlayerName(match.teamBPlayers?.[1]?.playerId), color: tournament?.teamB?.color || "var(--team-b-default)", onCellChange: cellChangeHandlerB1, getCellValue: getCellValueB1, hasStroke: hasStrokeB1, getDriveValue: getDriveValueB, getLowScoreStatus: getLowScoreStatusB1 },
    );
  } else if (isTeamFormat) {
    // 2 rows with TEAM NAMES for scramble only
    playerRows.push(
      { team: "A", pIdx: 0, label: tournament?.teamA?.name || "Team A", color: tournament?.teamA?.color || "var(--team-a-default)", onCellChange: cellChangeHandlerA0, getCellValue: getCellValueA0, hasStroke: hasStrokeA0, getDriveValue: getDriveValueA, getLowScoreStatus: getLowScoreStatusA0 },
      { team: "B", pIdx: 0, label: tournament?.teamB?.name || "Team B", color: tournament?.teamB?.color || "var(--team-b-default)", onCellChange: cellChangeHandlerB0, getCellValue: getCellValueB0, hasStroke: hasStrokeB0, getDriveValue: getDriveValueB, getLowScoreStatus: getLowScoreStatusB0 },
    );
  } else {
    // 2 rows: Player A, Player B (singles)
    playerRows.push(
      { team: "A", pIdx: 0, label: getPlayerName(match.teamAPlayers?.[0]?.playerId), color: tournament?.teamA?.color || "var(--team-a-default)", onCellChange: cellChangeHandlerA0, getCellValue: getCellValueA0, hasStroke: hasStrokeA0, getDriveValue: getDriveValueA, getLowScoreStatus: getLowScoreStatusA0 },
      { team: "B", pIdx: 0, label: getPlayerName(match.teamBPlayers?.[0]?.playerId), color: tournament?.teamB?.color || "var(--team-b-default)", onCellChange: cellChangeHandlerB0, getCellValue: getCellValueB0, hasStroke: hasStrokeB0, getDriveValue: getDriveValueB, getLowScoreStatus: getLowScoreStatusB0 },
    );
  }

  const cellWidth = 44;
  const labelWidth = 120;
  const totalColWidth = 48;

  // Match state variables
  const winner = match.result?.winner;
  const leader = match.status?.leader;

  return (
    <Layout title={tName} series={tSeries} showBack tournamentLogo={tournament?.tournamentLogo}>
      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        
        {/* MATCH STATUS HEADER */}
        <div className="space-y-3">
          {/* Top row: centered format pill with auth status on the right */}
          <div className="relative">
            <div className="flex justify-center">
              <div 
                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium"
                style={{ backgroundColor: "#f1f5f9", color: "#64748b" }}
              >
                <span>{formatRoundType(format)}</span>
              </div>
            </div>

            {/* Auth status - positioned to the right, inline with pill */}
            {editBlockReason && !roundLocked && !isMatchClosed && (
              <div className="absolute right-0 top-1/2 -translate-y-1/2 text-xs pr-2" style={{ color: "#94a3b8" }}>
                {editBlockReason === "login" && (
                  <Link to="/login" className="underline hover:text-slate-600">Login to edit</Link>
                )}
                {editBlockReason === "not-rostered" && (
                  <span>👀 Spectating</span>
                )}
              </div>
            )}
          </div>
          
          {/* Main status display - matches Round page tile styling */}
          {(() => {
            // Determine styling based on match state
            let bgStyle: React.CSSProperties = {};
            let borderStyle: React.CSSProperties = {};
            
            if (isMatchClosed && winner && winner !== "AS") {
              // Completed match with a winner - full team color background
              const winnerColor = winner === "teamA" 
                ? (tournament?.teamA?.color || "var(--team-a-default)")
                : (tournament?.teamB?.color || "var(--team-b-default)");
              bgStyle = { backgroundColor: winnerColor };
            } else if (isMatchClosed && winner === "AS") {
              // Halved match - grey background with team color borders
              bgStyle = { backgroundColor: "#cbd5e1" };
              borderStyle = {
                borderLeft: `4px solid ${tournament?.teamA?.color || 'var(--team-a-default)'}`,
                borderRight: `4px solid ${tournament?.teamB?.color || 'var(--team-b-default)'}`
              };
            } else if (leader === 'teamA') {
              const borderColor = tournament?.teamA?.color || "var(--team-a-default)";
              bgStyle = { background: `linear-gradient(90deg, ${borderColor}11 0%, transparent 30%)` };
              borderStyle = { borderLeft: `4px solid ${borderColor}`, borderRight: '4px solid transparent' };
            } else if (leader === 'teamB') {
              const borderColor = tournament?.teamB?.color || "var(--team-b-default)";
              bgStyle = { background: `linear-gradient(-90deg, ${borderColor}11 0%, transparent 30%)` };
              borderStyle = { borderRight: `4px solid ${borderColor}`, borderLeft: '4px solid transparent' };
            }

            // Get status color for in-progress matches
            let statusColor: string;
            if (leader === 'teamA') {
              statusColor = tournament?.teamA?.color || "var(--team-a-default)";
            } else if (leader === 'teamB') {
              statusColor = tournament?.teamB?.color || "var(--team-b-default)";
            } else {
              statusColor = "#94a3b8";
            }

            return (
              <div 
                className="card"
                style={{ 
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '12px 16px',
                  ...bgStyle,
                  ...borderStyle
                }}
              >
                {isMatchClosed ? (
                  // Completed match
                  winner === 'AS' ? (
                    // Halved/Tied match
                    <>
                      <div style={{ 
                        whiteSpace: 'nowrap',
                        fontSize: '1rem',
                        fontWeight: 700,
                        color: '#334155'
                      }}>
                        TIED
                      </div>
                      <div style={{ 
                        fontSize: '0.65rem', 
                        fontWeight: 600, 
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        FINAL
                      </div>
                    </>
                  ) : (
                    // Match with a winner
                    <>
                      <div style={{ 
                        fontSize: '0.65rem', 
                        fontWeight: 600, 
                        color: 'rgba(255,255,255,0.85)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        {winner === 'teamA' 
                          ? (tournament?.teamA?.name || 'Team A')
                          : (tournament?.teamB?.name || 'Team B')
                        }
                      </div>
                      <div style={{ 
                        whiteSpace: 'nowrap',
                        fontSize: '1rem',
                        fontWeight: 700,
                        color: 'white'
                      }}>
                        {(() => {
                          const statusText = formatMatchStatus(match.status, tournament?.teamA?.name, tournament?.teamB?.name);
                          return statusText.includes("wins") ? statusText.split(" wins ")[1] : statusText;
                        })()}
                      </div>
                      <div style={{ 
                        fontSize: '0.65rem', 
                        fontWeight: 600, 
                        color: 'rgba(255,255,255,0.85)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        FINAL
                      </div>
                    </>
                  )
                ) : matchThru > 0 && leader ? (
                  // In progress with leader
                  <>
                    <div style={{ 
                      fontSize: '0.65rem', 
                      fontWeight: 600, 
                      color: statusColor,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      {leader === 'teamA' 
                        ? (tournament?.teamA?.name || 'Team A')
                        : (tournament?.teamB?.name || 'Team B')
                      }
                    </div>
                    <div style={{ 
                      whiteSpace: 'nowrap',
                      fontSize: '1rem',
                      fontWeight: 700,
                      color: statusColor
                    }}>
                      {match.status?.margin} UP
                    </div>
                    <div style={{ 
                      fontSize: '0.65rem', 
                      fontWeight: 600, 
                      color: '#94a3b8',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      THRU {matchThru}
                    </div>
                  </>
                ) : matchThru > 0 ? (
                  // In progress, All Square
                  <>
                    <div style={{ 
                      whiteSpace: 'nowrap',
                      fontSize: '1rem',
                      fontWeight: 700,
                      color: '#94a3b8'
                    }}>
                      ALL SQUARE
                    </div>
                    <div style={{ 
                      fontSize: '0.65rem', 
                      fontWeight: 600, 
                      color: '#94a3b8',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      THRU {matchThru}
                    </div>
                  </>
                ) : (
                  // Not started
                  <div style={{ 
                    whiteSpace: 'nowrap',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#94a3b8'
                  }}>
                    Not Started
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* DRIVE_TRACKING: Drives Tracker Banner */}
        {trackDrives && drivesUsed && drivesNeeded && !isMatchClosed && (
          <div className="card p-3 space-y-2">
            <div className="text-xs font-bold uppercase text-slate-500">Drives Tracker</div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {/* Team A */}
              <div>
                <div className="font-semibold" style={{ color: teamAColor }}>{tournament?.teamA?.name || "Team A"}</div>
                <div className="flex flex-col gap-1 mt-1">
                  <div>
                    <span className="text-slate-500">{getPlayerShortName(match.teamAPlayers?.[0]?.playerId)}:</span>{" "}
                    <span className={`font-bold ${drivesNeeded.teamA[0] > 0 ? "text-red-500" : "text-green-600"}`}>
                      {drivesUsed.teamA[0]}/6
                    </span>
                    {drivesNeeded.teamA[0] > 0 && (
                      <span className="text-red-500 text-xs ml-1">⚠️ Need {drivesNeeded.teamA[0]}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-500">{getPlayerShortName(match.teamAPlayers?.[1]?.playerId)}:</span>{" "}
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
                <div className="flex flex-col gap-1 mt-1">
                  <div>
                    <span className="text-slate-500">{getPlayerShortName(match.teamBPlayers?.[0]?.playerId)}:</span>{" "}
                    <span className={`font-bold ${drivesNeeded.teamB[0] > 0 ? "text-red-500" : "text-green-600"}`}>
                      {drivesUsed.teamB[0]}/6
                    </span>
                    {drivesNeeded.teamB[0] > 0 && (
                      <span className="text-red-500 text-xs ml-1">⚠️ Need {drivesNeeded.teamB[0]}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-500">{getPlayerShortName(match.teamBPlayers?.[1]?.playerId)}:</span>{" "}
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

                {/* Yardage Row */}
                <tr className="bg-slate-50 text-slate-900 text-xs border-b border-slate-200">
                  <td className="sticky left-0 z-10 bg-slate-50 text-left px-3 py-1 capitalize">{course?.tees || round?.course?.tee || 'Yards'}</td>
                  {holes.slice(0, 9).map(h => (
                    <td key={h.k} className="py-1">{h.yards || ""}</td>
                  ))}
                  <td className="py-1 bg-slate-100 border-l-2 border-slate-200">
                    {holes.slice(0, 9).reduce((sum, h) => sum + (h.yards || 0), 0) || ""}
                  </td>
                  {holes.slice(9, 18).map((h, i) => (
                    <td key={h.k} className={`py-1 ${i === 0 ? "border-l-2 border-slate-200" : ""}`}>{h.yards || ""}</td>
                  ))}
                  <td className="py-1 bg-slate-100 border-l-2 border-slate-200">
                    {holes.slice(9, 18).reduce((sum, h) => sum + (h.yards || 0), 0) || ""}
                  </td>
                  <td className="py-1 bg-slate-200">
                    {holes.reduce((sum, h) => sum + (h.yards || 0), 0) || ""}
                  </td>
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

                {/* Team A Player Rows - Using memoized PlayerScoreRow */}
                {playerRows.filter(pr => pr.team === "A").map((pr, rowIdx, teamRows) => (
                  <PlayerScoreRow
                    key={`row-${pr.team}-${pr.pIdx}`}
                    team={pr.team}
                    pIdx={pr.pIdx}
                    label={pr.label}
                    color={pr.color}
                    holes={holes}
                    isLastOfTeam={rowIdx === teamRows.length - 1}
                    trackDrives={trackDrives}
                    getCellValue={pr.getCellValue}
                    isHoleLocked={isHoleLocked}
                    hasStroke={pr.hasStroke}
                    getDriveValue={pr.getDriveValue}
                    getLowScoreStatus={pr.getLowScoreStatus}
                    onCellChange={pr.onCellChange}
                    outTotal={totals.getOut(pr.team, pr.pIdx)}
                    inTotal={totals.getIn(pr.team, pr.pIdx)}
                    totalScore={totals.getTotal(pr.team, pr.pIdx)}
                  />
                ))}

                {/* Team A Score Row (Best Ball: low net, Shamble: low gross) */}
                {(format === "twoManBestBall" || format === "twoManShamble") && (
                  <tr style={{ backgroundColor: teamAColor }}>
                    <td className="sticky left-0 z-10 text-left px-3 py-1.5 text-white text-xs font-bold uppercase tracking-wide whitespace-nowrap overflow-hidden text-ellipsis" style={{ backgroundColor: teamAColor }}>
                      {tournament?.teamA?.name || "Team A"}
                    </td>
                    {/* Front 9 low score */}
                    {holes.slice(0, 9).map(h => {
                      const lowScore = getTeamLowScore(h, "A");
                      return (
                        <td key={`teamA-${h.k}`} className="py-1 text-center text-white font-bold text-sm">
                          {lowScore ?? ""}
                        </td>
                      );
                    })}
                    {/* OUT total */}
                    <td className="py-1 text-center text-white font-bold border-l-2 border-white/30" style={{ backgroundColor: "rgba(0,0,0,0.15)" }}>
                      {teamLowScoreTotals?.getOut("A") ?? "–"}
                    </td>
                    {/* Back 9 low score */}
                    {holes.slice(9, 18).map((h, i) => {
                      const lowScore = getTeamLowScore(h, "A");
                      return (
                        <td key={`teamA-${h.k}`} className={`py-1 text-center text-white font-bold text-sm ${i === 0 ? "border-l-2 border-white/30" : ""}`}>
                          {lowScore ?? ""}
                        </td>
                      );
                    })}
                    {/* IN total */}
                    <td className="py-1 text-center text-white font-bold border-l-2 border-white/30" style={{ backgroundColor: "rgba(0,0,0,0.15)" }}>
                      {teamLowScoreTotals?.getIn("A") ?? "–"}
                    </td>
                    {/* TOTAL */}
                    <td className="py-1 text-center text-white font-extrabold text-base" style={{ backgroundColor: "rgba(0,0,0,0.25)" }}>
                      {teamLowScoreTotals?.getTotal("A") ?? "–"}
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

                {/* Team B Score Row (Best Ball: low net, Shamble: low gross) */}
                {(format === "twoManBestBall" || format === "twoManShamble") && (
                  <tr style={{ backgroundColor: teamBColor }}>
                    <td className="sticky left-0 z-10 text-left px-3 py-1.5 text-white text-xs font-bold uppercase tracking-wide whitespace-nowrap overflow-hidden text-ellipsis" style={{ backgroundColor: teamBColor }}>
                      {tournament?.teamB?.name || "Team B"}
                    </td>
                    {/* Front 9 low score */}
                    {holes.slice(0, 9).map(h => {
                      const lowScore = getTeamLowScore(h, "B");
                      return (
                        <td key={`teamB-${h.k}`} className="py-1 text-center text-white font-bold text-sm">
                          {lowScore ?? ""}
                        </td>
                      );
                    })}
                    {/* OUT total */}
                    <td className="py-1 text-center text-white font-bold border-l-2 border-white/30" style={{ backgroundColor: "rgba(0,0,0,0.15)" }}>
                      {teamLowScoreTotals?.getOut("B") ?? "–"}
                    </td>
                    {/* Back 9 low score */}
                    {holes.slice(9, 18).map((h, i) => {
                      const lowScore = getTeamLowScore(h, "B");
                      return (
                        <td key={`teamB-${h.k}`} className={`py-1 text-center text-white font-bold text-sm ${i === 0 ? "border-l-2 border-white/30" : ""}`}>
                          {lowScore ?? ""}
                        </td>
                      );
                    })}
                    {/* IN total */}
                    <td className="py-1 text-center text-white font-bold border-l-2 border-white/30" style={{ backgroundColor: "rgba(0,0,0,0.15)" }}>
                      {teamLowScoreTotals?.getIn("B") ?? "–"}
                    </td>
                    {/* TOTAL */}
                    <td className="py-1 text-center text-white font-extrabold text-base" style={{ backgroundColor: "rgba(0,0,0,0.25)" }}>
                      {teamLowScoreTotals?.getTotal("B") ?? "–"}
                    </td>
                  </tr>
                )}

                {/* Team B Player Rows - Using memoized PlayerScoreRow */}
                {playerRows.filter(pr => pr.team === "B").map((pr, rowIdx, teamRows) => (
                  <PlayerScoreRow
                    key={`row-${pr.team}-${pr.pIdx}`}
                    team={pr.team}
                    pIdx={pr.pIdx}
                    label={pr.label}
                    color={pr.color}
                    holes={holes}
                    isLastOfTeam={rowIdx === teamRows.length - 1}
                    isTeamB={true}
                    trackDrives={trackDrives}
                    getCellValue={pr.getCellValue}
                    isHoleLocked={isHoleLocked}
                    hasStroke={pr.hasStroke}
                    getDriveValue={pr.getDriveValue}
                    getLowScoreStatus={pr.getLowScoreStatus}
                    onCellChange={pr.onCellChange}
                    outTotal={totals.getOut(pr.team, pr.pIdx)}
                    inTotal={totals.getIn(pr.team, pr.pIdx)}
                    totalScore={totals.getTotal(pr.team, pr.pIdx)}
                  />
                ))}

                {/* DRIVE SELECTOR ROWS - Inside scorecard table */}
                {trackDrives && (
                  <>
                    {/* Team A Drive Row */}
                    <tr style={{ backgroundColor: teamAColor + "15" }}>
                      <td 
                        className="sticky left-0 z-10 text-left px-3 py-1.5 font-semibold whitespace-nowrap text-xs"
                        style={{ backgroundColor: teamAColor + "15", color: teamAColor }}
                      >
                        {tournament?.teamA?.name || "Team A"} Drive
                      </td>
                      {/* Front 9 */}
                      {holes.slice(0, 9).map(h => {
                        const locked = isHoleLocked(h.num);
                        const currentDrive = getDriveValue(h, "A");
                        const initials = currentDrive === 0 
                          ? getPlayerInitials(match.teamAPlayers?.[0]?.playerId)
                          : currentDrive === 1 
                            ? getPlayerInitials(match.teamAPlayers?.[1]?.playerId)
                            : null;
                        return (
                          <td key={`driveA-${h.k}`} className="p-0.5" style={{ width: cellWidth, minWidth: cellWidth }}>
                            <button
                              type="button"
                              disabled={locked || isMatchClosed}
                              onClick={() => setDriveModal({ hole: h, team: "A" })}
                              className={`
                                w-10 h-7 text-xs font-bold rounded border transition-colors
                                ${locked || isMatchClosed
                                  ? "bg-slate-50 text-slate-600 border-slate-200 cursor-default"
                                  : initials
                                    ? "text-white border-transparent"
                                    : "bg-white border-slate-300 text-slate-400 hover:border-slate-400 hover:bg-slate-50"
                                }
                              `}
                              style={initials && !locked ? { backgroundColor: teamAColor } : {}}
                            >
                              {initials || "–"}
                            </button>
                          </td>
                        );
                      })}
                      {/* OUT spacer */}
                      <td className="bg-slate-100 border-l-2 border-slate-200" style={{ width: totalColWidth, minWidth: totalColWidth }}></td>
                      {/* Back 9 */}
                      {holes.slice(9, 18).map((h, i) => {
                        const locked = isHoleLocked(h.num);
                        const currentDrive = getDriveValue(h, "A");
                        const initials = currentDrive === 0 
                          ? getPlayerInitials(match.teamAPlayers?.[0]?.playerId)
                          : currentDrive === 1 
                            ? getPlayerInitials(match.teamAPlayers?.[1]?.playerId)
                            : null;
                        return (
                          <td key={`driveA-${h.k}`} className={`p-0.5 ${i === 0 ? "border-l-2 border-slate-200" : ""}`} style={{ width: cellWidth, minWidth: cellWidth }}>
                            <button
                              type="button"
                              disabled={locked || isMatchClosed}
                              onClick={() => setDriveModal({ hole: h, team: "A" })}
                              className={`
                                w-10 h-7 text-xs font-bold rounded border transition-colors
                                ${locked || isMatchClosed
                                  ? "bg-slate-50 text-slate-600 border-slate-200 cursor-default"
                                  : initials
                                    ? "text-white border-transparent"
                                    : "bg-white border-slate-300 text-slate-400 hover:border-slate-400 hover:bg-slate-50"
                                }
                              `}
                              style={initials && !locked ? { backgroundColor: teamAColor } : {}}
                            >
                              {initials || "–"}
                            </button>
                          </td>
                        );
                      })}
                      {/* IN spacer */}
                      <td className="bg-slate-100 border-l-2 border-slate-200" style={{ width: totalColWidth, minWidth: totalColWidth }}></td>
                      {/* TOT spacer */}
                      <td className="bg-slate-200" style={{ width: totalColWidth, minWidth: totalColWidth }}></td>
                    </tr>
                    {/* Team B Drive Row */}
                    <tr style={{ backgroundColor: teamBColor + "15" }}>
                      <td 
                        className="sticky left-0 z-10 text-left px-3 py-1.5 font-semibold whitespace-nowrap text-xs"
                        style={{ backgroundColor: teamBColor + "15", color: teamBColor }}
                      >
                        {tournament?.teamB?.name || "Team B"} Drive
                      </td>
                      {/* Front 9 */}
                      {holes.slice(0, 9).map(h => {
                        const locked = isHoleLocked(h.num);
                        const currentDrive = getDriveValue(h, "B");
                        const initials = currentDrive === 0 
                          ? getPlayerInitials(match.teamBPlayers?.[0]?.playerId)
                          : currentDrive === 1 
                            ? getPlayerInitials(match.teamBPlayers?.[1]?.playerId)
                            : null;
                        return (
                          <td key={`driveB-${h.k}`} className="p-0.5" style={{ width: cellWidth, minWidth: cellWidth }}>
                            <button
                              type="button"
                              disabled={locked || isMatchClosed}
                              onClick={() => setDriveModal({ hole: h, team: "B" })}
                              className={`
                                w-10 h-7 text-xs font-bold rounded border transition-colors
                                ${locked || isMatchClosed
                                  ? "bg-slate-50 text-slate-600 border-slate-200 cursor-default"
                                  : initials
                                    ? "text-white border-transparent"
                                    : "bg-white border-slate-300 text-slate-400 hover:border-slate-400 hover:bg-slate-50"
                                }
                              `}
                              style={initials && !locked ? { backgroundColor: teamBColor } : {}}
                            >
                              {initials || "–"}
                            </button>
                          </td>
                        );
                      })}
                      {/* OUT spacer */}
                      <td className="bg-slate-100 border-l-2 border-slate-200" style={{ width: totalColWidth, minWidth: totalColWidth }}></td>
                      {/* Back 9 */}
                      {holes.slice(9, 18).map((h, i) => {
                        const locked = isHoleLocked(h.num);
                        const currentDrive = getDriveValue(h, "B");
                        const initials = currentDrive === 0 
                          ? getPlayerInitials(match.teamBPlayers?.[0]?.playerId)
                          : currentDrive === 1 
                            ? getPlayerInitials(match.teamBPlayers?.[1]?.playerId)
                            : null;
                        return (
                          <td key={`driveB-${h.k}`} className={`p-0.5 ${i === 0 ? "border-l-2 border-slate-200" : ""}`} style={{ width: cellWidth, minWidth: cellWidth }}>
                            <button
                              type="button"
                              disabled={locked || isMatchClosed}
                              onClick={() => setDriveModal({ hole: h, team: "B" })}
                              className={`
                                w-10 h-7 text-xs font-bold rounded border transition-colors
                                ${locked || isMatchClosed
                                  ? "bg-slate-50 text-slate-600 border-slate-200 cursor-default"
                                  : initials
                                    ? "text-white border-transparent"
                                    : "bg-white border-slate-300 text-slate-400 hover:border-slate-400 hover:bg-slate-50"
                                }
                              `}
                              style={initials && !locked ? { backgroundColor: teamBColor } : {}}
                            >
                              {initials || "–"}
                            </button>
                          </td>
                        );
                      })}
                      {/* IN spacer */}
                      <td className="bg-slate-100 border-l-2 border-slate-200" style={{ width: totalColWidth, minWidth: totalColWidth }}></td>
                      {/* TOT spacer */}
                      <td className="bg-slate-200" style={{ width: totalColWidth, minWidth: totalColWidth }}></td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MATCH FLOW GRAPH */}
        {match.status?.marginHistory && match.status.marginHistory.length > 0 && (
          <MatchFlowGraph
            marginHistory={match.status.marginHistory}
            teamAColor={teamAColor}
            teamBColor={teamBColor}
            teamALogo={tournament?.teamA?.logo}
            teamBLogo={tournament?.teamB?.logo}
          />
        )}

        {/* POST-MATCH STATS */}
        {isMatchClosed && matchFacts.length > 0 && (
          <PostMatchStats
            matchFacts={matchFacts}
            format={format}
            teamAPlayers={match.teamAPlayers || []}
            teamBPlayers={match.teamBPlayers || []}
            teamAName={tournament?.teamA?.name || "Team A"}
            teamBName={tournament?.teamB?.name || "Team B"}
            teamAColor={teamAColor}
            teamBColor={teamBColor}
            getPlayerName={getPlayerName}
            marginHistory={match.status?.marginHistory}
          />
        )}

        <LastUpdated />

        {/* CONFIRM MATCH CLOSE MODAL */}
        {confirmCloseModal && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={handleCancelClose}
          >
            <div 
              className="bg-white rounded-xl shadow-xl p-6 mx-4 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-center text-slate-800 mb-2">
                End Match?
              </h3>
              <p className="text-center text-slate-600 mb-4">
                {confirmCloseModal.winner === "AS" 
                  ? "This score will end the match All Square."
                  : `This score will close the match ${confirmCloseModal.margin}&${18 - confirmCloseModal.thru} for ${
                      confirmCloseModal.winner === "teamA" 
                        ? (tournament?.teamA?.name || "Team A") 
                        : (tournament?.teamB?.name || "Team B")
                    }.`
                }
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCancelClose}
                  className="flex-1 py-3 px-4 rounded-lg bg-slate-200 text-slate-700 font-semibold text-base transition-transform active:scale-95 hover:bg-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmClose}
                  className="flex-1 py-3 px-4 rounded-lg bg-green-600 text-white font-semibold text-base transition-transform active:scale-95 hover:bg-green-700"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DRIVE SELECTOR MODAL */}
        {driveModal && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setDriveModal(null)}
          >
            <div 
              className="bg-white rounded-xl shadow-xl p-6 mx-4 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-center text-slate-800 mb-4">
                Whose drive for Hole {driveModal.hole.num}?
              </h3>
              <div className="text-xs text-center text-slate-500 mb-3 font-medium" style={{ color: driveModal.team === "A" ? teamAColor : teamBColor }}>
                {driveModal.team === "A" ? (tournament?.teamA?.name || "Team A") : (tournament?.teamB?.name || "Team B")}
              </div>
              <div className="space-y-2">
                {/* Player 1 */}
                <button
                  type="button"
                  onClick={() => handleDriveSelect(0)}
                  className="w-full py-3 px-4 rounded-lg text-white font-semibold text-base transition-transform active:scale-95"
                  style={{ backgroundColor: driveModal.team === "A" ? teamAColor : teamBColor }}
                >
                  {getPlayerName(driveModal.team === "A" 
                    ? match.teamAPlayers?.[0]?.playerId 
                    : match.teamBPlayers?.[0]?.playerId)}
                </button>
                {/* Player 2 */}
                <button
                  type="button"
                  onClick={() => handleDriveSelect(1)}
                  className="w-full py-3 px-4 rounded-lg text-white font-semibold text-base transition-transform active:scale-95"
                  style={{ backgroundColor: driveModal.team === "A" ? teamAColor : teamBColor }}
                >
                  {getPlayerName(driveModal.team === "A" 
                    ? match.teamAPlayers?.[1]?.playerId 
                    : match.teamBPlayers?.[1]?.playerId)}
                </button>
                {/* Clear button */}
                <button
                  type="button"
                  onClick={() => handleDriveSelect(null)}
                  className="w-full py-3 px-4 rounded-lg bg-slate-200 text-slate-600 font-semibold text-base transition-transform active:scale-95 hover:bg-slate-300"
                >
                  Clear
                </button>
              </div>
              {/* Cancel */}
              <button
                type="button"
                onClick={() => setDriveModal(null)}
                className="w-full mt-4 py-2 text-sm text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
