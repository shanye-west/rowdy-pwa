import type { CSSProperties } from "react";
import type { MatchDoc } from "../types";

interface HoleByHoleTrackerProps {
  match: MatchDoc;
  format: string | null;
  teamAColor: string;
  teamBColor: string;
}

/**
 * Visual tracker showing hole-by-hole results for a match.
 * Renders 18 holes with circles indicating winner (team color) or halved (grey).
 * Only shows on Round page match tiles.
 */
export function HoleByHoleTracker({
  match,
  format,
  teamAColor,
  teamBColor,
}: HoleByHoleTrackerProps) {
  // Get hole results for all 18 holes
  const holeResults = Array.from({ length: 18 }, (_, idx) => {
    const holeNum = idx + 1;
    const holeData = match.holes?.[String(holeNum)];
    
    if (!holeData?.input) return null;
    
    // Check if hole has been played (has any input)
    const input = holeData.input;
    let hasScore = false;
    
    if (format === "singles") {
      hasScore = input.teamAPlayerGross != null || input.teamBPlayerGross != null;
    } else if (format === "twoManScramble" || format === "fourManScramble") {
      hasScore = input.teamAGross != null || input.teamBGross != null;
    } else if (format === "twoManBestBall" || format === "twoManShamble") {
      const aArr = input.teamAPlayersGross;
      const bArr = input.teamBPlayersGross;
      hasScore = (Array.isArray(aArr) && (aArr[0] != null || aArr[1] != null)) ||
                 (Array.isArray(bArr) && (bArr[0] != null || bArr[1] != null));
    }
    
    if (!hasScore) return null;
    
    // Determine hole winner (simplified - could import full logic from match scoring)
    return getHoleWinner(match, format, holeNum);
  });

  const containerStyle: CSSProperties = {
    display: "flex",
    gap: "4px",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: "8px",
    padding: "4px 0",
  };

  const holeStyle = (result: "teamA" | "teamB" | "AS" | null): CSSProperties => {
    const baseStyle: CSSProperties = {
      width: "26px",
      height: "26px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "0.75rem",
      fontWeight: 600,
      borderRadius: "50%",
      transition: "all 0.2s ease",
    };

    if (result === "teamA") {
      return {
        ...baseStyle,
        backgroundColor: teamAColor,
        color: "white",
        border: `2px solid ${teamAColor}`,
      };
    } else if (result === "teamB") {
      return {
        ...baseStyle,
        backgroundColor: teamBColor,
        color: "white",
        border: `2px solid ${teamBColor}`,
      };
    } else if (result === "AS") {
      return {
        ...baseStyle,
        backgroundColor: "#94a3b8",
        color: "white",
        border: "2px solid #94a3b8",
      };
    }

    // Not yet played
    return {
      ...baseStyle,
      backgroundColor: "transparent",
      color: "#94a3b8",
      border: "none",
    };
  };

  return (
    <div style={containerStyle} aria-label="Hole-by-hole results">
      {holeResults.map((result, idx) => (
        <div
          key={idx + 1}
          style={holeStyle(result)}
          aria-label={
            result
              ? `Hole ${idx + 1}: ${result === "AS" ? "Halved" : result === "teamA" ? "Team A" : "Team B"}`
              : `Hole ${idx + 1}: Not played`
          }
        >
          {idx + 1}
        </div>
      ))}
    </div>
  );
}

/**
 * Simplified hole winner calculation (matches backend logic).
 * Returns "teamA" | "teamB" | "AS" | null
 */
function getHoleWinner(
  match: MatchDoc,
  format: string | null,
  holeNum: number
): "teamA" | "teamB" | "AS" | null {
  const holeData = match.holes?.[String(holeNum)];
  if (!holeData?.input) return null;

  const input = holeData.input;

  // Singles
  if (format === "singles") {
    const aGross = input.teamAPlayerGross;
    const bGross = input.teamBPlayerGross;
    if (aGross == null || bGross == null) return null;

    const aStrokes = match.teamAPlayers?.[0]?.strokesReceived?.[holeNum - 1] || 0;
    const bStrokes = match.teamBPlayers?.[0]?.strokesReceived?.[holeNum - 1] || 0;

    const aNet = aGross - aStrokes;
    const bNet = bGross - bStrokes;

    if (aNet < bNet) return "teamA";
    if (bNet < aNet) return "teamB";
    return "AS";
  }

  // Scramble (team gross)
  if (format === "twoManScramble" || format === "fourManScramble") {
    const aGross = input.teamAGross;
    const bGross = input.teamBGross;
    if (aGross == null || bGross == null) return null;

    if (aGross < bGross) return "teamA";
    if (bGross < aGross) return "teamB";
    return "AS";
  }

  // Best Ball (best net per team)
  if (format === "twoManBestBall") {
    const aArr = input.teamAPlayersGross;
    const bArr = input.teamBPlayersGross;
    if (!Array.isArray(aArr) || !Array.isArray(bArr)) return null;
    if (aArr[0] == null || aArr[1] == null || bArr[0] == null || bArr[1] == null) return null;

    const a0Strokes = match.teamAPlayers?.[0]?.strokesReceived?.[holeNum - 1] || 0;
    const a1Strokes = match.teamAPlayers?.[1]?.strokesReceived?.[holeNum - 1] || 0;
    const b0Strokes = match.teamBPlayers?.[0]?.strokesReceived?.[holeNum - 1] || 0;
    const b1Strokes = match.teamBPlayers?.[1]?.strokesReceived?.[holeNum - 1] || 0;

    const aNet = Math.min(aArr[0] - a0Strokes, aArr[1] - a1Strokes);
    const bNet = Math.min(bArr[0] - b0Strokes, bArr[1] - b1Strokes);

    if (aNet < bNet) return "teamA";
    if (bNet < aNet) return "teamB";
    return "AS";
  }

  // Shamble (best gross per team)
  if (format === "twoManShamble") {
    const aArr = input.teamAPlayersGross;
    const bArr = input.teamBPlayersGross;
    if (!Array.isArray(aArr) || !Array.isArray(bArr)) return null;
    if (aArr[0] == null || aArr[1] == null || bArr[0] == null || bArr[1] == null) return null;

    const aGross = Math.min(aArr[0], aArr[1]);
    const bGross = Math.min(bArr[0], bArr[1]);

    if (aGross < bGross) return "teamA";
    if (bGross < aGross) return "teamB";
    return "AS";
  }

  return null;
}
