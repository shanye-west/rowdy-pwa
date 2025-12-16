import { useMemo, useState, useCallback, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
// RedirectCountdown removed; using explicit Go Home button instead
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { RoundFormat, HoleInputLoose } from "../types";
import { 
  SCORECARD_CELL_WIDTH, 
  SCORECARD_LABEL_WIDTH, 
  SCORECARD_TOTAL_COL_WIDTH,
  MIN_DRIVES_PER_ROUND,
} from "../constants";
import { formatRoundType } from "../utils";
import { getPlayerName as getPlayerNameFromLookup, getPlayerShortName as getPlayerShortNameFromLookup, getPlayerInitials as getPlayerInitialsFromLookup } from "../utils/playerHelpers";
import Layout from "../components/Layout";
import TeamName from "../components/TeamName";
import LastUpdated from "../components/LastUpdated";
import { SaveStatusIndicator } from "../components/SaveStatusIndicator";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { MatchPageSkeleton } from "../components/Skeleton";
import { useAuth } from "../contexts/AuthContext";
import { 
  MatchFlowGraph, 
  PostMatchStats,
  PlayerScoreRow,
  TeamScoreRow,
  DriveSelectorsSection,
  DrivesTrackerBanner,
  type HoleData,
} from "../components/match";
import { useMatchData } from "../hooks/useMatchData";
import { useDebouncedSave } from "../hooks/useDebouncedSave";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { useVisibilityFlush } from "../hooks/useVisibilityFlush";
import { Modal, ModalActions } from "../components/Modal";
import { MatchStatusBadge, getMatchCardStyles } from "../components/MatchStatusBadge";
import { predictClose, computeRunningStatus, type HoleData as MatchScoringHoleData, type HoleInput } from "../utils/matchScoring";

// --- MATCH CLOSING HELPERS ---

/**
 * Wrapper for predictClose that adapts the Match.tsx holes format to MatchScoringHoleData[]
 */
function wouldCloseMatch(
  holes: Array<{ k: string; num: number; input: any; par: number }>,
  pendingHoleKey: string,
  pendingInput: HoleInput,
  format: RoundFormat,
  teamAPlayers?: any[],
  teamBPlayers?: any[]
): { wouldClose: boolean; winner: "teamA" | "teamB" | "AS" | null; margin: number; thru: number } {
  // Convert holes to HoleData format and find pending hole number
  const holeData: MatchScoringHoleData[] = holes.map(h => ({ num: h.num, input: h.input }));
  const pendingHoleNum = holes.find(h => h.k === pendingHoleKey)?.num ?? 0;
  
  return predictClose(holeData, pendingHoleNum, pendingInput, format, teamAPlayers, teamBPlayers);
}

/**
 * Formats the final match result for display (e.g., "3&2", "1UP", "AS")
 */
function formatFinalResult(margin: number, thru: number): string {
  if (margin === 0) return "AS";
  const holesRemaining = 18 - thru;
  if (holesRemaining === 0) {
    // Match went to 18 - show margin UP
    return `${margin}UP`;
  }
  // Match ended early - show "margin & remaining" format
  return `${margin}&${holesRemaining}`;
}

export default function Match() {
  const { matchId } = useParams();
  const { canEditMatch, player } = useAuth();
  
  // Use custom hook for all data fetching
  const { 
    match, round, course, tournament, players, matchFacts, 
    loading, error,
  } = useMatchData(matchId);
  
  // Simple online/offline tracking
  const { isOnline } = useNetworkStatus();
  
  // Track horizontal scroll position for scroll indicator
  const [canScrollRight, setCanScrollRight] = useState(true);
  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    
    const checkScroll = () => {
      const { scrollLeft, scrollWidth, clientWidth } = node;
      // Show indicator if there's more content to the right (with small buffer)
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
    };
    
    checkScroll();
    node.addEventListener('scroll', checkScroll, { passive: true });
    // Also check on resize
    window.addEventListener('resize', checkScroll);
    
    return () => {
      node.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, []);
  
  // DRIVE_TRACKING: Modal state for drive picker
  const [driveModal, setDriveModal] = useState<{ hole: HoleData; team: "A" | "B" } | null>(null);
  
  // CONFIRM CLOSE: Modal state for confirming match close
  const [confirmCloseModal, setConfirmCloseModal] = useState<{
    holeKey: string;
    pendingInput: HoleInputLoose;
    winner: "teamA" | "teamB" | "AS" | null;
    margin: number;
    thru: number;
  } | null>(null);
  
  // STROKES INFO: Modal state for showing handicap info
  const [strokesInfoModal, setStrokesInfoModal] = useState(false);
  // Tooltip state for small abbreviation definitions (key and screen coords)
  const [defTooltip, setDefTooltip] = useState<{ key: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!strokesInfoModal) setDefTooltip(null);
  }, [strokesInfoModal]);

  const openDefTooltip = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    setDefTooltip({ key, x: rect.right, y: rect.top });
  };

  const format: RoundFormat = (round?.format as RoundFormat) || "twoManBestBall";
  
  // Only scramble uses team-level scoring (one score per team per hole)
  const isTeamFormat = format === "twoManScramble" || format === "fourManScramble";
  
  // DRIVE_TRACKING: Check if drive tracking is enabled for this round (scramble or shamble)
  const trackDrives = !!round?.trackDrives && (format === "twoManScramble" || format === "fourManScramble" || format === "twoManShamble");
  
  // --- LOCKING LOGIC ---
  const roundLocked = !!round?.locked;
  const isMatchClosed = !!match?.status?.closed;
  const matchThru = match?.status?.thru ?? 0;
  
  // closingHole is the 0-indexed hole where the match closed (only set if match is closed before 18)
  // If match went to 18, closingHole is null (no divider needed)
  const closingHole = useMemo(() => {
    if (!isMatchClosed) return null;
    // Match closed early if thru < 18 and there's a winner (not AS)
    const winner = match?.result?.winner;
    if (matchThru < 18 && winner && winner !== "AS") {
      return matchThru - 1; // Convert to 0-indexed
    }
    return null; // Match went to 18 or ended AS
  }, [isMatchClosed, matchThru, match?.result?.winner]);
  
  // Count how many holes have complete scores (for determining when to show post-match stats)
  const completedHolesCount = useMemo(() => {
    if (!match?.holes) return 0;
    let count = 0;
    for (let i = 1; i <= 18; i++) {
      const h = match.holes[String(i)]?.input;
      if (!h) continue;
      // Check if hole has complete data based on format
      if (format === "twoManScramble" || format === "fourManScramble") {
        if (typeof h.teamAGross === "number" && typeof h.teamBGross === "number") count++;
      } else if (format === "singles") {
        if (typeof h.teamAPlayerGross === "number" && typeof h.teamBPlayerGross === "number") count++;
      } else {
        // Best Ball & Shamble: need all 4 player scores
        const aArr = h.teamAPlayersGross;
        const bArr = h.teamBPlayersGross;
        if (Array.isArray(aArr) && Array.isArray(bArr) &&
            typeof aArr[0] === "number" && typeof aArr[1] === "number" &&
            typeof bArr[0] === "number" && typeof bArr[1] === "number") {
          count++;
        }
      }
    }
    return count;
  }, [match?.holes, format]);
  
  // Determine if post-match stats should be shown
  // Show when: match is closed AND (all 18 holes scored OR round is locked)
  const showPostMatchStats = isMatchClosed && matchFacts.length > 0 && (completedHolesCount === 18 || roundLocked);
  
  // Format the final result text for the divider column
  const finalResultText = useMemo(() => {
    if (!isMatchClosed || closingHole === null) return null;
    const margin = match?.status?.margin ?? 0;
    return formatFinalResult(margin, matchThru);
  }, [isMatchClosed, closingHole, match?.status?.margin, matchThru]);
  
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
  
  // Check if current user can edit this match. Also allow editing when
  // the tournament is explicitly opened for public edits (feature toggle).
  // Inactive tournaments (historical) are always read-only.
  const canEdit = tournament?.active !== false && (!!tournament?.openPublicEdits || canEditMatch(teamAPlayerIds, teamBPlayerIds));
  
  // Reason why user can't edit (for displaying message)
  const editBlockReason = useMemo(() => {
    // Historical tournaments are read-only
    if (tournament?.active === false) return "historical";
    // If the tournament allows public edits, don't force login messaging
    if (!player && !tournament?.openPublicEdits) return "login";
    if (!canEdit) return "not-rostered";
    return null;
  }, [player, canEdit, tournament?.openPublicEdits, tournament?.active]);

  // Build holes data - use course from separate fetch or embedded in round
  const holes = useMemo((): HoleData[] => {
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
      if (format === "twoManScramble" || format === "fourManScramble") {
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

  // Player name helpers - memoized to prevent re-creation on every render
  const getPlayerName = useCallback((pid?: string) => getPlayerNameFromLookup(pid, players), [players]);
  const getPlayerShortName = useCallback((pid?: string) => getPlayerShortNameFromLookup(pid, players), [players]);
  const getPlayerInitials = useCallback((pid?: string) => getPlayerInitialsFromLookup(pid, players), [players]);

  // For twoManBestBall: get the team's low net score for a hole
  // For twoManShamble: get the team's low gross score for a hole
  const getTeamLowScore = useCallback((hole: HoleData, team: "A" | "B"): number | null => {
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
  }, [format, match?.teamAPlayers, match?.teamBPlayers]);

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
  const { debouncedSave: debouncedSaveHole, saveStatus, flushAll } = useDebouncedSave(saveHole, 400);
  
  // Flush all pending saves when app goes to background (critical for offline reliability)
  useVisibilityFlush(flushAll);

  // DRIVE_TRACKING: Get current drive selection for a hole
  function getDriveValue(hole: typeof holes[0], team: "A" | "B"): 0 | 1 | 2 | 3 | null {
    const { input } = hole;
    const v = team === "A" ? input?.teamADrive : input?.teamBDrive;
    // Support 0-3 for fourManScramble (4 players), 0-1 for twoManScramble (2 players)
    return (typeof v === "number" && v >= 0 && v <= 3 ? v : null) as 0 | 1 | 2 | 3 | null;
  }

  // DRIVE_TRACKING: Update drive selection for a hole (playerIdx can be null to clear)
  const updateDrive = useCallback((hole: typeof holes[0], team: "A" | "B", playerIdx: 0 | 1 | 2 | 3 | null) => {
    const { k, input } = hole;
    
    if (format === "twoManScramble") {
      const newInput = {
        teamAGross: input?.teamAGross ?? null,
        teamBGross: input?.teamBGross ?? null,
        teamADrive: team === "A" ? playerIdx : (input?.teamADrive ?? null),
        teamBDrive: team === "B" ? playerIdx : (input?.teamBDrive ?? null),
      };
      saveHole(k, newInput);
    } else if (format === "fourManScramble") {
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
  const handleDriveSelect = useCallback((playerIdx: 0 | 1 | 2 | 3 | null) => {
    if (driveModal) {
      updateDrive(driveModal.hole, driveModal.team, playerIdx);
      setDriveModal(null);
    }
  }, [driveModal, updateDrive]);

  // DRIVE_TRACKING: Handle click on drive selector cell
  const handleDriveClick = useCallback((hole: HoleData, team: "A" | "B") => {
    setDriveModal({ hole, team });
  }, []);

  // DRIVE_TRACKING: Calculate drives used per player per team
  const drivesUsed = useMemo(() => {
    if (!trackDrives) return null;
    
    // Support 2-player (twoManScramble) and 4-player (fourManScramble) teams
    const numPlayers = match?.teamAPlayers?.length || 2;
    const teamA = Array(numPlayers).fill(0);
    const teamB = Array(numPlayers).fill(0);
    
    holes.forEach(h => {
      const aDrive = h.input?.teamADrive;
      const bDrive = h.input?.teamBDrive;
      if (typeof aDrive === "number" && aDrive >= 0 && aDrive < numPlayers) teamA[aDrive]++;
      if (typeof bDrive === "number" && bDrive >= 0 && bDrive < numPlayers) teamB[bDrive]++;
    });
    
    return { teamA, teamB };
  }, [holes, trackDrives, match?.teamAPlayers]);

  // DRIVE_TRACKING: Calculate drives still needed (6 min per player, minus holes remaining)
  const drivesNeeded = useMemo(() => {
    if (!trackDrives || !drivesUsed) return null;
    
    const holesRemaining = 18 - matchThru;
    const calc = (used: number) => Math.max(0, MIN_DRIVES_PER_ROUND - used - holesRemaining);
    
    return {
      teamA: drivesUsed.teamA.map(used => calc(used)),
      teamB: drivesUsed.teamB.map(used => calc(used)),
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
    return (holeKey: string): 0 | 1 | 2 | 3 | null => {
      const hole = holes.find(h => h.k === holeKey);
      if (!hole) return null;
      const v = team === "A" ? hole.input?.teamADrive : hole.input?.teamBDrive;
      // Support 0-3 for fourManScramble (4 players), 0-1 for twoManScramble (2 players)
      return (typeof v === "number" && v >= 0 && v <= 3 ? v : null) as 0 | 1 | 2 | 3 | null;
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
  // Note: Post-match holes are NOT locked - players can continue scoring after match closes
  const isHoleLocked = useCallback((_holeNum: number) => {
    // Can't edit if: round locked OR user can't edit
    return roundLocked || !canEdit;
  }, [roundLocked, canEdit]);

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

  // Calculate running match status after each hole using shared scoring module
  const runningMatchStatus = useMemo(() => {
    const holeData: MatchScoringHoleData[] = holes.map(h => ({ num: h.num, input: h.input }));
    return computeRunningStatus(holeData, format, match?.teamAPlayers, match?.teamBPlayers);
  }, [holes, format, match?.teamAPlayers, match?.teamBPlayers]);

  // Get team colors
  const teamAColor = tournament?.teamA?.color || "var(--team-a-default)";
  const teamBColor = tournament?.teamB?.color || "var(--team-b-default)";

  if (loading) return (
    <Layout title="Loading..." showBack>
      <MatchPageSkeleton />
    </Layout>
  );
  
  if (error) return (
    <div className="empty-state">
      <div className="empty-state-icon">⚠️</div>
      <div className="empty-state-text">Error loading match</div>
      <div className="text-sm text-gray-500 mt-2">{error}</div>
    </div>
  );
  
  if (!match) {
    return (
      <Layout title="Match Scoring" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-text">Match not found.</div>
          <Link to="/" className="btn btn-primary mt-4">Go Home</Link>
        </div>
      </Layout>
    );
  }

  const tName = tournament?.name || "Match Scoring";
  const tSeries = tournament?.series;
  // Four player rows: Best Ball and Shamble (individual player scores)
  const isFourPlayerRows = format === "twoManBestBall" || format === "twoManShamble";

  // Build player rows config with memoized handlers and getters
  type PlayerRowConfig = { 
    team: "A" | "B"; 
    pIdx: number; 
    label: React.ReactNode; 
    color: string;
    onCellChange: (holeKey: string, value: number | null) => void;
    getCellValue: (holeKey: string) => number | "";
    hasStroke: (holeIdx: number) => boolean;
    getDriveValue: (holeKey: string) => 0 | 1 | 2 | 3 | null;
    getLowScoreStatus: (holeKey: string) => 'solo' | 'tied' | null;
  };
  const playerRows: PlayerRowConfig[] = [];

  // Helper to read full courseHandicap for a player from match.courseHandicaps
  const getCourseHandicapFor = (team: "A" | "B", pIdx: number) => {
    const aLen = match?.teamAPlayers?.length || 0;
    if (!match?.courseHandicaps) return null;
    if (team === "A") return match.courseHandicaps[pIdx];
    return match.courseHandicaps[aLen + pIdx];
  };
  
  if (isFourPlayerRows) {
    // 4 players: A1, A2, B1, B2 (Best Ball & Shamble)
    playerRows.push(
      { team: "A", pIdx: 0, label: (
          <>
            <span>{getPlayerName(match.teamAPlayers?.[0]?.playerId)}</span>
          </>
        ), color: tournament?.teamA?.color || "var(--team-a-default)", onCellChange: cellChangeHandlerA0, getCellValue: getCellValueA0, hasStroke: hasStrokeA0, getDriveValue: getDriveValueA, getLowScoreStatus: getLowScoreStatusA0 },
      { team: "A", pIdx: 1, label: (
          <>
            <span>{getPlayerName(match.teamAPlayers?.[1]?.playerId)}</span>
          </>
        ), color: tournament?.teamA?.color || "var(--team-a-default)", onCellChange: cellChangeHandlerA1, getCellValue: getCellValueA1, hasStroke: hasStrokeA1, getDriveValue: getDriveValueA, getLowScoreStatus: getLowScoreStatusA1 },
      { team: "B", pIdx: 0, label: (
          <>
            <span>{getPlayerName(match.teamBPlayers?.[0]?.playerId)}</span>
          </>
        ), color: tournament?.teamB?.color || "var(--team-b-default)", onCellChange: cellChangeHandlerB0, getCellValue: getCellValueB0, hasStroke: hasStrokeB0, getDriveValue: getDriveValueB, getLowScoreStatus: getLowScoreStatusB0 },
      { team: "B", pIdx: 1, label: (
          <>
            <span>{getPlayerName(match.teamBPlayers?.[1]?.playerId)}</span>
          </>
        ), color: tournament?.teamB?.color || "var(--team-b-default)", onCellChange: cellChangeHandlerB1, getCellValue: getCellValueB1, hasStroke: hasStrokeB1, getDriveValue: getDriveValueB, getLowScoreStatus: getLowScoreStatusB1 },
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
      { team: "A", pIdx: 0, label: (
          <>
            <span>{getPlayerName(match.teamAPlayers?.[0]?.playerId)}</span>
          </>
        ), color: tournament?.teamA?.color || "var(--team-a-default)", onCellChange: cellChangeHandlerA0, getCellValue: getCellValueA0, hasStroke: hasStrokeA0, getDriveValue: getDriveValueA, getLowScoreStatus: getLowScoreStatusA0 },
      { team: "B", pIdx: 0, label: (
          <>
            <span>{getPlayerName(match.teamBPlayers?.[0]?.playerId)}</span>
          </>
        ), color: tournament?.teamB?.color || "var(--team-b-default)", onCellChange: cellChangeHandlerB0, getCellValue: getCellValueB0, hasStroke: hasStrokeB0, getDriveValue: getDriveValueB, getLowScoreStatus: getLowScoreStatusB0 },
    );
  }

  const cellWidth = SCORECARD_CELL_WIDTH;
  const labelWidth = SCORECARD_LABEL_WIDTH;
  const totalColWidth = SCORECARD_TOTAL_COL_WIDTH;
  
  // Winner color for border on first post-match cell
  const winnerColor = match?.result?.winner === "teamA" ? teamAColor : 
                      match?.result?.winner === "teamB" ? teamBColor : 
                      "#94a3b8"; // Gray for AS

  return (
    <Layout title={tName} series={tSeries} showBack tournamentLogo={tournament?.tournamentLogo}>
      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        
        {/* MATCH STATUS HEADER */}
        <div className="space-y-3">
          {/* Top row: centered format pill with auth status on the right */}
          <div className="relative">
            {/* Strokes Info label with tappable superscript icon (entire area is clickable) */}
            <button
              onClick={() => setStrokesInfoModal(true)}
              aria-label="Open strokes info"
              className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center px-2 py-1 rounded"
            >
              <span className="text-sm text-slate-700">Strokes</span>
              <span className="ml-1 w-4 h-4 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[0.6rem] relative -top-1" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <circle cx="12" cy="16" r="1" />
                </svg>
              </span>
            </button>
            
            <div className="flex justify-center">
              <div 
                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium"
                style={{ backgroundColor: "#f1f5f9", color: "#64748b" }}
              >
                <span>{formatRoundType(format)}</span>
              </div>
            </div>

            {/* Auth status - positioned to the right, inline with pill */}
            {editBlockReason && (editBlockReason === "historical" || (!roundLocked && !isMatchClosed)) && (
              <div className="absolute right-0 top-1/2 -translate-y-1/2 text-xs pr-2" style={{ color: "#94a3b8" }}>
                {editBlockReason === "historical" && (
                  <span> View only</span>
                )}
                {editBlockReason === "login" && (
                  <Link to="/login" className="underline hover:text-slate-600">Login to edit</Link>
                )}
                {editBlockReason === "not-rostered" && (
                  <span>👀 Spectating</span>
                )}
              </div>
            )}
          </div>
          
          {/* Main status display - uses shared MatchStatusBadge component */}
          {(() => {
            const { bgStyle, borderStyle } = getMatchCardStyles(
              match.status,
              match.result,
              tournament?.teamA?.color || "var(--team-a-default)",
              tournament?.teamB?.color || "var(--team-b-default)"
            );

            return (
              <div 
                className="card"
                role="status"
                aria-label="Match status"
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
                <MatchStatusBadge
                  status={match.status}
                  result={match.result}
                  teamAColor={tournament?.teamA?.color || "var(--team-a-default)"}
                  teamBColor={tournament?.teamB?.color || "var(--team-b-default)"}
                  teamAName={tournament?.teamA?.name}
                  teamBName={tournament?.teamB?.name}
                  teeTime={match?.teeTime}
                />
              </div>
            );
          })()}
        </div>

        {/* DRIVE_TRACKING: Drives Tracker Banner */}
        {trackDrives && drivesUsed && drivesNeeded && !isMatchClosed && (
          <DrivesTrackerBanner
            teamAColor={teamAColor}
            teamBColor={teamBColor}
            teamAName={tournament?.teamA?.name || "Team A"}
            teamBName={tournament?.teamB?.name || "Team B"}
            teamAPlayers={match.teamAPlayers || []}
            teamBPlayers={match.teamBPlayers || []}
            drivesUsed={drivesUsed}
            drivesNeeded={drivesNeeded}
            getPlayerShortName={getPlayerShortName}
          />
        )}

        {/* Connection status banner - shows when offline */}
        <ConnectionBanner isOnline={isOnline} />

        {/* SCORECARD TABLE - Horizontally Scrollable (all 18 holes) */}
        
        <div className="card p-0 overflow-hidden relative">
          {/* Save status indicator - top right corner */}
          {canEdit && !isMatchClosed && (
            <div className="absolute top-2 right-2 z-20">
              <SaveStatusIndicator status={saveStatus} />
            </div>
          )}
          
          {/* Horizontal scroll indicator - shows when more content to the right */}
          {canScrollRight && (
            <div 
              className="absolute right-0 top-0 bottom-0 w-8 z-10 pointer-events-none"
              style={{
                background: 'linear-gradient(to right, transparent, rgba(0,0,0,0.15))',
              }}
            />
          )}
          
          <div 
              ref={scrollContainerRef}
              id="scorecard-container"
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
                  {/* Back 9 - post-match cells have border and tint */}
                  {holes.slice(9, 18).map((h, i) => {
                    const holeIdx = 9 + i;
                    const isPostMatch = closingHole !== null && holeIdx > closingHole;
                    
                    return (
                      <th 
                        key={h.k} 
                        className="font-bold py-2 border-l-2"
                        style={{ 
                          width: cellWidth, 
                          minWidth: cellWidth,
                          borderColor: tSeries === "christmasClassic" ? "#8b6914" : "#475569",
                          ...(isPostMatch ? { opacity: 0.7 } : {}),
                        }}
                      >
                        {h.num}
                      </th>
                    );
                  })}
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
                  {holes.slice(9, 18).map((h, i) => {
                    const holeIdx = 9 + i;
                    const isPostMatch = closingHole !== null && holeIdx > closingHole;
                    
                    return (
                      <td 
                        key={h.k} 
                        className={`py-1 ${i === 0 ? "border-l-2 border-slate-200" : ""} ${isPostMatch ? "bg-slate-100/60" : ""}`}
                      >
                        {h.hcpIndex || ""}
                      </td>
                    );
                  })}
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
                  {holes.slice(9, 18).map((h, i) => {
                    const holeIdx = 9 + i;
                    const isPostMatch = closingHole !== null && holeIdx > closingHole;
                    
                    return (
                      <td 
                        key={h.k} 
                        className={`py-1 ${i === 0 ? "border-l-2 border-slate-200" : ""} ${isPostMatch ? "bg-slate-100/60" : ""}`}
                        
                      >
                        {h.yards || ""}
                      </td>
                    );
                  })}
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
                  {holes.slice(9, 18).map((h, i) => {
                    const holeIdx = 9 + i;
                    const isPostMatch = closingHole !== null && holeIdx > closingHole;
                    
                    return (
                      <td 
                        key={h.k} 
                        className={`py-1.5 ${i === 0 ? "border-l-2 border-slate-300" : ""} ${isPostMatch ? "bg-slate-200/60" : ""}`}
                        
                      >
                        {h.par}
                      </td>
                    );
                  })}
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
                    closingHole={closingHole}
                  />
                ))}

                {/* Team A Score Row (Best Ball: low net, Shamble: low gross) */}
                {(format === "twoManBestBall" || format === "twoManShamble") && (
                  <TeamScoreRow
                    team="A"
                    teamName={tournament?.teamA?.name || "Team A"}
                    teamColor={teamAColor}
                    holes={holes}
                    getTeamLowScore={getTeamLowScore}
                    outTotal={teamLowScoreTotals?.getOut("A") ?? null}
                    inTotal={teamLowScoreTotals?.getIn("A") ?? null}
                    totalScore={teamLowScoreTotals?.getTotal("A") ?? null}
                    closingHole={closingHole}
                  />
                )}

                {/* MATCH STATUS ROW - Between Team A and Team B */}
                <tr className="bg-white border-y-2 border-slate-300">
                  <td className="sticky left-0 z-10 bg-white text-left px-3 py-1.5 text-slate-600 text-xs font-bold uppercase tracking-wide">
                    Status
                  </td>
                  {/* Front 9 match status */}
                  {holes.slice(0, 9).map((h, i) => {
                    const holeIdx = i; // 0-indexed hole position
                    const isPostMatch = closingHole !== null && holeIdx > closingHole;
                    const isClosingHole = closingHole !== null && holeIdx === closingHole;
                    
                    const { status, leader } = isPostMatch 
                      ? { status: "", leader: null as "A" | "B" | null }
                      : runningMatchStatus[i];
                    const bgColor = leader === "A" ? teamAColor : leader === "B" ? teamBColor : "transparent";
                    const textColor = leader ? "#fff" : "#94a3b8";
                    
                    // Closing hole shows final result; post-match holes are blank
                    const displayText = isClosingHole ? finalResultText : status;
                    const displayBgColor = isClosingHole ? winnerColor : bgColor;
                    const displayTextColor = isClosingHole ? "#fff" : textColor;
                    
                    return (
                      <td key={`status-${h.k}`} className={`py-1 px-0.5 ${isPostMatch ? "bg-slate-50/60" : ""}`}>
                        <div 
                          className="text-xs font-bold rounded px-1 py-0.5 text-center"
                          style={{ color: displayTextColor, backgroundColor: displayBgColor }}
                        >
                          {displayText}
                        </div>
                      </td>
                    );
                  })}
                  {/* OUT status - always blank */}
                  <td className="py-1 bg-slate-100 border-l-2 border-slate-300"></td>
                  {/* Back 9 match status - post-match cells have border and tint */}
                  {holes.slice(9, 18).map((h, i) => {
                    const holeIdx = 9 + i; // 0-indexed hole position
                    const isPostMatch = closingHole !== null && holeIdx > closingHole;
                    
                    const isClosingHole = closingHole !== null && holeIdx === closingHole;
                    
                    // For post-match holes, blank out status
                    const { status, leader } = isPostMatch 
                      ? { status: "", leader: null as "A" | "B" | null }
                      : runningMatchStatus[holeIdx];
                    const bgColor = leader === "A" ? teamAColor : leader === "B" ? teamBColor : "transparent";
                    const textColor = leader ? "#fff" : "#94a3b8";
                    
                    // Closing hole (last match hole) shows the final result; post-match holes are blank
                    const displayText = isClosingHole ? finalResultText : status;
                    const displayBgColor = isClosingHole ? winnerColor : bgColor;
                    const displayTextColor = isClosingHole ? "#fff" : textColor;
                    
                    return (
                      <td 
                        key={`status-${h.k}`} 
                        className={`py-1 px-0.5 ${i === 0 ? "border-l-2 border-slate-300" : ""} ${isPostMatch ? "bg-slate-50/60" : ""}`}
                      >
                        <div 
                          className="text-xs font-bold rounded px-1 py-0.5 text-center whitespace-nowrap"
                          style={{ color: displayTextColor, backgroundColor: displayBgColor }}
                        >
                          {displayText}
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
                  <TeamScoreRow
                    team="B"
                    teamName={tournament?.teamB?.name || "Team B"}
                    teamColor={teamBColor}
                    holes={holes}
                    getTeamLowScore={getTeamLowScore}
                    outTotal={teamLowScoreTotals?.getOut("B") ?? null}
                    inTotal={teamLowScoreTotals?.getIn("B") ?? null}
                    totalScore={teamLowScoreTotals?.getTotal("B") ?? null}
                    closingHole={closingHole}
                  />
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
                    closingHole={closingHole}
                  />
                ))}

                {/* DRIVE SELECTOR ROWS - Inside scorecard table */}
                {trackDrives && (
                  <DriveSelectorsSection
                    holes={holes}
                    teamAColor={teamAColor}
                    teamBColor={teamBColor}
                    teamAName={tournament?.teamA?.name || "Team A"}
                    teamBName={tournament?.teamB?.name || "Team B"}
                    teamAPlayers={match.teamAPlayers || []}
                    teamBPlayers={match.teamBPlayers || []}
                    cellWidth={cellWidth}
                    totalColWidth={totalColWidth}
                    isMatchClosed={isMatchClosed}
                    isHoleLocked={isHoleLocked}
                    getDriveValue={getDriveValue}
                    getPlayerInitials={getPlayerInitials}
                    onDriveClick={handleDriveClick}
                    closingHole={closingHole}
                  />
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
        {/* Show when: match closed AND (all 18 holes scored OR round locked) */}
        {showPostMatchStats && (
          <PostMatchStats
            matchFacts={matchFacts}
            format={format}
            teamAPlayers={match.teamAPlayers || []}
            teamBPlayers={match.teamBPlayers || []}
            teamAColor={teamAColor}
            teamBColor={teamBColor}
            getPlayerName={getPlayerName}
            teamAName={tournament?.teamA?.name}
            teamBName={tournament?.teamB?.name}
            marginHistory={match.status?.marginHistory}
          />
        )}

        <LastUpdated />

        {/* CONFIRM MATCH CLOSE MODAL */}
        <Modal
          isOpen={!!confirmCloseModal}
          onClose={handleCancelClose}
          title="End Match?"
          ariaLabel="Confirm match end"
        >
          {confirmCloseModal && (
            <>
              {/* Match Score Tile - same format as scorecard */}
              <div 
                className="rounded-lg mb-4"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '12px 16px',
                  backgroundColor: confirmCloseModal.winner === "AS" 
                    ? '#f1f5f9' 
                    : confirmCloseModal.winner === "teamA" 
                      ? teamAColor 
                      : teamBColor,
                  border: confirmCloseModal.winner === "AS" ? '2px solid #cbd5e1' : 'none'
                }}
              >
                <MatchStatusBadge
                  status={{ closed: true, thru: confirmCloseModal.thru, margin: confirmCloseModal.margin }}
                  result={{ winner: confirmCloseModal.winner }}
                  teamAColor={teamAColor}
                  teamBColor={teamBColor}
                  teamAName={tournament?.teamA?.name}
                  teamBName={tournament?.teamB?.name}
                  teeTime={match?.teeTime}
                />
              </div>

              <ModalActions
                primaryLabel="Confirm"
                onPrimary={handleConfirmClose}
                secondaryLabel="Cancel"
                onSecondary={handleCancelClose}
              />
            </>
          )}
        </Modal>

        {/* ABBREVIATION DEFINITION MODAL removed in favor of inline tooltip */}

        {/* DRIVE SELECTOR MODAL */}
        <Modal
          isOpen={!!driveModal}
          onClose={() => setDriveModal(null)}
          title={driveModal ? `Whose drive for Hole ${driveModal.hole.num}?` : ""}
          ariaLabel="Select drive player"
        >
          {driveModal && (() => {
            const teamPlayers = driveModal.team === "A" ? match.teamAPlayers : match.teamBPlayers;
            const numPlayers = teamPlayers?.length || 2;
            const color = driveModal.team === "A" ? teamAColor : teamBColor;
            
            return (
              <>
                <div className="text-xs text-center text-slate-500 mb-3 font-medium" style={{ color }}>
                  {driveModal.team === "A" ? (
                    <TeamName name={tournament?.teamA?.name || "Team A"} variant="inline" style={{ color: teamAColor }} />
                  ) : (
                    <TeamName name={tournament?.teamB?.name || "Team B"} variant="inline" style={{ color: teamBColor }} />
                  )}
                </div>
                <div className="space-y-2">
                  {/* Player buttons (2 or 4 depending on format) */}
                  {Array.from({ length: numPlayers }, (_, i) => {
                    const playerId = teamPlayers?.[i]?.playerId;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleDriveSelect(i as 0 | 1 | 2 | 3)}
                        aria-label={`Select ${getPlayerName(playerId)}'s drive`}
                        className="w-full py-3 px-4 rounded-lg text-white font-semibold text-base transition-transform active:scale-95"
                        style={{ backgroundColor: color }}
                      >
                        {getPlayerName(playerId)}
                      </button>
                    );
                  })}
                  {/* Clear button */}
                  <button
                    type="button"
                    onClick={() => handleDriveSelect(null)}
                    aria-label="Clear drive selection"
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
              </>
            );
          })()}
        </Modal>

        {/* STROKES INFO MODAL */}
        <Modal
          isOpen={strokesInfoModal}
          onClose={() => setStrokesInfoModal(false)}
          title="Handicap Information"
          ariaLabel="Handicap information for match players"
        >
          {(() => {
            // Helper to get handicap index for a player
            const getHandicapIndex = (playerId: string): number | null => {
              return tournament?.teamA?.handicapByPlayer?.[playerId] ?? 
                     tournament?.teamB?.handicapByPlayer?.[playerId] ?? 
                     null;
            };

            // Helper to calculate skins strokes for a player
            const calculateSkinsStrokesCount = (playerId: string): number => {
              if (!course || !round) return 0;
              const handicapIndex = getHandicapIndex(playerId);
              if (handicapIndex == null) return 0;
              
              const skinsPercent = round.skinsHandicapPercent ?? 100;
              const courseHandicap = (handicapIndex * ((course.slope || 113) / 113)) + ((course.rating || 72) - (course.par || 72));
              const adjustedHandicap = courseHandicap * (skinsPercent / 100);
              return Math.round(adjustedHandicap);
            };

            // Build player rows
            const playerRows: Array<{
              name: string;
              hi: number | null;
              ch: number | null;
              so: number;
              sh: number;
            }> = [];

            // Team A players
            match.teamAPlayers?.forEach((p, idx) => {
              const handicapIndex = getHandicapIndex(p.playerId);
              const courseHandicap = getCourseHandicapFor("A", idx);
              const strokesOff = p.strokesReceived?.reduce((sum, s) => sum + s, 0) ?? 0;
              const skinsHandicap = calculateSkinsStrokesCount(p.playerId);
              
              playerRows.push({
                name: getPlayerName(p.playerId),
                hi: handicapIndex,
                ch: courseHandicap,
                so: strokesOff,
                sh: skinsHandicap,
              });
            });

            // Team B players
            match.teamBPlayers?.forEach((p, idx) => {
              const handicapIndex = getHandicapIndex(p.playerId);
              const courseHandicap = getCourseHandicapFor("B", idx);
              const strokesOff = p.strokesReceived?.reduce((sum, s) => sum + s, 0) ?? 0;
              const skinsHandicap = calculateSkinsStrokesCount(p.playerId);
              
              playerRows.push({
                name: getPlayerName(p.playerId),
                hi: handicapIndex,
                ch: courseHandicap,
                so: strokesOff,
                sh: skinsHandicap,
              });
            });

            return (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-2 font-semibold text-slate-700">Player</th>
                      <th className="text-center py-2 px-2 font-semibold text-slate-700">
                        <div className="flex items-center justify-center">
                          <span>H.I.</span>
                          <button
                            onClick={(e) => openDefTooltip(e, "HI")}
                            aria-label="Define H.I."
                            className="ml-1 w-4 h-4 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[0.6rem]"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <circle cx="12" cy="16" r="1" />
                            </svg>
                          </button>
                        </div>
                      </th>
                      <th className="text-center py-2 px-2 font-semibold text-slate-700">
                        <div className="flex items-center justify-center">
                          <span>C.H.</span>
                          <button
                            onClick={(e) => openDefTooltip(e, "CH")}
                            aria-label="Define C.H."
                            className="ml-1 w-4 h-4 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[0.6rem]"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <circle cx="12" cy="16" r="1" />
                            </svg>
                          </button>
                        </div>
                      </th>
                      <th className="text-center py-2 px-2 font-semibold text-slate-700">
                        <div className="flex items-center justify-center">
                          <span>S.O.</span>
                          <button
                            onClick={(e) => openDefTooltip(e, "SO")}
                            aria-label="Define S.O."
                            className="ml-1 w-4 h-4 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[0.6rem]"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <circle cx="12" cy="16" r="1" />
                            </svg>
                          </button>
                        </div>
                      </th>
                      <th className="text-center py-2 px-2 font-semibold text-slate-700">
                        <div className="flex items-center justify-center">
                          <span>S.H.</span>
                          <button
                            onClick={(e) => openDefTooltip(e, "SH")}
                            aria-label="Define S.H."
                            className="ml-1 w-4 h-4 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[0.6rem]"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <circle cx="12" cy="16" r="1" />
                            </svg>
                          </button>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerRows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-2 px-2 text-slate-800">{row.name}</td>
                        <td className="py-2 px-2 text-center text-slate-600">{row.hi != null ? row.hi.toFixed(1) : "—"}</td>
                        <td className="py-2 px-2 text-center text-slate-600">{row.ch != null ? row.ch : "—"}</td>
                        <td className="py-2 px-2 text-center text-slate-600">{row.so}</td>
                        <td className="py-2 px-2 text-center text-slate-600">{row.sh}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {defTooltip && (() => {
                  const defs: Record<string,string> = {
                    HI: "Handicap Index",
                    CH: "Course Handicap",
                    SO: "Matchplay Strokes",
                    SH: "Skins Strokes",
                  };
                  const text = defs[defTooltip.key] ?? "";
                  const left = defTooltip.x + 8;
                  const top = Math.max(8, defTooltip.y - 28);
                  return (
                    <div style={{ position: 'fixed', left, top, zIndex: 1200 }}>
                      <div className="bg-slate-800 text-white text-xs px-2 py-1 rounded shadow">
                        {text}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </Modal>
      </div>
    </Layout>
  );
}
