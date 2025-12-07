import React from "react";
import { SCORECARD_DIVIDER_WIDTH } from "../../constants";

interface MatchDividerProps {
  color?: string;
  width?: number;
}

/**
 * Renders a narrow divider column with jagged (toothed) edges on both sides.
 * The teeth are white to match the typical table background and create a cutout effect.
 */
export const MatchDivider: React.FC<MatchDividerProps> = ({ color = "#fff", width }) => {
  const w = width ?? SCORECARD_DIVIDER_WIDTH;
  const svgWidth = 12; // teeth SVG width
  return (
    <div
      className="h-full"
      style={{ width: w, minWidth: w, backgroundColor: color ?? undefined, position: "relative" }}
      aria-hidden
    >
      {/* Left jagged overlay - white triangles to cut into the divider */}
      <svg
        viewBox={`0 0 ${svgWidth} 100`}
        preserveAspectRatio="none"
        style={{ position: "absolute", left: 0, top: 0, height: "100%", width: svgWidth, pointerEvents: "none" }}
      >
        <polygon
          points={`0,0 ${svgWidth},15 0,30 ${svgWidth},45 0,60 ${svgWidth},75 0,90 ${svgWidth},100`}
          fill="#fff"
        />
      </svg>

      {/* Right jagged overlay */}
      <svg
        viewBox={`0 0 ${svgWidth} 100`}
        preserveAspectRatio="none"
        style={{ position: "absolute", right: 0, top: 0, height: "100%", width: svgWidth, pointerEvents: "none" }}
      >
        <polygon
          points={`${svgWidth},0 0,15 ${svgWidth},30 0,45 ${svgWidth},60 0,75 ${svgWidth},90 0,100`}
          fill="#fff"
        />
      </svg>
    </div>
  );
};

export default MatchDivider;
