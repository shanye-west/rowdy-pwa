import type { CSSProperties } from "react";

export interface MatchStatusBadgeProps {
  /** Match status object */
  status?: {
    closed?: boolean;
    leader?: "teamA" | "teamB" | null;
    margin?: number;
    thru?: number;
  } | null;
  /** Match result object */
  result?: {
    winner?: "teamA" | "teamB" | "AS" | null;
  } | null;
  /** Team A color (CSS color value) */
  teamAColor?: string;
  /** Team B color (CSS color value) */
  teamBColor?: string;
  /** Team A display name */
  teamAName?: string;
  /** Team B display name */
  teamBName?: string;
  /** Size variant */
  variant?: "default" | "compact";
  /** Match number for display on unstarted matches */
  matchNumber?: number;
  /** Tee time (Firestore Timestamp) for display on unstarted matches */
  teeTime?: any;
}

/**
 * Displays match status in a consistent visual format.
 * Used on Round page match cards and Match page header.
 * 
 * States handled:
 * - Not started: "Match X" with tee time (e.g., "9:10am")
 * - In progress (all square): "ALL SQUARE" with "THRU X"
 * - In progress (leader): Team name, "X UP", "THRU Y"
 * - Completed (halved): "TIED" with "FINAL"
 * - Completed (winner): Team name, margin, "FINAL"
 */
export function MatchStatusBadge({
  status,
  result,
  teamAColor = "var(--team-a-default)",
  teamBColor = "var(--team-b-default)",
  teamAName = "Team A",
  teamBName = "Team B",
  variant = "default",
  matchNumber,
  teeTime,
}: MatchStatusBadgeProps) {
  const isClosed = status?.closed === true;
  const thru = status?.thru ?? 0;
  const isStarted = thru > 0;
  const leader = status?.leader;
  const margin = status?.margin ?? 0;
  const winner = result?.winner;

  // Get status color for in-progress matches
  let statusColor: string;
  if (leader === "teamA") {
    statusColor = teamAColor;
  } else if (leader === "teamB") {
    statusColor = teamBColor;
  } else {
    statusColor = "#94a3b8"; // slate-400
  }

  // Compact variant uses slightly smaller text
  const fontSize = variant === "compact" ? "0.9rem" : "1rem";
  const labelSize = variant === "compact" ? "0.6rem" : "0.65rem";
  const height = variant === "compact" ? 48 : 52;

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height,
  };

  const labelStyle: CSSProperties = {
    fontSize: labelSize,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  const mainTextStyle: CSSProperties = {
    whiteSpace: "nowrap",
    fontSize,
    fontWeight: 700,
  };

  // Completed match
  if (isClosed) {
    if (winner === "AS") {
      // Halved/Tied match
      return (
        <div style={containerStyle}>
          <div style={{ ...mainTextStyle, color: "#334155" }}>TIED</div>
          <div style={{ ...labelStyle, color: "#64748b" }}>FINAL</div>
        </div>
      );
    }

    // Match with a winner
    const winnerName = winner === "teamA" ? teamAName : teamBName;
    const marginText = thru === 18 
      ? `${margin}UP` 
      : `${margin}&${18 - thru}`;

    return (
      <div style={containerStyle}>
        <div style={{ ...labelStyle, color: "rgba(255,255,255,0.85)" }}>
          {winnerName}
        </div>
        <div style={{ ...mainTextStyle, color: "white" }}>
          {marginText}
        </div>
        <div style={{ ...labelStyle, color: "rgba(255,255,255,0.85)" }}>
          FINAL
        </div>
      </div>
    );
  }

  // In progress with leader
  if (isStarted && leader) {
    const leaderName = leader === "teamA" ? teamAName : teamBName;

    return (
      <div style={containerStyle}>
        <div style={{ ...labelStyle, color: statusColor }}>
          {leaderName}
        </div>
        <div style={{ ...mainTextStyle, color: statusColor }}>
          {margin} UP
        </div>
        <div style={{ ...labelStyle, color: "#94a3b8" }}>
          THRU {thru}
        </div>
      </div>
    );
  }

  // In progress, all square
  if (isStarted) {
    return (
      <div style={containerStyle}>
        <div style={{ ...mainTextStyle, color: "#64748b" }}>ALL SQUARE</div>
        <div style={{ ...labelStyle, color: "#64748b" }}>THRU {thru}</div>
      </div>
    );
  }

  // Not started
  // Format tee time if available
  let teeTimeStr = "";
  if (teeTime) {
    const date = teeTime.toDate ? teeTime.toDate() : new Date(teeTime);
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "pm" : "am";
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesStr = minutes < 10 ? `0${minutes}` : minutes;
    teeTimeStr = `${hours}:${minutesStr}${ampm}`;
  }

  return (
    <div style={containerStyle}>
      {matchNumber && (
        <div style={{ ...mainTextStyle, color: "#64748b" }}>
          Match {matchNumber}
        </div>
      )}
      {teeTimeStr && (
        <>
          <div style={{ ...labelStyle, color: "#94a3b8" }}>Tee Time</div>
          <div style={{ ...mainTextStyle, color: "#64748b" }}>{teeTimeStr}</div>
        </>
      )}
      {!matchNumber && !teeTimeStr && (
        <div
          style={{
            whiteSpace: "nowrap",
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "#94a3b8",
          }}
        >
          Not Started
        </div>
      )}
    </div>
  );
}

/**
 * Returns background and border styles for match card based on state.
 * Use this alongside MatchStatusBadge for consistent card styling.
 */
export function getMatchCardStyles(
  status?: { closed?: boolean; leader?: "teamA" | "teamB" | null } | null,
  result?: { winner?: "teamA" | "teamB" | "AS" | null } | null,
  teamAColor = "var(--team-a-default)",
  teamBColor = "var(--team-b-default)"
): { bgStyle: React.CSSProperties; borderStyle: React.CSSProperties; textColor: string } {
  const isClosed = status?.closed === true;
  const leader = status?.leader;
  const winner = result?.winner;

  let bgStyle: React.CSSProperties = {};
  let borderStyle: React.CSSProperties = {};
  let textColor = "text-slate-900";

  if (isClosed && winner && winner !== "AS") {
    // Completed match with a winner - full team color background
    const winnerColor = winner === "teamA" ? teamAColor : teamBColor;
    bgStyle = { backgroundColor: winnerColor };
    textColor = "text-white";
  } else if (isClosed && winner === "AS") {
    // Halved match - grey background with team color borders
    bgStyle = { backgroundColor: "#cbd5e1" };
    borderStyle = {
      borderLeft: `4px solid ${teamAColor}`,
      borderRight: `4px solid ${teamBColor}`,
    };
    textColor = "text-slate-700";
  } else if (leader === "teamA") {
    bgStyle = { background: `linear-gradient(90deg, ${teamAColor}11 0%, transparent 30%)` };
    borderStyle = { borderLeft: `4px solid ${teamAColor}`, borderRight: "4px solid transparent" };
  } else if (leader === "teamB") {
    bgStyle = { background: `linear-gradient(-90deg, ${teamBColor}11 0%, transparent 30%)` };
    borderStyle = { borderRight: `4px solid ${teamBColor}`, borderLeft: "4px solid transparent" };
  }

  return { bgStyle, borderStyle, textColor };
}
