import { DEFAULT_COURSE_PAR } from "./constants.js";

/**
 * Calculate GHIN course handicap from handicap index.
 * Formula: courseHandicap = (handicapIndex × (slopeRating ÷ 113)) + (courseRating − par)
 * Returns a rounded course handicap with NaN-safety.
 */
export function calculateCourseHandicap(
  handicapIndex: number,
  slopeRating: number = 113,
  courseRating?: number,
  par: number = DEFAULT_COURSE_PAR
): number {
  const hiNum = (typeof handicapIndex === "number") ? handicapIndex : Number(handicapIndex) || 0;
  const slope = Number(slopeRating) || 113;
  const parNum = Number(par) || DEFAULT_COURSE_PAR;
  const rating = (typeof courseRating === "number") ? courseRating : (Number(courseRating) || parNum);

  const unrounded = (hiNum * (slope / 113)) + (rating - parNum);
  const rounded = Math.round(unrounded);
  return Number.isNaN(rounded) ? 0 : rounded;
}

/**
 * Calculate strokesReceived array for a player based on course handicap.
 * Strokes are assigned to holes by difficulty (hcpIndex), with 1 stroke max per hole.
 */
export function calculateStrokesReceived(courseHandicap: number, courseHoles: any[]): number[] {
  const strokes = Array(18).fill(0);

  const sortedByDifficulty = [...courseHoles].sort((a, b) => a.hcpIndex - b.hcpIndex);

  const strokeCount = Math.min(Math.max(0, Math.round(courseHandicap)), 18);
  for (let i = 0; i < strokeCount; i++) {
    const holeNum = sortedByDifficulty[i].number;
    strokes[holeNum - 1] = 1;
  }

  return strokes;
}
