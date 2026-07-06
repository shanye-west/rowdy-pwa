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
