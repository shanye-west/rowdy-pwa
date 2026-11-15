import { memo, useMemo } from "react";

const FLAKE_COUNT = 32;
const GLYPHS = ["❄", "❅", "❆", "•"];

/** Small deterministic PRNG so the flake layout is stable across renders. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Decorative falling snow for the Christmas Classic theme.
 *
 * CSS-only (transform/opacity animations, no JS loop), fixed behind the
 * header, never intercepts taps, hidden from screen readers, and switched off
 * entirely under prefers-reduced-motion (see .snowfall in index.css).
 */
export const Snowfall = memo(function Snowfall() {
  const flakes = useMemo(() => {
    const rand = mulberry32(1225);
    return Array.from({ length: FLAKE_COUNT }, (_, i) => {
      const size = 12 + rand() * 14; // px
      return {
        id: i,
        glyph: GLYPHS[Math.floor(rand() * GLYPHS.length)],
        left: rand() * 100, // vw %
        size,
        fall: 9 + rand() * 9, // s to cross the screen
        delay: -rand() * 18, // negative = already mid-fall on mount
        sway: 12 + rand() * 28, // px side-to-side
        swayDur: 3 + rand() * 3,
        opacity: 0.55 + rand() * 0.4,
      };
    });
  }, []);

  return (
    <div className="snowfall" aria-hidden="true">
      {flakes.map((f) => (
        <span
          key={f.id}
          className="snowflake"
          style={
            {
              left: `${f.left}%`,
              fontSize: `${f.size}px`,
              opacity: f.opacity,
              animationDuration: `${f.fall}s`,
              animationDelay: `${f.delay}s`,
            } as React.CSSProperties
          }
        >
          <span
            className="snowflake-sway"
            style={
              {
                "--sway": `${f.sway}px`,
                animationDuration: `${f.swayDur}s`,
                animationDelay: `${f.delay}s`,
              } as React.CSSProperties
            }
          >
            {f.glyph}
          </span>
        </span>
      ))}
    </div>
  );
});
