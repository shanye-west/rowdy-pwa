/**
 * Renders a side's label so a two-player pairing never gets cut off: "Alex & Sam"
 * becomes "Alex &" on the first line and "Sam" on the second. Single names
 * (singles matches, team names like "Team A") render on one line. Each line
 * still truncates as a last resort for very long names.
 */

import type { CSSProperties } from "react";

export interface SideLabelProps {
  label: string;
  className?: string;
  style?: CSSProperties;
}

export default function SideLabel({ label, className, style }: SideLabelProps) {
  const idx = label.indexOf(" & ");
  if (idx === -1) {
    return (
      <span className={className} style={style}>
        {label}
      </span>
    );
  }
  const first = label.slice(0, idx);
  const second = label.slice(idx + 3);
  return (
    <span className={className} style={style}>
      <span className="block truncate">{first} &</span>
      <span className="block truncate">{second}</span>
    </span>
  );
}
