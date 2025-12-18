import type { HoleInfo } from "../types";

/**
 * Calculate GHIN course handicap from handicap index (unrounded).
 * Formula: (Handicap Index × (Slope Rating ÷ 113)) + (Course Rating − Par)
 */
export function calculateCourseHandicap(
  handicapIndex: number,
  slopeRating: number,
  courseRating: number,
  par: number
): number {
  return (handicapIndex * (slopeRating / 113)) + (courseRating - par);
}

/**
 * Calculate which holes receive strokes for skins based on handicap index and percentage.
 * Uses GHIN formula: unrounded courseHandicap × percentage, THEN round.
 * Returns an 18-element array of 0 or 1.
 */
export function calculateSkinsStrokes(
  handicapIndex: number,
  handicapPercent: number,
  slopeRating: number,
  courseRating: number,
  par: number,
  courseHoles: HoleInfo[]
): number[] {
  const courseHandicap = calculateCourseHandicap(
    handicapIndex,
    slopeRating,
    courseRating,
    par
  );

  const adjustedHandicap = courseHandicap * (handicapPercent / 100);
  const numStrokesHoles = Math.round(adjustedHandicap);

  const sortedHoles = [...courseHoles]
    .sort((a, b) => a.hcpIndex - b.hcpIndex)
    .slice(0, Math.max(0, numStrokesHoles));

  const strokes = new Array(18).fill(0);
  sortedHoles.forEach(hole => {
    strokes[hole.number - 1] = 1;
  });

  return strokes;
}
