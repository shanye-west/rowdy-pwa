/**
 * Shared constants for Rowdy Cup Cloud Functions
 */

// =============================================================================
// GOLF SCORING
// =============================================================================

/** Default course par when not specified */
export const DEFAULT_COURSE_PAR = 72;

/** Minimum drives required per player per round (6 = 3 per 9) */
export const MIN_DRIVES_PER_ROUND = 6;

/**
 * Sanity bounds for a single-hole gross score. Security rules let rostered
 * players write arbitrary values into `holes.{N}.input`; anything outside
 * this range is treated as "not scored" rather than fed into match results
 * and stats. 30 comfortably covers the worst real hole anyone will admit to.
 */
export const MIN_GROSS_SCORE = 1;
export const MAX_GROSS_SCORE = 30;

// =============================================================================
// STAT BADGES & THRESHOLDS
// =============================================================================

/** 
 * Jekyll & Hyde threshold: If worst ball total - best ball total >= this value,
 * the team earns the Jekyll & Hyde badge (indicating wildly inconsistent play)
 */
export const JEKYLL_AND_HYDE_THRESHOLD = 24;

/**
 * Comeback/Blown Lead threshold: Number of holes a team must be down/up
 * on the back 9 to qualify for comeback win or blown lead badges
 */
export const COMEBACK_THRESHOLD = 3;
