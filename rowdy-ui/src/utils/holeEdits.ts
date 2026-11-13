import type { RoundFormat, HoleInputLoose } from "../types";

/**
 * A sparse set of cell edits for a single hole. Only the fields that were
 * actually changed are present. This is the payload the debounced-save engine
 * accumulates (merging repeated edits to the same hole) and then composes into
 * a Firestore field-path update at flush time.
 *
 * Writing per-field (leaf) paths instead of the whole `holes.{k}.input` object
 * is what prevents one scorer's phone from clobbering another team's scores on
 * the same hole: two devices editing the same hole now touch disjoint field
 * paths and Firestore merges them. (Same-team, same-hole concurrent edits to the
 * shared player-score array remain last-write-wins — acceptable in practice
 * since one person scores per team.)
 */
export interface HoleEdits {
  // singles: one gross per player
  teamAPlayerGross?: number | null;
  teamBPlayerGross?: number | null;
  // scramble: one gross per team
  teamAGross?: number | null;
  teamBGross?: number | null;
  // scramble / shamble: which player's drive was used
  teamADrive?: number | null;
  teamBDrive?: number | null;
  // best ball / shamble: sparse per-player-index gross scores (keyed by array index)
  teamAPlayersGross?: Record<number, number | null>;
  teamBPlayersGross?: Record<number, number | null>;
}

/**
 * Merge two edit sets. Scalar fields are last-write-wins (`next` overrides);
 * the per-index player-score maps are merged by index so rapid edits to both
 * players of a team within one debounce window are preserved.
 */
export function mergeHoleEdits(prev: HoleEdits, next: HoleEdits): HoleEdits {
  const out: HoleEdits = { ...prev, ...next };
  if (prev.teamAPlayersGross || next.teamAPlayersGross) {
    out.teamAPlayersGross = { ...prev.teamAPlayersGross, ...next.teamAPlayersGross };
  }
  if (prev.teamBPlayersGross || next.teamBPlayersGross) {
    out.teamBPlayersGross = { ...prev.teamBPlayersGross, ...next.teamBPlayersGross };
  }
  return out;
}

/** Build the edit set for a single score-cell change, given the round format. */
export function cellScoreEdit(
  format: RoundFormat,
  team: "A" | "B",
  pIdx: number,
  value: number | null
): HoleEdits {
  if (format === "singles") {
    return team === "A" ? { teamAPlayerGross: value } : { teamBPlayerGross: value };
  }
  if (format === "twoManScramble" || format === "fourManScramble") {
    return team === "A" ? { teamAGross: value } : { teamBGross: value };
  }
  // twoManBestBall, twoManShamble: individual player scores by index
  return team === "A"
    ? { teamAPlayersGross: { [pIdx]: value } }
    : { teamBPlayersGross: { [pIdx]: value } };
}

/** Build the edit set for a single drive-selection change. */
export function driveEdit(team: "A" | "B", value: number | null): HoleEdits {
  return team === "A" ? { teamADrive: value } : { teamBDrive: value };
}

/** Overlay per-index edits onto the current player-score array (min length 2). */
function composeArray(
  current: unknown,
  idxEdits: Record<number, number | null>
): (number | null)[] {
  const arr: (number | null)[] = Array.isArray(current) ? [...current] : [];
  while (arr.length < 2) arr.push(null);
  for (const [k, v] of Object.entries(idxEdits)) {
    arr[Number(k)] = v;
  }
  return arr;
}

const SCALAR_EDIT_KEYS = [
  "teamAPlayerGross",
  "teamBPlayerGross",
  "teamAGross",
  "teamBGross",
  "teamADrive",
  "teamBDrive",
] as const;

/**
 * Overlay a sparse edit set on a hole's input and return the resulting input.
 * Used for optimistic display: a tapped score paints from this immediately,
 * before the (debounced) write has reached Firestore and echoed back. Never
 * mutates `input`.
 */
export function applyHoleEdits(
  input: HoleInputLoose | undefined,
  edits: HoleEdits
): HoleInputLoose {
  const out: HoleInputLoose = { ...input };
  for (const key of SCALAR_EDIT_KEYS) {
    const value = edits[key];
    if (value !== undefined) out[key] = value;
  }
  if (edits.teamAPlayersGross) {
    out.teamAPlayersGross = composeArray(input?.teamAPlayersGross, edits.teamAPlayersGross);
  }
  if (edits.teamBPlayersGross) {
    out.teamBPlayersGross = composeArray(input?.teamBPlayersGross, edits.teamBPlayersGross);
  }
  return out;
}

/**
 * True once `input` already reflects every edit — i.e. the snapshot has caught
 * up and the optimistic copy can be dropped. A cleared score compares equal to
 * a field that was never set (both mean "no score").
 */
export function holeEditsApplied(
  input: HoleInputLoose | undefined,
  edits: HoleEdits
): boolean {
  for (const key of SCALAR_EDIT_KEYS) {
    const value = edits[key];
    if (value !== undefined && (input?.[key] ?? null) !== (value ?? null)) return false;
  }
  const arraysMatch = (
    current: (number | null)[] | undefined,
    idxEdits: Record<number, number | null> | undefined
  ) =>
    !idxEdits ||
    Object.entries(idxEdits).every(([k, v]) => (current?.[Number(k)] ?? null) === (v ?? null));
  return (
    arraysMatch(input?.teamAPlayersGross, edits.teamAPlayersGross) &&
    arraysMatch(input?.teamBPlayersGross, edits.teamBPlayersGross)
  );
}

/**
 * Optimistic score-entry state for one scorecard: the taps that have been
 * painted but not yet seen in a snapshot, keyed by hole, tagged with the match
 * they belong to (so navigating to another match can never show the previous
 * card's edits).
 */
export interface OptimisticEdits {
  matchId: string | null;
  edits: Record<string, HoleEdits>;
}

/** Shared empty state — a stable identity for "nothing pending". */
export const NO_OPTIMISTIC_EDITS: OptimisticEdits = Object.freeze({
  matchId: null,
  edits: Object.freeze({}) as Record<string, HoleEdits>,
});

/** Record a tap. Edits to the same hole merge; another match's edits are discarded. */
export function addOptimisticEdit(
  state: OptimisticEdits,
  matchId: string,
  holeKey: string,
  edits: HoleEdits
): OptimisticEdits {
  const base = state.matchId === matchId ? state.edits : {};
  const existing = base[holeKey];
  return {
    matchId,
    edits: { ...base, [holeKey]: existing ? mergeHoleEdits(existing, edits) : edits },
  };
}

/** Forget one hole's pending edits (the write behind them was abandoned). */
export function dropOptimisticEdit(state: OptimisticEdits, holeKey: string): OptimisticEdits {
  if (!(holeKey in state.edits)) return state;
  const edits = { ...state.edits };
  delete edits[holeKey];
  return Object.keys(edits).length > 0 ? { matchId: state.matchId, edits } : NO_OPTIMISTIC_EDITS;
}

/**
 * Drop every hole whose edits the snapshot now carries. They must be REMOVED at
 * that point, not merely ignored: a copy left behind would later mask another
 * scorer's change to the same cell. Returns the same object when nothing was
 * dropped, so callers can use it directly in a state setter.
 */
export function pruneOptimisticEdits(
  state: OptimisticEdits,
  matchId: string | null,
  savedHoles: Record<string, { input?: HoleInputLoose } | undefined> | undefined
): OptimisticEdits {
  if (state === NO_OPTIMISTIC_EDITS) return state;
  if (state.matchId !== matchId) return NO_OPTIMISTIC_EDITS;
  const remaining: Record<string, HoleEdits> = {};
  let dropped = false;
  for (const [k, edits] of Object.entries(state.edits)) {
    if (holeEditsApplied(savedHoles?.[k]?.input, edits)) dropped = true;
    else remaining[k] = edits;
  }
  if (!dropped) return state;
  return Object.keys(remaining).length > 0 ? { matchId: state.matchId, edits: remaining } : NO_OPTIMISTIC_EDITS;
}

/**
 * Compose accumulated edits + the CURRENT hole input (latest snapshot) into a
 * Firestore field-path update map rooted at the match document. Leaf writes
 * (e.g. `holes.5.input.teamAPlayerGross`) create any missing intermediate maps.
 * For the per-team score arrays we must send the whole array, so we overlay the
 * edited indices on top of the latest snapshot values to preserve the teammate's
 * score.
 */
export function buildHoleUpdate(
  holeKey: string,
  edits: HoleEdits,
  currentInput: HoleInputLoose | undefined
): Record<string, unknown> {
  const p = `holes.${holeKey}.input.`;
  const out: Record<string, unknown> = {};
  if (edits.teamAPlayerGross !== undefined) out[p + "teamAPlayerGross"] = edits.teamAPlayerGross;
  if (edits.teamBPlayerGross !== undefined) out[p + "teamBPlayerGross"] = edits.teamBPlayerGross;
  if (edits.teamAGross !== undefined) out[p + "teamAGross"] = edits.teamAGross;
  if (edits.teamBGross !== undefined) out[p + "teamBGross"] = edits.teamBGross;
  if (edits.teamADrive !== undefined) out[p + "teamADrive"] = edits.teamADrive;
  if (edits.teamBDrive !== undefined) out[p + "teamBDrive"] = edits.teamBDrive;
  if (edits.teamAPlayersGross) {
    out[p + "teamAPlayersGross"] = composeArray(currentInput?.teamAPlayersGross, edits.teamAPlayersGross);
  }
  if (edits.teamBPlayersGross) {
    out[p + "teamBPlayersGross"] = composeArray(currentInput?.teamBPlayersGross, edits.teamBPlayersGross);
  }
  return out;
}
