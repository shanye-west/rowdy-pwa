/**
 * Tee-box colors for the scorecard's yardage row.
 *
 * A course's `tees` field is free text typed by an admin ("Black", "Bronze Ross",
 * "Gold/Blue"), so we tokenize it and match any color words we recognize rather
 * than keying off the whole string. Unrecognized or empty values return null and
 * the row keeps its default muted styling.
 *
 * Foreground and divider colors are derived from the tee color instead of being
 * hand-picked per tee, so adding a color below can't accidentally produce an
 * unreadable row.
 */

export interface TeeStyle {
  /** Background for every cell in the row (the primary tee color). */
  background: string;
  /** Text color with the better contrast against `background`. */
  text: string;
  /** Divider color for the OUT/IN separators — the text color, softened. */
  border: string;
  /** Second color of a combo tee ("Gold/Blue"), drawn as a stripe. Else undefined. */
  stripe?: string;
}

/**
 * Hexes are tuned so the derived foreground clears WCAG AA (4.5:1) at the row's
 * 12px type — a few (bronze, copper) are deliberately deeper than the "true"
 * color to get there.
 */
const TEE_COLORS: Record<string, string> = {
  black: "#111827",
  blue: "#1d4ed8",
  white: "#f8fafc",
  gold: "#b8860b",
  yellow: "#eab308",
  silver: "#c0c0c0",
  gray: "#6b7280",
  grey: "#6b7280",
  bronze: "#8c6239",
  copper: "#a35f22",
  brown: "#78350f",
  tan: "#d2b48c",
  red: "#b91c1c",
  green: "#15803d",
  orange: "#ea580c",
  purple: "#7e22ce",
  teal: "#0f766e",
};

const DARK_TEXT = "#0f172a";
const LIGHT_TEXT = "#ffffff";

/** WCAG relative luminance of a `#rrggbb` string. */
function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Crossover luminance where white and near-black text have equal contrast —
 * picking on this boundary maximizes contrast for every color in the table.
 */
const TEXT_FLIP_LUMINANCE = 0.2;

/** Color words in `tees`, in the order written. "Gold/Blue" → ["#b8860b", "#1d4ed8"]. */
function parseTeeColors(tees: string): string[] {
  const seen = new Set<string>();
  const colors: string[] = [];
  // Split on anything that isn't a letter so "Gold/Blue" and "Bronze Ross" both
  // reduce to plain words; unknown words ("Ross") simply drop out.
  for (const word of tees.toLowerCase().split(/[^a-z]+/)) {
    const hex = TEE_COLORS[word];
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      colors.push(hex);
    }
  }
  return colors;
}

/**
 * Style for the yardage row, or null when the tee name carries no color we
 * recognize (including empty/missing) — callers keep their default styling.
 */
export function teeStyle(tees: string | null | undefined): TeeStyle | null {
  if (!tees) return null;

  const colors = parseTeeColors(tees);
  if (colors.length === 0) return null;

  const background = colors[0];
  const text = relativeLuminance(background) > TEXT_FLIP_LUMINANCE ? DARK_TEXT : LIGHT_TEXT;

  return {
    background,
    text,
    border: `color-mix(in srgb, ${text} 35%, transparent)`,
    stripe: colors[1],
  };
}

export default teeStyle;
