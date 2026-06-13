/**
 * Tier color coding for the pairings draft (A = strongest … D = weakest).
 * Tiers drive the A/A·D/D pairing rule, so giving each a distinct, consistent
 * swatch makes the picker and board scannable. Colors are chosen to stay clear
 * of the team palette (navy / red) so a tier chip never reads as a team color.
 */

import type { Tier } from "./roster";

export interface TierStyle {
  /** Tailwind classes for a small chip: text + background. */
  chip: string;
  /** Tailwind ring color class, e.g. for a selected/focused state. */
  ring: string;
}

const TIER_STYLES: Record<Tier, TierStyle> = {
  A: { chip: "bg-amber-100 text-amber-800", ring: "ring-amber-300" },
  B: { chip: "bg-sky-100 text-sky-800", ring: "ring-sky-300" },
  C: { chip: "bg-violet-100 text-violet-800", ring: "ring-violet-300" },
  D: { chip: "bg-slate-200 text-slate-700", ring: "ring-slate-300" },
};

const FALLBACK: TierStyle = { chip: "bg-slate-100 text-slate-500", ring: "ring-slate-200" };

export function tierStyle(tier: string | null | undefined): TierStyle {
  if (tier && tier in TIER_STYLES) return TIER_STYLES[tier as Tier];
  return FALLBACK;
}

/** Ordered tiers for grouping the picker (A first, unknown tiers fall to the end). */
export const TIER_ORDER: Tier[] = ["A", "B", "C", "D"];
