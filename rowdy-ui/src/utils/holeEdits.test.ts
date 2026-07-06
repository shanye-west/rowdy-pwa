import { describe, expect, it } from "vitest";
import {
  type HoleEdits,
  mergeHoleEdits,
  cellScoreEdit,
  driveEdit,
  buildHoleUpdate,
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
