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
 * After a match closes early, holes beyond the closing hole are shown shaded with a
 * diagonal pattern and are not considered for wins/losses.
 */
export function HoleByHoleTracker({
  match,
  format,
  teamAColor,
  teamBColor,
}: HoleByHoleTrackerProps) {
  // If a match closed early, `status.thru` tells how many holes were completed.
  // Ignore any inputs beyond that hole so tiles don't change after close.
  const closingThru: number | null = match?.status?.closed ? (match.status.thru || null) : null;

  // Build metadata for all 18 holes.
  const holesArray = Array.from({ length: 18 }, (_, idx) => {
    const holeNum = idx + 1;
    const holeData = match.holes?.[String(holeNum)];

    const afterClose = closingThru != null && holeNum > closingThru;

    // Consider a hole played only if it's not after close and input exists.
    let hasScore = false;
    if (!afterClose && holeData?.input) {
      const input = holeData.input;
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
    }

    const winner = hasScore ? getHoleWinner(match, format, holeNum) : null;
    return { holeNum, winner, played: hasScore, afterClose };
  });

  // Always render all 18 holes on the round page tiles.
  const showAll = true;
  const totalGap = 17 * 2; // 2px gap
  const perHoleCalc = `calc((100% - ${totalGap}px) / 18)`;
  const fixedSize = "22px";

  const holeStyle = (winner: "teamA" | "teamB" | "AS" | null, afterClose: boolean): CSSProperties => {
    const baseStyle: CSSProperties = {
      width: showAll ? perHoleCalc : fixedSize,
      aspectRatio: "1 / 1",
      minWidth: "14px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: showAll ? "0.6rem" : "0.65rem",
      fontWeight: 600,
      borderRadius: "50%",
      transition: "all 0.12s ease",
      boxSizing: "border-box",
    };

    if (afterClose) {
      return {
        ...baseStyle,
        backgroundColor: "transparent",
        color: "#64748b",
        border: "1px dashed #cbd5e1",
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(0,0,0,0.06) 0 6px, transparent 6px 12px)",
      };
    }

    if (winner === "teamA") {
      return {
        ...baseStyle,
        backgroundColor: teamAColor,
        color: "white",
        border: `2px solid ${teamAColor}`,
      };
    }

    if (winner === "teamB") {
      return {
        ...baseStyle,
        backgroundColor: teamBColor,
        color: "white",
        border: `2px solid ${teamBColor}`,
      };
    }

    if (winner === "AS") {
      return {
        ...baseStyle,
        backgroundColor: "#94a3b8",
        color: "white",
        border: "2px solid #94a3b8",
      };
    }

    // Not played yet
    return {
      ...baseStyle,
      backgroundColor: "transparent",
      color: "#94a3b8",
      border: "1px dashed #cbd5e1",
    };
  };

  // Container: left-align items; do not stretch when only a few holes are shown
  const containerStyle: CSSProperties = {
    display: "flex",
    gap: "2px",
    flexWrap: "nowrap",
    justifyContent: "flex-start",
    alignItems: "center",
    marginTop: "6px",
    padding: "2px 0",
    width: "100%",
  };
  // Determine which holes to display:
  // - If match is closed: show holes 1..closingThru as played (or as existing), then render remaining holes (closingThru+1..18)
  //   as the dotted/diagonal placeholder.
  // - If match is not closed: only show holes that have been played.
  const isClosed = !!match?.status?.closed;
  let displayHoles = [] as Array<{ holeNum: number; winner: "teamA" | "teamB" | "AS" | null; played: boolean; afterClose: boolean }>;

  if (isClosed) {
    const closing = closingThru ?? Math.max(0, ...holesArray.filter((h) => h.played).map((h) => h.holeNum));
    const played = holesArray.slice(0, closing);
    const remaining = holesArray.slice(closing).map((h) => ({ ...h, afterClose: true, played: false }));
    displayHoles = [...played, ...remaining];
  } else {
    displayHoles = holesArray.filter((h) => h.played);
  }

  return (
    <div style={containerStyle} aria-label="Hole-by-hole results">
      {displayHoles.map((r) => (
        <div
          key={r.holeNum}
          style={holeStyle(r.winner, r.afterClose)}
          aria-label={
            r.afterClose
              ? `Hole ${r.holeNum}: Not played (match closed)`
              : r.winner
              ? `Hole ${r.holeNum}: ${r.winner === "AS" ? "Halved" : r.winner === "teamA" ? "Team A" : "Team B"}`
              : `Hole ${r.holeNum}: Not played`
          }
        >
          {r.holeNum}
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
