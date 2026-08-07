import { useEffect, useRef, useState } from "react";
import {
  SCORECARD_CELL_WIDTH,
  SCORECARD_TOTAL_COL_WIDTH,
} from "../constants";
import { teeStyle } from "../utils/teeColors";
import { ScoreInputCell } from "./match/ScoreInputCell";

/** A side event only ever plays nine holes, so there is no OUT/IN split. */
export interface SideEventHole {
  /** Real course hole number as a string — the `holes` map key. */
  k: string;
  num: number;
  par: number;
  hcpIndex?: number;
  yards?: number;
}

export interface SideEventScoreRow {
  teamId: string;
  /** Short row label, e.g. "Team 2". */
  label: string;
  /** Full team, shown under the label. */
  subLabel?: string;
  color: string;
  /** Only the viewing team's row takes input; the rest are read-only context. */
  editable: boolean;
  getValue: (holeKey: string) => number | "";
  onChange?: (holeKey: string, value: number | null) => void;
  erroredKeys?: Set<string>;
  total: number | null;
}

interface SideEventScorecardTableProps {
  holes: SideEventHole[];
  /** Column heading for the nine's total — "OUT" for the front, "IN" for the back. */
  totalLabel: string;
  rows: SideEventScoreRow[];
  tSeries?: string;
  courseTees?: string;
}

// Team names need more room than a player's first name, and nine holes leave
// room to spare compared with the 18-hole card.
const LABEL_WIDTH = 132;

/**
 * The side event scorecard — the same horizontal, real-scorecard layout as the
 * match scramble card (dark HOLE row, then Hcp / Yards / Par, then one score row
 * per team), narrowed to a single nine.
 *
 * It's a separate component rather than a generalization of
 * `match/ScorecardTableHeader` + `TeamScoreRow` because those are built around
 * the 18-hole front/OUT/back/IN/TOT structure and around match play (status
 * row, closing hole, post-match tinting, handicap strokes) — none of which a
 * nine-hole gross scramble has. It deliberately reuses the same cell metrics,
 * tee tinting and `ScoreInputCell` so the two cards read as one system.
 */
export default function SideEventScorecardTable({
  holes,
  totalLabel,
  rows,
  tSeries,
  courseTees,
}: SideEventScorecardTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Fade hint on the right edge while the card still has content off-screen,
  // matching the match scorecard's affordance.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () =>
      setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [holes.length, rows.length]);

  const headerBg = tSeries === "christmasClassic" ? "#b8860b" : "#1e293b";
  const totalBg = tSeries === "christmasClassic" ? "#8b6914" : "#475569";

  // Paint the yardage row in the tee color the course names ("Bronze Ross" →
  // bronze); null keeps the plain muted row.
  const tee = teeStyle(courseTees);
  const teeCell = tee
    ? {
        background: tee.background,
        ...(tee.stripe ? { boxShadow: `inset 0 -3px 0 ${tee.stripe}` } : {}),
      }
    : undefined;
  const teeDivider = tee ? { borderColor: tee.border } : undefined;

  const parTotal = holes.reduce((sum, h) => sum + (h.par || 0), 0);
  const yardsTotal = holes.reduce((sum, h) => sum + (h.yards || 0), 0);

  return (
    <div className="relative">
      {canScrollRight && (
        <div
          className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-8"
          style={{ background: "linear-gradient(to right, transparent, rgba(0,0,0,0.15))" }}
        />
      )}

      <div
        ref={scrollRef}
        className="overflow-x-auto"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <table className="w-max border-collapse text-center text-sm" style={{ minWidth: "100%" }}>
          <thead>
            {/* HOLE numbers */}
            <tr style={{ backgroundColor: headerBg, color: "white" }}>
              <th
                className="sticky left-0 z-10 px-3 py-2 text-left font-bold"
                style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH, backgroundColor: headerBg }}
              >
                HOLE
              </th>
              {holes.map((h) => (
                <th
                  key={h.k}
                  className="py-2 font-bold"
                  style={{ width: SCORECARD_CELL_WIDTH, minWidth: SCORECARD_CELL_WIDTH }}
                >
                  {h.num}
                </th>
              ))}
              <th
                className="border-l-2 py-2 font-bold"
                style={{
                  width: SCORECARD_TOTAL_COL_WIDTH,
                  minWidth: SCORECARD_TOTAL_COL_WIDTH,
                  backgroundColor: totalBg,
                  borderColor: tSeries === "christmasClassic" ? "#8b6914" : "#475569",
                }}
              >
                {totalLabel}
              </th>
            </tr>

            {/* Handicap */}
            <tr className="border-b border-border bg-muted text-xs text-muted-foreground">
              <td className="sticky left-0 z-10 bg-muted px-3 py-1 text-left">Hcp</td>
              {holes.map((h) => (
                <td key={h.k} className="py-1">{h.hcpIndex || ""}</td>
              ))}
              <td className="border-l-2 border-border bg-muted py-1" />
            </tr>

            {/* Yardage, tinted to the tee colour when the course names one */}
            <tr
              className={`border-b border-border text-xs ${tee ? "font-semibold" : "bg-muted text-foreground"}`}
              style={tee ? { color: tee.text } : undefined}
            >
              <td
                className={`sticky left-0 z-10 px-3 py-1 text-left capitalize ${tee ? "" : "bg-muted"}`}
                style={teeCell}
              >
                {courseTees || "Yards"}
              </td>
              {holes.map((h) => (
                <td key={h.k} className="py-1" style={teeCell}>{h.yards || ""}</td>
              ))}
              <td
                className={`border-l-2 py-1 ${tee ? "" : "border-border bg-muted"}`}
                style={{ ...teeCell, ...teeDivider }}
              >
                {yardsTotal || ""}
              </td>
            </tr>

            {/* Par */}
            <tr className="bg-muted text-xs font-semibold text-muted-foreground">
              <td className="sticky left-0 z-10 bg-muted px-3 py-1.5 text-left">Par</td>
              {holes.map((h) => (
                <td key={h.k} className="py-1.5">{h.par || ""}</td>
              ))}
              <td className="border-l-2 border-border bg-muted py-1.5 font-bold">
                {parTotal || ""}
              </td>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.teamId}
                className={idx < rows.length - 1 ? "border-b border-border" : ""}
              >
                <td
                  className="sticky left-0 z-10 bg-card px-3 py-1 text-left font-semibold"
                  style={{ color: row.color }}
                >
                  <div className="truncate" style={{ maxWidth: LABEL_WIDTH - 24 }}>
                    {row.label}
                  </div>
                  {row.subLabel && (
                    <div
                      className="truncate text-[0.65rem] font-normal text-muted-foreground"
                      style={{ maxWidth: LABEL_WIDTH - 24 }}
                    >
                      {row.subLabel}
                    </div>
                  )}
                </td>

                {holes.map((h) => {
                  const value = row.getValue(h.k);
                  return (
                    <td key={h.k} className="p-0.5">
                      {row.editable ? (
                        <ScoreInputCell
                          holeKey={h.k}
                          holeNum={h.num}
                          value={value}
                          par={h.par}
                          locked={false}
                          hasStroke={false}
                          hasDrive={false}
                          lowScoreStatus={null}
                          teamColor={row.color}
                          onChange={row.onChange ?? (() => {})}
                          hasError={!!row.erroredKeys?.has(h.k)}
                          cellId={`side-event-${row.teamId}-${h.k}`}
                        />
                      ) : (
                        // Read-only rows render a plain cell rather than a locked
                        // ScoreInputCell: that component mounts a full number
                        // picker per cell, which across every other team would be
                        // hundreds of unusable buttons in the DOM.
                        <div
                          className="mx-auto flex h-11 w-11 select-none items-center justify-center rounded-md border border-border bg-muted text-base font-semibold text-muted-foreground"
                          aria-label={`Hole ${h.num}${value === "" ? "" : `: ${value}`}`}
                        >
                          {value}
                        </div>
                      )}
                    </td>
                  );
                })}

                <td className="border-l-2 border-border bg-muted py-1 font-bold text-foreground">
                  {row.total ?? "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
