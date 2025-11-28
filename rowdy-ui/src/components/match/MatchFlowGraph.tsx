// ===== MATCH FLOW GRAPH COMPONENT (Pure SVG) =====

export type MatchFlowGraphProps = {
  marginHistory: number[];
  teamAColor: string;
  teamBColor: string;
  teamALogo?: string;
  teamBLogo?: string;
};

export function MatchFlowGraph({ marginHistory, teamAColor, teamBColor, teamALogo, teamBLogo }: MatchFlowGraphProps) {
  // Chart dimensions
  const height = 140;
  const padding = { top: 20, right: 8, bottom: 25, left: 12 }; // left padding for logos
  const chartWidth = 100 - padding.left - padding.right; // as percentage
  const chartHeight = height - padding.top - padding.bottom;

  // Always render all 18 holes on the x-axis
  const totalHoles = 18;
  const numCompletedHoles = marginHistory?.length || 0;

  // Calculate max margin for y-axis scale (minimum 3 for reasonable scale)
  const maxMargin = numCompletedHoles > 0 
    ? Math.max(3, Math.max(...marginHistory.map(Math.abs)))
    : 3;

  // Data points: start at 0, then each hole's margin (only for completed holes)
  const data = [0, ...marginHistory];

  // Convert data point to SVG coordinates - always use totalHoles for spacing
  const getX = (holeIndex: number) => {
    // holeIndex 0 = start, 1-18 = holes
    return padding.left + (holeIndex / totalHoles) * chartWidth;
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

  // X-axis labels (always show all 18 holes)
  const xLabels = [1, 3, 5, 7, 9, 10, 12, 14, 16, 18].map(hole => (
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

        {/* Front 9 / Back 9 separator - always show */}
        <line
          x1={`${getX(9.5)}%`}
          y1={padding.top}
          x2={`${getX(9.5)}%`}
          y2={padding.top + chartHeight}
          stroke="#cbd5e1"
          strokeWidth={1}
          strokeDasharray="3 3"
        />

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

export default MatchFlowGraph;
