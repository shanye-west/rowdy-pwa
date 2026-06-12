/**
 * Shared stroke-allocation core for seedMatch / editMatch /
 * recalculateMatchStrokes. Pure (no Firestore) so it can be unit-tested:
 * GHIN course handicap per player, "spin down" from the lowest, then per-hole
 * strokesReceived arrays.
 *
 * Handicap-index *resolution* (caller override vs tournament map) differs per
 * callable and stays at the call sites — this helper takes resolved indexes.
 */

import { calculateCourseHandicap, calculateStrokesReceived } from "../ghin.js";
import { DEFAULT_COURSE_PAR } from "../constants.js";

export interface ResolvedPlayer {
  playerId: string;
  handicapIndex: number;
}

export interface CourseForStrokes {
  slope?: number;
  rating?: number;
  par?: number;
  holes: { number: number; par: number; hcpIndex: number }[];
}

export interface PlayerWithStrokes {
  playerId: string;
  strokesReceived: number[];
}

export interface TeamsWithStrokes {
  teamAPlayersWithStrokes: PlayerWithStrokes[];
  teamBPlayersWithStrokes: PlayerWithStrokes[];
  courseHandicaps: number[];
}

/** Course parameters with the same fallbacks the callables have always used. */
export function resolveCourseParams(course: CourseForStrokes): {
  slopeRating: number;
  courseRating: number;
  coursePar: number;
} {
  return {
    slopeRating: course.slope ?? 113,
    courseRating: typeof course.rating === "number" ? course.rating : (course.par ?? DEFAULT_COURSE_PAR),
    coursePar: course.par ?? DEFAULT_COURSE_PAR,
  };
}

export function computeTeamsWithStrokes(
  teamAPlayers: ResolvedPlayer[],
  teamBPlayers: ResolvedPlayer[],
  course: CourseForStrokes
): TeamsWithStrokes {
  const { slopeRating, courseRating, coursePar } = resolveCourseParams(course);

  const courseHandicaps = [...teamAPlayers, ...teamBPlayers].map((p) =>
    calculateCourseHandicap(p.handicapIndex, slopeRating, courseRating, coursePar)
  );

  // "Spin down" from the lowest course handicap
  const lowestHandicap = Math.min(...courseHandicaps);

  const withStrokes = (p: ResolvedPlayer, overallIdx: number): PlayerWithStrokes => ({
    playerId: p.playerId,
    strokesReceived: calculateStrokesReceived(courseHandicaps[overallIdx] - lowestHandicap, course.holes),
  });

  return {
    teamAPlayersWithStrokes: teamAPlayers.map((p, idx) => withStrokes(p, idx)),
    teamBPlayersWithStrokes: teamBPlayers.map((p, idx) => withStrokes(p, teamAPlayers.length + idx)),
    courseHandicaps,
  };
}
