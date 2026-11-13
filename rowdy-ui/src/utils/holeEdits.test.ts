import { describe, expect, it } from "vitest";
import {
  type HoleEdits,
  mergeHoleEdits,
  cellScoreEdit,
  driveEdit,
  buildHoleUpdate,
  applyHoleEdits,
  holeEditsApplied,
  NO_OPTIMISTIC_EDITS,
  addOptimisticEdit,
  dropOptimisticEdit,
  pruneOptimisticEdits,
} from "./holeEdits";

describe("cellScoreEdit", () => {
  it("singles → per-player leaf field", () => {
    expect(cellScoreEdit("singles", "A", 0, 4)).toEqual({ teamAPlayerGross: 4 });
    expect(cellScoreEdit("singles", "B", 0, null)).toEqual({ teamBPlayerGross: null });
  });

  it("scramble → team gross field", () => {
    expect(cellScoreEdit("twoManScramble", "A", 0, 5)).toEqual({ teamAGross: 5 });
    expect(cellScoreEdit("fourManScramble", "B", 0, 4)).toEqual({ teamBGross: 4 });
  });

  it("best ball / shamble → indexed player-score map", () => {
    expect(cellScoreEdit("twoManBestBall", "A", 1, 6)).toEqual({ teamAPlayersGross: { 1: 6 } });
    expect(cellScoreEdit("twoManShamble", "B", 0, 5)).toEqual({ teamBPlayersGross: { 0: 5 } });
  });
});

describe("driveEdit", () => {
  it("maps to the team's drive field", () => {
    expect(driveEdit("A", 1)).toEqual({ teamADrive: 1 });
    expect(driveEdit("B", null)).toEqual({ teamBDrive: null });
  });
});

describe("mergeHoleEdits", () => {
  it("later scalar edit wins", () => {
    expect(mergeHoleEdits({ teamAGross: 4 }, { teamAGross: 5 })).toEqual({ teamAGross: 5 });
  });

  it("keeps disjoint scalar fields from both", () => {
    expect(mergeHoleEdits({ teamAGross: 4 }, { teamBGross: 5 })).toEqual({
      teamAGross: 4,
      teamBGross: 5,
    });
  });

  it("merges player-score index maps by index (both players preserved)", () => {
    const a: HoleEdits = { teamAPlayersGross: { 0: 4 } };
    const b: HoleEdits = { teamAPlayersGross: { 1: 5 } };
    expect(mergeHoleEdits(a, b)).toEqual({ teamAPlayersGross: { 0: 4, 1: 5 } });
  });

  it("later index edit overrides the same index", () => {
    const a: HoleEdits = { teamAPlayersGross: { 0: 4 } };
    const b: HoleEdits = { teamAPlayersGross: { 0: 6 } };
    expect(mergeHoleEdits(a, b)).toEqual({ teamAPlayersGross: { 0: 6 } });
  });
});

describe("buildHoleUpdate", () => {
  it("singles → single leaf field path", () => {
    expect(buildHoleUpdate("5", { teamAPlayerGross: 4 }, {})).toEqual({
      "holes.5.input.teamAPlayerGross": 4,
    });
  });

  it("writes null when a score is cleared", () => {
    expect(buildHoleUpdate("7", { teamBPlayerGross: null }, { teamBPlayerGross: 5 })).toEqual({
      "holes.7.input.teamBPlayerGross": null,
    });
  });

  it("scramble drive → drive field only (never re-sends scores)", () => {
    expect(buildHoleUpdate("3", { teamADrive: 1 }, { teamAGross: 5, teamBGross: 4 })).toEqual({
      "holes.3.input.teamADrive": 1,
    });
  });

  it("best ball → composes the whole team array from snapshot + edit", () => {
    // Editing player 1 preserves player 0's existing score from the snapshot.
    expect(
      buildHoleUpdate("9", { teamAPlayersGross: { 1: 6 } }, { teamAPlayersGross: [4, null] })
    ).toEqual({ "holes.9.input.teamAPlayersGross": [4, 6] });
  });

  it("best ball → both players edited in one flush", () => {
    expect(
      buildHoleUpdate("2", { teamAPlayersGross: { 0: 4, 1: 5 } }, {})
    ).toEqual({ "holes.2.input.teamAPlayersGross": [4, 5] });
  });

  it("best ball → array grows to length 2 from empty snapshot", () => {
    expect(
      buildHoleUpdate("1", { teamBPlayersGross: { 1: 3 } }, undefined)
    ).toEqual({ "holes.1.input.teamBPlayersGross": [null, 3] });
  });

  it("only touches the changed team's array, not the opponent's", () => {
    const update = buildHoleUpdate(
      "4",
      { teamAPlayersGross: { 0: 4 } },
      { teamAPlayersGross: [null, null], teamBPlayersGross: [5, 5] }
    );
    expect(Object.keys(update)).toEqual(["holes.4.input.teamAPlayersGross"]);
  });

  it("returns an empty map for empty edits", () => {
    expect(buildHoleUpdate("1", {}, {})).toEqual({});
  });
});

describe("applyHoleEdits", () => {
  it("overlays scalar edits and leaves other fields alone", () => {
    const input = { teamAPlayerGross: 4, teamBPlayerGross: 5 };
    expect(applyHoleEdits(input, { teamAPlayerGross: 3 })).toEqual({
      teamAPlayerGross: 3,
      teamBPlayerGross: 5,
    });
    // the source input is never mutated
    expect(input.teamAPlayerGross).toBe(4);
  });

  it("overlays one player index and preserves the teammate's score", () => {
    const input = { teamAPlayersGross: [4, 6], teamBPlayersGross: [5, null] };
    expect(applyHoleEdits(input, { teamAPlayersGross: { 1: 5 } })).toEqual({
      teamAPlayersGross: [4, 5],
      teamBPlayersGross: [5, null],
    });
    expect(input.teamAPlayersGross).toEqual([4, 6]);
  });

  it("builds the score array when the hole has no input yet", () => {
    expect(applyHoleEdits(undefined, { teamBPlayersGross: { 0: 4 } })).toEqual({
      teamBPlayersGross: [4, null],
    });
  });

  it("applies a clear as null", () => {
    expect(applyHoleEdits({ teamAGross: 5, teamADrive: 1 }, { teamAGross: null })).toEqual({
      teamAGross: null,
      teamADrive: 1,
    });
  });
});

describe("holeEditsApplied", () => {
  it("is false until the snapshot carries the edited value", () => {
    const edits: HoleEdits = { teamAPlayerGross: 4 };
    expect(holeEditsApplied({}, edits)).toBe(false);
    expect(holeEditsApplied({ teamAPlayerGross: 5 }, edits)).toBe(false);
    expect(holeEditsApplied({ teamAPlayerGross: 4 }, edits)).toBe(true);
  });

  it("requires every edited index to match", () => {
    const edits: HoleEdits = { teamAPlayersGross: { 0: 4, 1: 5 } };
    expect(holeEditsApplied({ teamAPlayersGross: [4, null] }, edits)).toBe(false);
    expect(holeEditsApplied({ teamAPlayersGross: [4, 5] }, edits)).toBe(true);
  });

  it("ignores fields the edit does not touch", () => {
    expect(
      holeEditsApplied({ teamAPlayersGross: [4, 9], teamBPlayersGross: [3, 3] }, { teamAPlayersGross: { 0: 4 } })
    ).toBe(true);
  });

  it("treats a cleared score and a never-set field as the same", () => {
    expect(holeEditsApplied(undefined, { teamAGross: null })).toBe(true);
    expect(holeEditsApplied({}, { teamBPlayersGross: { 1: null } })).toBe(true);
    expect(holeEditsApplied({ teamAGross: 4 }, { teamAGross: null })).toBe(false);
  });

  it("an empty edit set is always applied", () => {
    expect(holeEditsApplied({ teamAGross: 4 }, {})).toBe(true);
  });

  it("round-trips with applyHoleEdits", () => {
    const edits: HoleEdits = { teamBPlayersGross: { 1: 6 }, teamADrive: 0 };
    const input = { teamBPlayersGross: [4, null] };
    expect(holeEditsApplied(input, edits)).toBe(false);
    expect(holeEditsApplied(applyHoleEdits(input, edits), edits)).toBe(true);
  });
});

describe("optimistic edits (scorecard taps awaiting their snapshot)", () => {
  const holes = (input: Record<string, unknown>) => ({ "5": { input } });

  it("holds a tap until the snapshot carries it, then drops it", () => {
    const tapped = addOptimisticEdit(NO_OPTIMISTIC_EDITS, "m1", "5", { teamAPlayerGross: 4 });
    expect(tapped.edits["5"]).toEqual({ teamAPlayerGross: 4 });

    // Snapshot still shows the old value (write is inside its debounce window).
    expect(pruneOptimisticEdits(tapped, "m1", holes({}))).toBe(tapped);
    // The write echoes back.
    expect(pruneOptimisticEdits(tapped, "m1", holes({ teamAPlayerGross: 4 }))).toBe(NO_OPTIMISTIC_EDITS);
  });

  it("a correction made while the first write is in flight survives that write's echo", () => {
    let state = addOptimisticEdit(NO_OPTIMISTIC_EDITS, "m1", "5", { teamAPlayerGross: 4 });
    state = addOptimisticEdit(state, "m1", "5", { teamAPlayerGross: 5 });
    // Echo of the FIRST write (4) must not clear the newer tap (5).
    const afterFirstEcho = pruneOptimisticEdits(state, "m1", holes({ teamAPlayerGross: 4 }));
    expect(afterFirstEcho.edits["5"]).toEqual({ teamAPlayerGross: 5 });
    expect(pruneOptimisticEdits(afterFirstEcho, "m1", holes({ teamAPlayerGross: 5 }))).toBe(NO_OPTIMISTIC_EDITS);
  });

  it("merges taps on both players of a team for the same hole", () => {
    let state = addOptimisticEdit(NO_OPTIMISTIC_EDITS, "m1", "5", { teamAPlayersGross: { 0: 4 } });
    state = addOptimisticEdit(state, "m1", "5", { teamAPlayersGross: { 1: 5 } });
    expect(state.edits["5"]).toEqual({ teamAPlayersGross: { 0: 4, 1: 5 } });
    // Held until BOTH are in the snapshot.
    expect(pruneOptimisticEdits(state, "m1", holes({ teamAPlayersGross: [4, null] }))).toBe(state);
    expect(pruneOptimisticEdits(state, "m1", holes({ teamAPlayersGross: [4, 5] }))).toBe(NO_OPTIMISTIC_EDITS);
  });

  it("once dropped, a later change by another scorer is not masked", () => {
    const tapped = addOptimisticEdit(NO_OPTIMISTIC_EDITS, "m1", "5", { teamAGross: 4 });
    const saved = pruneOptimisticEdits(tapped, "m1", holes({ teamAGross: 4 }));
    // Teammate changes the cell to 5: nothing optimistic is left to override it.
    expect(pruneOptimisticEdits(saved, "m1", holes({ teamAGross: 5 }))).toBe(NO_OPTIMISTIC_EDITS);
    expect(applyHoleEdits({ teamAGross: 5 }, saved.edits["5"] ?? {})).toEqual({ teamAGross: 5 });
  });

  it("only drops the holes that have landed", () => {
    let state = addOptimisticEdit(NO_OPTIMISTIC_EDITS, "m1", "5", { teamAGross: 4 });
    state = addOptimisticEdit(state, "m1", "6", { teamAGross: 3 });
    const next = pruneOptimisticEdits(state, "m1", { "5": { input: { teamAGross: 4 } }, "6": { input: {} } });
    expect(Object.keys(next.edits)).toEqual(["6"]);
  });

  it("never carries edits across matches", () => {
    const m1 = addOptimisticEdit(NO_OPTIMISTIC_EDITS, "m1", "5", { teamAGross: 4 });
    expect(pruneOptimisticEdits(m1, "m2", holes({}))).toBe(NO_OPTIMISTIC_EDITS);
    const m2 = addOptimisticEdit(m1, "m2", "7", { teamAGross: 3 });
    expect(m2).toEqual({ matchId: "m2", edits: { "7": { teamAGross: 3 } } });
  });

  it("dropOptimisticEdit forgets one hole and is a no-op for an unknown hole", () => {
    let state = addOptimisticEdit(NO_OPTIMISTIC_EDITS, "m1", "5", { teamAGross: 4 });
    expect(dropOptimisticEdit(state, "9")).toBe(state);
    state = addOptimisticEdit(state, "m1", "6", { teamAGross: 3 });
    expect(Object.keys(dropOptimisticEdit(state, "5").edits)).toEqual(["6"]);
    expect(dropOptimisticEdit(dropOptimisticEdit(state, "5"), "6")).toBe(NO_OPTIMISTIC_EDITS);
  });
});
