/**
 * Par of the holes actually played — the basis for every "strokes vs par"
 * figure. Pure (no Firestore) so it can be unit-tested.
 *
 * Match play closes early: a 5&4 win is 14 holes. Measuring a 14-hole gross
 * against the full 18-hole course par reads ~4 strokes too low per unplayed
 * hole, which is why vs-par must always be computed against the par of the
 * holes that carry a score.
 *
 * The gross predicate here is deliberately identical to the `holesPlayed`
 * count in updateMatchFacts (`typeof gross === "number"`). parPlayed and
 * holesPlayed must never disagree: the round recap divides by holesPlayed to
 * rank on a per-18 basis, so a mismatched denominator would silently skew it.
 */

import type { RoundFormat } from "../types.js";

/** The subset of a holePerformance entry this module needs. */
export interface HolePerfLike {
  hole?: number | null;
  par?: number | null;
  gross?: number | null;
  partnerGross?: number | null;
}

/**
 * Par source: an explicit `holePars` array (1-indexed by hole number) wins over
 * the entry's own `par`. Callers reading stored facts pass holePars so the live
 * course doc stays authoritative; the fact writer omits it, since it stamped
 * `perf.par` from the same course data in the same run.
 */
function sumParWhere(
  holePerformance: readonly HolePerfLike[] | null | undefined,
  played: (perf: HolePerfLike) => boolean,
  holePars?: readonly number[]
): number {
  if (!Array.isArray(holePerformance)) return 0;

  let total = 0;
  for (const perf of holePerformance) {
    if (!played(perf)) continue;

    let par: number | null | undefined = perf.par;
    if (holePars && typeof perf.hole === "number") {
      const idx = perf.hole - 1;
      par = idx >= 0 && idx < holePars.length ? holePars[idx] : null;
    }

    if (typeof par === "number") total += par;
  }
  return total;
}

/** Par of the holes THIS PLAYER recorded a gross on (singles, twoManBestBall). */
export function parForPlayerHolesPlayed(
  holePerformance: readonly HolePerfLike[] | null | undefined,
  holePars?: readonly number[]
): number {
  return sumParWhere(holePerformance, (p) => typeof p.gross === "number", holePars);
}

/**
 * Par of the holes THIS TEAM has a ball on (scramble, shamble).
 *
 * Format-aware, and the asymmetry is load-bearing:
 *  - scramble stores the TEAM gross directly in `gross`;
 *  - shamble stores the player's INDIVIDUAL gross in `gross` plus the
 *    partner's in `partnerGross`, and teamTotalGross takes min(both) on holes
 *    where either is valid. So the team played the hole if EITHER partner has
 *    a ball — gating on `gross` alone would make two partners' facts disagree
 *    about their own team's vs-par.
 */
export function parForTeamHolesPlayed(
  holePerformance: readonly HolePerfLike[] | null | undefined,
  format: RoundFormat,
  holePars?: readonly number[]
): number {
  const played =
    format === "twoManShamble"
      ? (p: HolePerfLike) => typeof p.gross === "number" || typeof p.partnerGross === "number"
      : (p: HolePerfLike) => typeof p.gross === "number";

  return sumParWhere(holePerformance, played, holePars);
}
