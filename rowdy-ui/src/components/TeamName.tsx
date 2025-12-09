import React, { useRef, useLayoutEffect, useEffect } from "react";

export type TeamNameVariant = "tile" | "inline";

export interface TeamNameProps {
  name: string;
  className?: string;
  title?: string;
  minFontPx?: number;
  maxFontPx?: number;
  variant?: TeamNameVariant;
  style?: React.CSSProperties;
}

/**
 * TeamName: automatically scales the font-size so the full name fits on one line.
 * - Uses a fast binary-search fit against the container width.
 * - Watches container size changes via ResizeObserver.
 * - Keeps the name on a single line (no truncation).
 */
const TeamName: React.FC<TeamNameProps> = ({
  name,
  className = "",
  title,
  minFontPx = 12,
  maxFontPx = 36,
  variant = "inline",
  style,
}: TeamNameProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);

  // Runs a binary search to find the largest font size that fits.
  const fitText = () => {
    const cont = containerRef.current;
    const txt = textRef.current;
    if (!cont || !txt) return;

    // allow a tiny padding offset so text doesn't touch edges
    const available = Math.max(0, cont.clientWidth - 6);

    let low = minFontPx;
    let high = maxFontPx;
    let best = minFontPx;

    // binary search on integer px sizes
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      txt.style.fontSize = `${mid}px`;
      // scrollWidth reflects actual rendered width
      if (txt.scrollWidth <= available) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    txt.style.fontSize = `${best}px`;
  };

  // Fit initially and whenever the name changes
  useLayoutEffect(() => {
    fitText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, minFontPx, maxFontPx]);

  // Re-fit on container resize
  useEffect(() => {
    const cont = containerRef.current;
    if (!cont) return;
    const ro = new ResizeObserver(() => {
      fitText();
    });
    ro.observe(cont);
    // also listen for window resize as a fallback
    const onWin = () => fitText();
    window.addEventListener("resize", onWin);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWin);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isTile = variant === "tile";

  const containerStyle: React.CSSProperties = isTile
    ? { display: "flex", alignItems: "center", justifyContent: "center", padding: "0.25rem 0.5rem", boxSizing: "border-box" }
    : { display: "inline-block", padding: 0, boxSizing: "border-box" };

  return (
    <div ref={containerRef} className={className} title={title ?? name} style={{ ...containerStyle, ...(style || {}) }}>
      <span ref={textRef} style={{ whiteSpace: "nowrap", lineHeight: 1, fontWeight: 600, display: "inline-block" }}>
        {name}
      </span>
    </div>
  );
};

export default TeamName;
