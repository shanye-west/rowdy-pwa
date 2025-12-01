type ScoreTrackerBarProps = {
  totalPoints: number;
  teamAConfirmed: number;
  teamBConfirmed: number;
  teamAPending: number;
  teamBPending: number;
  teamAColor?: string;
  teamBColor?: string;
};

/**
 * Ryder Cup-style score tracker bar.
 * Boxes fill left→right for Team A, right→left for Team B.
 * Confirmed points = solid color, pending points = transparent/lighter color.
 * Half-points (halves) fill half a box.
 */
export default function ScoreTrackerBar({
  totalPoints,
  teamAConfirmed,
  teamBConfirmed,
  teamAPending,
  teamBPending,
  teamAColor = "var(--team-a-default)",
  teamBColor = "var(--team-b-default)",
}: ScoreTrackerBarProps) {
  if (totalPoints <= 0) return null;

  // Build array of box states
  // Each box represents 1 point. We track fills from each side.
  // Team A fills from left (index 0), Team B fills from right (index totalPoints-1)
  
  // Total fill amounts (in points)
  const teamATotal = teamAConfirmed + teamAPending;
  const teamBTotal = teamBConfirmed + teamBPending;
  
  // Build box data
  const boxes: {
    teamAFill: number;      // 0, 0.5, or 1 - how much Team A fills this box
    teamBFill: number;      // 0, 0.5, or 1 - how much Team B fills this box
    teamAConfirmed: boolean; // Is Team A's fill confirmed (solid) vs pending (transparent)?
    teamBConfirmed: boolean; // Is Team B's fill confirmed?
  }[] = [];

  for (let i = 0; i < totalPoints; i++) {
    boxes.push({ teamAFill: 0, teamBFill: 0, teamAConfirmed: false, teamBConfirmed: false });
  }

  // Fill Team A boxes from left (index 0 onwards)
  let teamARemaining = teamATotal;
  let teamAConfirmedRemaining = teamAConfirmed;
  for (let i = 0; i < totalPoints && teamARemaining > 0; i++) {
    const fill = Math.min(1, teamARemaining);
    boxes[i].teamAFill = fill;
    // Determine if this fill is confirmed or pending
    if (teamAConfirmedRemaining >= fill) {
      boxes[i].teamAConfirmed = true;
      teamAConfirmedRemaining -= fill;
    } else if (teamAConfirmedRemaining > 0) {
      // Partial confirmed - for simplicity, if any confirmed remains, mark as confirmed
      // (edge case: 0.5 confirmed + 0.5 pending in same box - treat confirmed portion as confirmed)
      boxes[i].teamAConfirmed = teamAConfirmedRemaining >= fill;
      teamAConfirmedRemaining = 0;
    }
    teamARemaining -= fill;
  }

  // Fill Team B boxes from right (index totalPoints-1 backwards)
  let teamBRemaining = teamBTotal;
  let teamBConfirmedRemaining = teamBConfirmed;
  for (let i = totalPoints - 1; i >= 0 && teamBRemaining > 0; i--) {
    // Check how much space is available (not taken by Team A)
    const availableSpace = 1 - boxes[i].teamAFill;
    if (availableSpace <= 0) continue; // Box fully filled by Team A
    
    const fill = Math.min(availableSpace, teamBRemaining);
    boxes[i].teamBFill = fill;
    // Determine if this fill is confirmed or pending
    if (teamBConfirmedRemaining >= fill) {
      boxes[i].teamBConfirmed = true;
      teamBConfirmedRemaining -= fill;
    } else if (teamBConfirmedRemaining > 0) {
      boxes[i].teamBConfirmed = teamBConfirmedRemaining >= fill;
      teamBConfirmedRemaining = 0;
    }
    teamBRemaining -= fill;
  }

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: 24,
        borderRadius: 4,
        overflow: "hidden",
        background: "#e5e7eb", // neutral gray for empty boxes
        gap: 2,
      }}
    >
      {boxes.map((box, idx) => (
        <div
          key={idx}
          style={{
            flex: 1,
            position: "relative",
            background: "#e5e7eb",
            minWidth: 0, // allow shrinking
          }}
        >
          {/* Team A fill (from left side of box) */}
          {box.teamAFill > 0 && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${box.teamAFill * 100}%`,
                background: teamAColor,
                opacity: box.teamAConfirmed ? 1 : 0.4,
              }}
            />
          )}
          {/* Team B fill (from right side of box) */}
          {box.teamBFill > 0 && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: `${box.teamBFill * 100}%`,
                background: teamBColor,
                opacity: box.teamBConfirmed ? 1 : 0.4,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
