import { SCORECARD_CELL_WIDTH, SCORECARD_LABEL_WIDTH, SCORECARD_TOTAL_COL_WIDTH } from "../../constants";
import { teeStyle } from "../../utils/teeColors";
import type { HoleData } from "./PlayerScoreRow";

type ScorecardTableHeaderProps = {
  holes: HoleData[];
  closingHole: number | null;
  totals: {
    parOut: number;
    parIn: number;
    parTotal: number;
  };
  tSeries: string;
  courseTees?: string;
};

export function ScorecardTableHeader({
  holes,
  closingHole,
  totals,
  tSeries,
  courseTees,
}: ScorecardTableHeaderProps) {
  const cellWidth = SCORECARD_CELL_WIDTH;
  const labelWidth = SCORECARD_LABEL_WIDTH;
  const totalColWidth = SCORECARD_TOTAL_COL_WIDTH;

  // Paint the yardage row in the tee color it was measured from ("Bronze Ross"
  // → bronze). Null for unnamed/unrecognized tees, which keeps the muted row.
  const tee = teeStyle(courseTees);
  // Every cell needs the color explicitly: the sticky label and the OUT/IN/TOT
  // cells carry their own bg-muted (they must stay opaque while the card
  // scrolls), which would otherwise paint over a background set on the <tr>.
  const teeCell = tee
    ? {
        background: tee.background,
        // Combo tees ("Gold/Blue") show the second color as a stripe along the
        // bottom edge — inset per cell so it reads as one line across the row.
        ...(tee.stripe ? { boxShadow: `inset 0 -3px 0 ${tee.stripe}` } : {}),
      }
    : undefined;
  const teeDivider = tee ? { borderColor: tee.border } : undefined;

  return (
    <thead>
      {/* HEADER ROW - Hole Numbers: 1-9 | OUT | 10-18 | IN | TOT */}
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

      {/* Handicap Row */}
      <tr className="bg-muted text-muted-foreground text-xs border-b border-border">
        <td className="sticky left-0 z-10 bg-muted text-left px-3 py-1">Hcp</td>
        {holes.slice(0, 9).map(h => (
          <td key={h.k} className="py-1">{h.hcpIndex || ""}</td>
        ))}
        <td className="py-1 bg-muted border-l-2 border-border"></td>
        {holes.slice(9, 18).map((h, i) => {
          const holeIdx = 9 + i;
          const isPostMatch = closingHole !== null && holeIdx > closingHole;
          
          return (
            <td 
              key={h.k} 
              className={`py-1 ${i === 0 ? "border-l-2 border-border" : ""} ${isPostMatch ? "bg-muted/60" : ""}`}
            >
              {h.hcpIndex || ""}
            </td>
          );
        })}
        <td className="py-1 bg-muted border-l-2 border-border"></td>
        <td className="py-1 bg-muted"></td>
      </tr>

      {/* Yardage Row - tinted to the tee color when the course names one */}
      <tr
        className={`text-xs border-b border-border ${tee ? "font-semibold" : "bg-muted text-foreground"}`}
        style={tee ? { color: tee.text } : undefined}
      >
        <td
          className={`sticky left-0 z-10 text-left px-3 py-1 capitalize ${tee ? "" : "bg-muted"}`}
          style={teeCell}
        >
          {courseTees || 'Yards'}
        </td>
        {holes.slice(0, 9).map(h => (
          <td key={h.k} className="py-1" style={teeCell}>{h.yards || ""}</td>
        ))}
        <td
          className={`py-1 border-l-2 ${tee ? "" : "bg-muted border-border"}`}
          style={{ ...teeCell, ...teeDivider }}
        >
          {holes.slice(0, 9).reduce((sum, h) => sum + (h.yards || 0), 0) || ""}
        </td>
        {holes.slice(9, 18).map((h, i) => {
          const holeIdx = 9 + i;
          const isPostMatch = closingHole !== null && holeIdx > closingHole;

          return (
            <td
              key={h.k}
              className={`py-1 ${i === 0 ? `border-l-2 ${tee ? "" : "border-border"}` : ""} ${isPostMatch && !tee ? "bg-muted/60" : ""}`}
              style={{
                ...teeCell,
                ...(i === 0 ? teeDivider : {}),
                // Matches the hole-number row: post-match holes fade rather
                // than switching to a tint the tee color would cover.
                ...(isPostMatch && tee ? { opacity: 0.7 } : {}),
              }}
            >
              {h.yards || ""}
            </td>
          );
        })}
        <td
          className={`py-1 border-l-2 ${tee ? "" : "bg-muted border-border"}`}
          style={{ ...teeCell, ...teeDivider }}
        >
          {holes.slice(9, 18).reduce((sum, h) => sum + (h.yards || 0), 0) || ""}
        </td>
        <td className={`py-1 ${tee ? "" : "bg-muted"}`} style={teeCell}>
          {holes.reduce((sum, h) => sum + (h.yards || 0), 0) || ""}
        </td>
      </tr>

      {/* Par Row */}
      <tr className="bg-muted text-muted-foreground text-xs font-semibold">
        <td className="sticky left-0 z-10 bg-muted text-left px-3 py-1.5">Par</td>
        {holes.slice(0, 9).map(h => (
          <td key={h.k} className="py-1.5">{h.par}</td>
        ))}
        <td className="py-1.5 bg-muted font-bold border-l-2 border-border">{totals.parOut}</td>
        {holes.slice(9, 18).map((h, i) => {
          const holeIdx = 9 + i;
          const isPostMatch = closingHole !== null && holeIdx > closingHole;
          
          return (
            <td 
              key={h.k} 
              className={`py-1.5 ${i === 0 ? "border-l-2 border-border" : ""} ${isPostMatch ? "bg-muted/60" : ""}`}
            >
              {h.par}
            </td>
          );
        })}
        <td className="py-1.5 bg-muted font-bold border-l-2 border-border">{totals.parIn}</td>
        <td className="py-1.5 bg-muted font-bold">{totals.parTotal}</td>
      </tr>
    </thead>
  );
}
