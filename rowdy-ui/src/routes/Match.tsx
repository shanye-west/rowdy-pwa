import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot, getDoc, updateDoc, getDocs, collection, where, query, documentId } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, PlayerDoc, MatchDoc, RoundDoc, RoundFormat, CourseDoc, PlayerMatchFact } from "../types";
import { formatMatchStatus, formatRoundType } from "../utils";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";

// ===== MATCH FLOW GRAPH COMPONENT (Pure SVG) =====

type MatchFlowGraphProps = {
  marginHistory: number[];
  teamAColor: string;
  teamBColor: string;
  teamALogo?: string;
  teamBLogo?: string;
};

function MatchFlowGraph({ marginHistory, teamAColor, teamBColor, teamALogo, teamBLogo }: MatchFlowGraphProps) {
  if (!marginHistory || marginHistory.length === 0) return null;

  // Chart dimensions
  const height = 140;
  const padding = { top: 20, right: 8, bottom: 25, left: 12 }; // left padding for logos
  const chartWidth = 100 - padding.left - padding.right; // as percentage
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate max margin for y-axis scale (minimum 3 for reasonable scale)
  const maxMargin = Math.max(3, Math.max(...marginHistory.map(Math.abs)));

  // Data points: start at 0, then each hole's margin
  const data = [0, ...marginHistory];
  const numHoles = marginHistory.length;

  // Convert data point to SVG coordinates
  const getX = (holeIndex: number) => {
    // holeIndex 0 = start, 1-18 = holes
    return padding.left + (holeIndex / numHoles) * chartWidth;
  };

  const getY = (margin: number) => {
    // margin > 0 = Team A up (toward top), margin < 0 = Team B up (toward bottom)
    // Center line is at chartHeight/2
    const centerY = padding.top + chartHeight / 2;
    const scale = (chartHeight / 2 - 10) / maxMargin; // leave some padding
    return centerY - margin * scale;
  };

  // Generate line segments with colors based on leader
  // Gray only for AS-to-AS segments
  // Team color for any segment where that team is leading on either end
  const lineSegments = [];
  for (let i = 0; i < data.length - 1; i++) {
    const x1 = getX(i);
    const y1 = getY(data[i]);
    const x2 = getX(i + 1);
    const y2 = getY(data[i + 1]);
    
    const startMargin = data[i];
    const endMargin = data[i + 1];
    
    let color: string;
    if (startMargin === 0 && endMargin === 0) {
      // Both endpoints are AS - gray
      color = "#94a3b8";
    } else if (startMargin > 0 || endMargin > 0) {
      // Team A is leading on at least one end
      color = teamAColor;
    } else {
      // Team B is leading on at least one end
      color = teamBColor;
    }
    
    lineSegments.push(
      <line
        key={`seg-${i}`}
        x1={`${x1}%`}
        y1={y1}
        x2={`${x2}%`}
        y2={y2}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    );
  }

  // Calculate max lead for each team, separately for front 9 and back 9
  const front9 = marginHistory.slice(0, 9);
  const back9 = marginHistory.slice(9);
  
  const maxTeamALeadFront = Math.max(0, ...front9);
  const maxTeamBLeadFront = Math.max(0, ...front9.map(m => -m));
  const maxTeamALeadBack = back9.length > 0 ? Math.max(0, ...back9) : 0;
  const maxTeamBLeadBack = back9.length > 0 ? Math.max(0, ...back9.map(m => -m)) : 0;
  
  // Track if we've already shown the max lead label for each team/nine
  let shownTeamAFront = false;
  let shownTeamBFront = false;
  let shownTeamABack = false;
  let shownTeamBBack = false;

  // Generate horizontal grid lines for each margin level (1, 2, 3, etc.)
  const gridLines = [];
  for (let m = 1; m <= maxMargin; m++) {
    // Team A side (positive)
    gridLines.push(
      <line
        key={`grid-a-${m}`}
        x1={`${padding.left}%`}
        y1={getY(m)}
        x2={`${padding.left + chartWidth}%`}
        y2={getY(m)}
        stroke="#e2e8f0"
        strokeWidth={0.5}
      />
    );
    // Team B side (negative)
    gridLines.push(
      <line
        key={`grid-b-${m}`}
        x1={`${padding.left}%`}
        y1={getY(-m)}
        x2={`${padding.left + chartWidth}%`}
        y2={getY(-m)}
        stroke="#e2e8f0"
        strokeWidth={0.5}
      />
    );
  }

  // Generate dots with labels only at first occurrence of max lead per nine
  const dots = data.slice(1).map((margin, i) => {
    const holeNum = i + 1; // 1-indexed hole number
    const isFrontNine = holeNum <= 9;
    const x = getX(holeNum);
    const y = getY(margin);
    const color = margin > 0 ? teamAColor : margin < 0 ? teamBColor : "#94a3b8";
    
    // Determine if we should show a label
    let showLabel = false;
    let labelAbove = true; // Team A above, Team B below
    
    if (margin > 0) {
      // Team A leading
      if (isFrontNine && margin === maxTeamALeadFront && maxTeamALeadFront > 0 && !shownTeamAFront) {
        showLabel = true;
        shownTeamAFront = true;
      } else if (!isFrontNine && margin === maxTeamALeadBack && maxTeamALeadBack > 0 && !shownTeamABack) {
        showLabel = true;
        shownTeamABack = true;
      }
      labelAbove = true;
    } else if (margin < 0) {
      // Team B leading
      if (isFrontNine && -margin === maxTeamBLeadFront && maxTeamBLeadFront > 0 && !shownTeamBFront) {
        showLabel = true;
        shownTeamBFront = true;
      } else if (!isFrontNine && -margin === maxTeamBLeadBack && maxTeamBLeadBack > 0 && !shownTeamBBack) {
        showLabel = true;
        shownTeamBBack = true;
      }
      labelAbove = false;
    }
    
    return (
      <g key={`dot-${i}`}>
        <circle
          cx={`${x}%`}
          cy={y}
          r={4}
          fill={color}
          stroke="white"
          strokeWidth={1.5}
        />
        {showLabel && (
          <text
            x={`${x}%`}
            y={labelAbove ? y - 8 : y + 14}
            textAnchor="middle"
            fontSize={8}
            fontWeight={600}
            fill={color}
          >
            {Math.abs(margin)}UP
          </text>
        )}
      </g>
    );
  });

  // X-axis labels (hole numbers)
  const xLabels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].filter(h => h <= numHoles).map(hole => (
    <text
      key={`x-${hole}`}
      x={`${getX(hole)}%`}
      y={height - 5}
      textAnchor="middle"
      fontSize={9}
      fill="#94a3b8"
    >
      {hole}
    </text>
  ));

  // Center Y coordinate
  const centerY = padding.top + chartHeight / 2;

  return (
    <div className="card p-4">
      <h3 className="text-sm font-bold uppercase text-slate-500 tracking-wide text-center mb-3">
        Match Flow
      </h3>

      <svg width="100%" height={height} style={{ overflow: 'visible' }}>
        {/* Background shading */}
        <rect
          x={`${padding.left}%`}
          y={padding.top}
          width={`${chartWidth}%`}
          height={chartHeight / 2}
          fill={teamAColor}
          fillOpacity={0.06}
        />
        <rect
          x={`${padding.left}%`}
          y={centerY}
          width={`${chartWidth}%`}
          height={chartHeight / 2}
          fill={teamBColor}
          fillOpacity={0.06}
        />

        {/* Center line (All Square) */}
        <line
          x1={`${padding.left}%`}
          y1={centerY}
          x2={`${padding.left + chartWidth}%`}
          y2={centerY}
          stroke="#94a3b8"
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Horizontal grid lines for margin levels */}
        {gridLines}

        {/* Front 9 / Back 9 separator */}
        {numHoles > 9 && (
          <line
            x1={`${getX(9.5)}%`}
            y1={padding.top}
            x2={`${getX(9.5)}%`}
            y2={padding.top + chartHeight}
            stroke="#cbd5e1"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* Y-axis team logos */}
        {teamALogo && (
          <image
            href={teamALogo}
            x={2}
            y={padding.top}
            width={24}
            height={24}
            preserveAspectRatio="xMidYMid meet"
          />
        )}
        {teamBLogo && (
          <image
            href={teamBLogo}
            x={2}
            y={padding.top + chartHeight - 24}
            width={24}
            height={24}
            preserveAspectRatio="xMidYMid meet"
          />
        )}
        <text
          x={14}
          y={centerY + 3}
          textAnchor="middle"
          fontSize={7}
          fill="#94a3b8"
        >
          AS
        </text>

        {/* Line segments */}
        {lineSegments}

        {/* Dots */}
        {dots}

        {/* X-axis labels */}
        {xLabels}
      </svg>
    </div>
  );
}

// ===== POST-MATCH STATS COMPONENT =====

type PostMatchStatsProps = {
  matchFacts: PlayerMatchFact[];
  format: RoundFormat;
  teamAPlayers: { playerId: string; strokesReceived: number[] }[];
  teamBPlayers: { playerId: string; strokesReceived: number[] }[];
  teamAName: string;
  teamBName: string;
  teamAColor: string;
  teamBColor: string;
  getPlayerName: (pid?: string) => string;
  marginHistory?: number[];
};

// Format +/- scores like golf standard: +5, -2, E (even)
function formatStrokesVsPar(value: number | undefined | null): string {
  if (value == null) return "–";
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : `${value}`;
}

function PostMatchStats({
  matchFacts,
  format,
  teamAPlayers,
  teamBPlayers,
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
  getPlayerName,
  marginHistory,
}: PostMatchStatsProps) {
  // Get fact for a specific player
  const getFactForPlayer = (playerId: string): PlayerMatchFact | undefined => {
    return matchFacts.find(f => f.playerId === playerId);
  };

  // Compute largest lead from marginHistory
  const largestLeadA = marginHistory && marginHistory.length > 0 
    ? Math.max(0, ...marginHistory) 
    : 0;
  const largestLeadB = marginHistory && marginHistory.length > 0 
    ? Math.abs(Math.min(0, ...marginHistory)) 
    : 0;

  // Determine which stat categories apply to this format
  const showIndividualScoring = format === "singles" || format === "twoManBestBall";
  const showTeamScoring = format === "twoManScramble" || format === "twoManShamble";
  const showBallUsage = format === "twoManBestBall" || format === "twoManShamble";
  const showDrives = format === "twoManScramble" || format === "twoManShamble";

  // Build player lists
  const teamAPlayerIds = teamAPlayers.map(p => p.playerId);
  const teamBPlayerIds = teamBPlayers.map(p => p.playerId);

  // Stat row component for team-level stats (1 value per team)
  const StatRow = ({ label, valueA, valueB, highlight = false }: { 
    label: string; 
    valueA: string | number | null | undefined; 
    valueB: string | number | null | undefined;
    highlight?: boolean;
  }) => (
    <div className={`flex items-center py-1.5 ${highlight ? "bg-slate-50 -mx-2 px-2 rounded" : ""}`}>
      <div className="flex-1 text-right pr-3 font-semibold" style={{ color: teamAColor }}>
        {valueA ?? "–"}
      </div>
      <div className="text-xs text-slate-500 font-medium text-center w-24 shrink-0">
        {label}
      </div>
      <div className="flex-1 text-left pl-3 font-semibold" style={{ color: teamBColor }}>
        {valueB ?? "–"}
      </div>
    </div>
  );

  // Player names header row for per-player stat sections
  const PlayerNamesHeader = () => (
    <div className="flex items-center py-1 mb-1 border-b border-slate-100">
      <div className="flex-1 text-right pr-1">
        <span className="text-xs font-semibold truncate" style={{ color: teamAColor }}>
          {getPlayerName(teamAPlayerIds[0])}
        </span>
      </div>
      <div className="flex-1 text-right pr-3">
        <span className="text-xs font-semibold truncate" style={{ color: teamAColor }}>
          {getPlayerName(teamAPlayerIds[1])}
        </span>
      </div>
      <div className="w-24 shrink-0" />
      <div className="flex-1 text-left pl-3">
        <span className="text-xs font-semibold truncate" style={{ color: teamBColor }}>
          {getPlayerName(teamBPlayerIds[0])}
        </span>
      </div>
      <div className="flex-1 text-left pl-1">
        <span className="text-xs font-semibold truncate" style={{ color: teamBColor }}>
          {getPlayerName(teamBPlayerIds[1])}
        </span>
      </div>
    </div>
  );

  // Stat row for per-player stats (4 columns: 2 players per team)
  const PlayerStatRow = ({ label, teamA, teamB, highlight = false }: { 
    label: string; 
    teamA: (string | number | null | undefined)[];
    teamB: (string | number | null | undefined)[];
    highlight?: boolean;
  }) => (
    <div className={`flex items-center py-1.5 ${highlight ? "bg-slate-50 -mx-2 px-2 rounded" : ""}`}>
      <div className="flex-1 text-right pr-1 font-semibold text-sm" style={{ color: teamAColor }}>
        {teamA[0] ?? "–"}
      </div>
      <div className="flex-1 text-right pr-3 font-semibold text-sm" style={{ color: teamAColor }}>
        {teamA[1] ?? "–"}
      </div>
      <div className="text-xs text-slate-500 font-medium text-center w-24 shrink-0">
        {label}
      </div>
      <div className="flex-1 text-left pl-3 font-semibold text-sm" style={{ color: teamBColor }}>
        {teamB[0] ?? "–"}
      </div>
      <div className="flex-1 text-left pl-1 font-semibold text-sm" style={{ color: teamBColor }}>
        {teamB[1] ?? "–"}
      </div>
    </div>
  );

  // Get aggregated stats for display
  const teamAFacts = teamAPlayerIds.map(id => getFactForPlayer(id)).filter(Boolean) as PlayerMatchFact[];
  const teamBFacts = teamBPlayerIds.map(id => getFactForPlayer(id)).filter(Boolean) as PlayerMatchFact[];

  if (teamAFacts.length === 0 && teamBFacts.length === 0) return null;

  // Get first fact from either team for match-level stats (they should be consistent)
  const sampleFact = teamAFacts[0] || teamBFacts[0];

  return (
    <div className="card p-4 space-y-4">
      <h3 className="text-sm font-bold uppercase text-slate-500 tracking-wide text-center">
        Match Stats
      </h3>

      {/* Team Headers */}
      <div className="flex items-center pb-2 border-b border-slate-200">
        <div className="flex-1 text-right pr-3">
          <span className="text-xs font-bold uppercase" style={{ color: teamAColor }}>{teamAName}</span>
        </div>
        <div className="w-24 shrink-0" />
        <div className="flex-1 text-left pl-3">
          <span className="text-xs font-bold uppercase" style={{ color: teamBColor }}>{teamBName}</span>
        </div>
      </div>

      {/* MATCH RESULT */}
      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
          Match Result
        </div>
        <StatRow 
          label="Holes Won" 
          valueA={teamAFacts[0]?.holesWon} 
          valueB={teamBFacts[0]?.holesWon} 
          highlight 
        />
        <StatRow 
          label="Holes Lost" 
          valueA={teamAFacts[0]?.holesLost} 
          valueB={teamBFacts[0]?.holesLost} 
        />
        <StatRow 
          label="Holes Halved" 
          valueA={teamAFacts[0]?.holesHalved} 
          valueB={teamBFacts[0]?.holesHalved} 
        />
        <StatRow 
          label="Final Thru" 
          valueA={sampleFact?.finalThru} 
          valueB={sampleFact?.finalThru} 
        />
        {marginHistory && marginHistory.length > 0 && (
          <>
            <StatRow 
              label="Largest Lead" 
              valueA={largestLeadA > 0 ? largestLeadA : "–"} 
              valueB={largestLeadB > 0 ? largestLeadB : "–"} 
            />
          </>
        )}
      </div>

      {/* INDIVIDUAL SCORING (Singles & Best Ball) */}
      {showIndividualScoring && (
        <div className="border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
            Scoring
          </div>
          {format === "singles" ? (
            // Singles: one player per team
            <>
              <StatRow 
                label="Total Gross" 
                valueA={teamAFacts[0]?.totalGross} 
                valueB={teamBFacts[0]?.totalGross} 
              />
              <StatRow 
                label="Total Net" 
                valueA={teamAFacts[0]?.totalNet} 
                valueB={teamBFacts[0]?.totalNet} 
                highlight
              />
              <StatRow 
                label="vs Par (Gross)" 
                valueA={formatStrokesVsPar(teamAFacts[0]?.strokesVsParGross)} 
                valueB={formatStrokesVsPar(teamBFacts[0]?.strokesVsParGross)} 
              />
              <StatRow 
                label="vs Par (Net)" 
                valueA={formatStrokesVsPar(teamAFacts[0]?.strokesVsParNet)} 
                valueB={formatStrokesVsPar(teamBFacts[0]?.strokesVsParNet)} 
              />
              <StatRow 
                label="Strokes Received" 
                valueA={teamAFacts[0]?.strokesGiven} 
                valueB={teamBFacts[0]?.strokesGiven} 
              />
            </>
          ) : (
            // Best Ball: two players per team
            <>
              <PlayerNamesHeader />
              <PlayerStatRow 
                label="Total Gross" 
                teamA={teamAFacts.map(f => f.totalGross)} 
                teamB={teamBFacts.map(f => f.totalGross)} 
              />
              <PlayerStatRow 
                label="Total Net" 
                teamA={teamAFacts.map(f => f.totalNet)} 
                teamB={teamBFacts.map(f => f.totalNet)} 
              />
              <PlayerStatRow 
                label="vs Par (Gross)" 
                teamA={teamAFacts.map(f => formatStrokesVsPar(f.strokesVsParGross))} 
                teamB={teamBFacts.map(f => formatStrokesVsPar(f.strokesVsParGross))} 
              />
              <PlayerStatRow 
                label="vs Par (Net)" 
                teamA={teamAFacts.map(f => formatStrokesVsPar(f.strokesVsParNet))} 
                teamB={teamBFacts.map(f => formatStrokesVsPar(f.strokesVsParNet))} 
              />
              <PlayerStatRow 
                label="Strokes Recv'd" 
                teamA={teamAFacts.map(f => f.strokesGiven)} 
                teamB={teamBFacts.map(f => f.strokesGiven)} 
              />
            </>
          )}
        </div>
      )}

      {/* TEAM SCORING (Scramble & Shamble) */}
      {showTeamScoring && (
        <div className="border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
            Team Scoring
          </div>
          <StatRow 
            label="Team Gross" 
            valueA={teamAFacts[0]?.teamTotalGross} 
            valueB={teamBFacts[0]?.teamTotalGross} 
            highlight
          />
          <StatRow 
            label="vs Par" 
            valueA={formatStrokesVsPar(teamAFacts[0]?.teamStrokesVsParGross)} 
            valueB={formatStrokesVsPar(teamBFacts[0]?.teamStrokesVsParGross)} 
          />
        </div>
      )}

      {/* BALL USAGE (Best Ball & Shamble) */}
      {showBallUsage && (
        <div className="border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
            Ball Usage
          </div>
          <PlayerNamesHeader />
          <PlayerStatRow 
            label="Balls Used" 
            teamA={teamAFacts.map(f => f.ballsUsed)} 
            teamB={teamBFacts.map(f => f.ballsUsed)} 
          />
          <PlayerStatRow 
            label="Solo Balls" 
            teamA={teamAFacts.map(f => f.ballsUsedSolo)} 
            teamB={teamBFacts.map(f => f.ballsUsedSolo)} 
          />
          <PlayerStatRow 
            label="Shared Balls" 
            teamA={teamAFacts.map(f => f.ballsUsedShared)} 
            teamB={teamBFacts.map(f => f.ballsUsedShared)} 
          />
          <PlayerStatRow 
            label="Solo → Won" 
            teamA={teamAFacts.map(f => f.ballsUsedSoloWonHole)} 
            teamB={teamBFacts.map(f => f.ballsUsedSoloWonHole)} 
          />
          <PlayerStatRow 
            label="Solo → Halved" 
            teamA={teamAFacts.map(f => f.ballsUsedSoloPush)} 
            teamB={teamBFacts.map(f => f.ballsUsedSoloPush)} 
          />
        </div>
      )}

      {/* DRIVE USAGE (Scramble & Shamble) */}
      {showDrives && (
        <div className="border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
            Drives
          </div>
          <PlayerNamesHeader />
          <PlayerStatRow 
            label="Drives Used" 
            teamA={teamAFacts.map(f => f.drivesUsed)} 
            teamB={teamBFacts.map(f => f.drivesUsed)} 
          />
        </div>
      )}

      {/* MOMENTUM STATS (All formats) */}
      <div className="border-t border-slate-200 pt-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
          Momentum
        </div>
        <StatRow 
          label="Lead Changes" 
          valueA={sampleFact?.leadChanges} 
          valueB={sampleFact?.leadChanges} 
        />
        <StatRow 
          label="Never Behind" 
          valueA={teamAFacts[0]?.wasNeverBehind ? "✓" : "–"} 
          valueB={teamBFacts[0]?.wasNeverBehind ? "✓" : "–"} 
        />
        <StatRow 
          label="Comeback Win" 
          valueA={teamAFacts[0]?.comebackWin ? "✓" : "–"} 
          valueB={teamBFacts[0]?.comebackWin ? "✓" : "–"} 
        />
        <StatRow 
          label="Blown Lead" 
          valueA={teamAFacts[0]?.blownLead ? "✓" : "–"} 
          valueB={teamBFacts[0]?.blownLead ? "✓" : "–"} 
        />
        {sampleFact?.winningHole && (
          <StatRow 
            label="Closed on Hole" 
            valueA={sampleFact.winningHole} 
            valueB={sampleFact.winningHole} 
          />
        )}
      </div>
    </div>
  );
}

// ===== END POST-MATCH STATS COMPONENT =====

export default function Match() {
  const { matchId } = useParams();
  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  const [loading, setLoading] = useState(true);
  
  // DRIVE_TRACKING: Modal state for drive picker - using any for hole to avoid circular type reference
  const [driveModal, setDriveModal] = useState<{ hole: any; team: "A" | "B" } | null>(null);
  
  // POST-MATCH STATS: Facts for completed matches
  const [matchFacts, setMatchFacts] = useState<PlayerMatchFact[]>([]);

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

  // 3. Fetch playerMatchFacts when match is closed
  useEffect(() => {
    if (!matchId || !match?.status?.closed) {
      setMatchFacts([]);
      return;
    }
    
    const fetchFacts = async () => {
      const q = query(
        collection(db, "playerMatchFacts"),
        where("matchId", "==", matchId)
      );
      const snap = await getDocs(q);
      const facts: PlayerMatchFact[] = [];
      snap.forEach(d => facts.push({ ...d.data() } as PlayerMatchFact));
      setMatchFacts(facts);
    };
    
    fetchFacts();
  }, [matchId, match?.status?.closed]);

  const format: RoundFormat = (round?.format as RoundFormat) || "twoManBestBall";
  
  // Only scramble uses team-level scoring (one score per team per hole)
  const isTeamFormat = format === "twoManScramble";
  
  // DRIVE_TRACKING: Check if drive tracking is enabled for this round (scramble or shamble)
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

  function getPlayerName(pid?: string) {
    if (!pid) return "Player";
    const p = players[pid];
    if (!p) return "...";
    return p.displayName || p.username || "Unknown";
  }

  // Get short name: first initial + last name (e.g., "S. West")
  function getPlayerShortName(pid?: string) {
    if (!pid) return "?";
    const p = players[pid];
    if (!p) return "?";
    const name = p.displayName || p.username || "Unknown";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0) + ".";
    const firstInitial = parts[0].charAt(0);
    const lastName = parts[parts.length - 1];
    return `${firstInitial}. ${lastName}`;
  }

  // Get player initials: first initial + last initial (e.g., "SW")
  function getPlayerInitials(pid?: string) {
    if (!pid) return "?";
    const p = players[pid];
    if (!p) return "?";
    const name = p.displayName || p.username || "Unknown";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    const firstInitial = parts[0].charAt(0).toUpperCase();
    const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
    return `${firstInitial}${lastInitial}`;
  }

  function hasStroke(team: "A" | "B", pIdx: number, holeIdx: number) {
    const roster = team === "A" ? match?.teamAPlayers : match?.teamBPlayers;
    return (roster?.[pIdx]?.strokesReceived?.[holeIdx] ?? 0) > 0;
  }

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

  // DRIVE_TRACKING: Update drive selection for a hole (playerIdx can be null to clear)
  function updateDrive(hole: typeof holes[0], team: "A" | "B", playerIdx: 0 | 1 | null) {
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
  }

  // DRIVE_TRACKING: Handle modal selection
  function handleDriveSelect(playerIdx: 0 | 1 | null) {
    if (driveModal) {
      updateDrive(driveModal.hole, driveModal.team, playerIdx);
      setDriveModal(null);
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
      // Scramble: one score per team
      const v = team === "A" ? input?.teamAGross : input?.teamBGross;
      return v ?? "";
    }
    if (format === "singles") {
      const v = team === "A" ? input?.teamAPlayerGross : input?.teamBPlayerGross;
      return v ?? "";
    }
    // Best Ball & Shamble: individual player scores
    const arr = team === "A" ? input?.teamAPlayersGross : input?.teamBPlayersGross;
    return Array.isArray(arr) ? (arr[pIdx] ?? "") : "";
  }

  // Update a cell value
  function updateCell(hole: typeof holes[0], team: "A" | "B", pIdx: number, value: number | null) {
    const { k, input } = hole;
    
    if (format === "twoManScramble") {
      // Scramble: one score per team
      const newInput = {
        teamAGross: team === "A" ? value : (input?.teamAGross ?? null),
        teamBGross: team === "B" ? value : (input?.teamBGross ?? null),
        // Preserve drive tracking fields if present
        ...(input?.teamADrive != null && { teamADrive: input.teamADrive }),
        ...(input?.teamBDrive != null && { teamBDrive: input.teamBDrive }),
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
    
    // Best Ball & Shamble: individual player scores
    const aArr = Array.isArray(input?.teamAPlayersGross) ? [...input.teamAPlayersGross] : [null, null];
    const bArr = Array.isArray(input?.teamBPlayersGross) ? [...input.teamBPlayersGross] : [null, null];
    
    if (team === "A") aArr[pIdx] = value;
    else bArr[pIdx] = value;
    
    // For shamble, preserve drive tracking fields
    if (format === "twoManShamble") {
      saveHole(k, { 
        teamAPlayersGross: aArr, 
        teamBPlayersGross: bArr,
        ...(input?.teamADrive != null && { teamADrive: input.teamADrive }),
        ...(input?.teamBDrive != null && { teamBDrive: input.teamBDrive }),
      });
    } else {
      saveHole(k, { teamAPlayersGross: aArr, teamBPlayersGross: bArr });
    }
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

  // Build player rows config
  type PlayerRowConfig = { team: "A" | "B"; pIdx: number; label: string; color: string };
  const playerRows: PlayerRowConfig[] = [];
  
  if (isFourPlayerRows) {
    // 4 players: A1, A2, B1, B2 (Best Ball & Shamble)
    playerRows.push(
      { team: "A", pIdx: 0, label: getPlayerName(match.teamAPlayers?.[0]?.playerId), color: tournament?.teamA?.color || "var(--team-a-default)" },
      { team: "A", pIdx: 1, label: getPlayerName(match.teamAPlayers?.[1]?.playerId), color: tournament?.teamA?.color || "var(--team-a-default)" },
      { team: "B", pIdx: 0, label: getPlayerName(match.teamBPlayers?.[0]?.playerId), color: tournament?.teamB?.color || "var(--team-b-default)" },
      { team: "B", pIdx: 1, label: getPlayerName(match.teamBPlayers?.[1]?.playerId), color: tournament?.teamB?.color || "var(--team-b-default)" },
    );
  } else if (isTeamFormat) {
    // 2 rows with TEAM NAMES for scramble only
    playerRows.push(
      { team: "A", pIdx: 0, label: tournament?.teamA?.name || "Team A", color: tournament?.teamA?.color || "var(--team-a-default)" },
      { team: "B", pIdx: 0, label: tournament?.teamB?.name || "Team B", color: tournament?.teamB?.color || "var(--team-b-default)" },
    );
  } else {
    // 2 rows: Player A, Player B (singles)
    playerRows.push(
      { team: "A", pIdx: 0, label: getPlayerName(match.teamAPlayers?.[0]?.playerId), color: tournament?.teamA?.color || "var(--team-a-default)" },
      { team: "B", pIdx: 0, label: getPlayerName(match.teamBPlayers?.[0]?.playerId), color: tournament?.teamB?.color || "var(--team-b-default)" },
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
          {/* Top row: Format in subtle pill */}
          <div className="flex justify-center">
            <div 
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium"
              style={{ backgroundColor: "#f1f5f9", color: "#64748b" }}
            >
              <span>{formatRoundType(format)}</span>
              {(course?.name || round?.course?.name) && (
                <>
                  <span>•</span>
                  <span>
                    {course?.name || round?.course?.name}
                    {(course?.tees || round?.course?.tee) && ` (${course?.tees || round?.course?.tee})`}
                  </span>
                </>
              )}
            </div>
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
                        const hasDrive = trackDrives && getDriveValue(h, pr.team) === pr.pIdx;
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
                              {hasDrive && (
                                <div className="absolute bottom-0.5 left-0.5 text-[8px] font-bold text-green-600">D</div>
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
                        const hasDrive = trackDrives && getDriveValue(h, pr.team) === pr.pIdx;
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
                              {hasDrive && (
                                <div className="absolute bottom-0.5 left-0.5 text-[8px] font-bold text-green-600">D</div>
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

                {/* Team A Score Row (Best Ball: low net, Shamble: low gross) */}
                {(format === "twoManBestBall" || format === "twoManShamble") && (
                  <tr style={{ backgroundColor: teamAColor }}>
                    <td className="sticky left-0 z-10 text-left px-3 py-1.5 text-white text-xs font-bold uppercase tracking-wide" style={{ backgroundColor: teamAColor }}>
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
                    <td className="sticky left-0 z-10 text-left px-3 py-1.5 text-white text-xs font-bold uppercase tracking-wide" style={{ backgroundColor: teamBColor }}>
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
                      </td>
                      {/* Front 9 holes */}
                      {holes.slice(0, 9).map(h => {
                        const locked = isHoleLocked(h.num);
                        const stroke = hasStroke(pr.team, pr.pIdx, h.num - 1);
                        const hasDrive = trackDrives && getDriveValue(h, pr.team) === pr.pIdx;
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
                              {hasDrive && (
                                <div className="absolute bottom-0.5 left-0.5 text-[8px] font-bold text-green-600">D</div>
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
                        const hasDrive = trackDrives && getDriveValue(h, pr.team) === pr.pIdx;
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
                              {hasDrive && (
                                <div className="absolute bottom-0.5 left-0.5 text-[8px] font-bold text-green-600">D</div>
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
                                  ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
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
                                  ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
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
                                  ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
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
                                  ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
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
