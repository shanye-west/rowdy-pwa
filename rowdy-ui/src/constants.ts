/**
 * Shared constants for the Rowdy Cup PWA
 */

// =============================================================================
// SCORECARD LAYOUT
// =============================================================================

/** Width of score input cells in pixels */
export const SCORECARD_CELL_WIDTH = 44;

/** Width of player label column in pixels */
export const SCORECARD_LABEL_WIDTH = 120;

/** Width of OUT/IN/TOT summary columns in pixels */
export const SCORECARD_TOTAL_COL_WIDTH = 48;

// =============================================================================
// GOLF SCORING
// =============================================================================

/** Default course par when not specified */
export const DEFAULT_COURSE_PAR = 72;

/** Minimum drives required per player in scramble/shamble per 9 holes */
export const MIN_DRIVES_PER_NINE = 3;

/** Total drives required per player per round (6 = 3 per 9) */
export const MIN_DRIVES_PER_ROUND = 6;

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

// =============================================================================
// FIRESTORE LIMITS
// =============================================================================

/** Maximum IDs allowed in a Firestore 'in' query */
export const FIRESTORE_IN_QUERY_LIMIT = 30;
