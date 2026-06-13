/**
 * Unit tests for the pairings snake-draft state machine (pairingDraft.ts).
 * Pure logic — no Firestore. Covers snake turn order, pick validation
 * (turn/count/availability), the A/A & D/D tier rule, and undo.
 */

import { describe, it, expect } from "vitest";
import {
  DraftError,
  draftPlayersPerSide,
  nominatingTeam,
  respondingTeam,
  buildInitialMatches,
  initialTurn,
  applyPick,
  applyUndo,
  lastPlacement,
  remainingIds,
  isPairableRemainder,
  type DraftState,
  type DraftTeam,
} from "./pairingDraft.js";

/** Build a fresh drafting state. */
function makeState(opts: {
  playersPerSide: number;
  firstPickTeam?: DraftTeam;
  teamA: string[];
  teamB: string[];
  tierByPlayer?: Record<string, string>;
}): DraftState {
  const firstPickTeam = opts.firstPickTeam ?? "teamA";
  const totalMatches = opts.teamA.length / opts.playersPerSide;
  return {
    playersPerSide: opts.playersPerSide,
    totalMatches,
    firstPickTeam,
    available: { teamA: opts.teamA, teamB: opts.teamB },
    tierByPlayer: opts.tierByPlayer ?? {},
    matches: buildInitialMatches(totalMatches, firstPickTeam),
    turn: initialTurn(firstPickTeam),
    phase: "drafting",
  };
}

const tiers = {
  a1: "A", a2: "B", a3: "C", a4: "D",
  b1: "A", b2: "B", b3: "C", b4: "D",
};

describe("draftPlayersPerSide", () => {
  it("is 1 for singles, 2 for two-man, 4 for four-man", () => {
    expect(draftPlayersPerSide("singles")).toBe(1);
    expect(draftPlayersPerSide("twoManBestBall")).toBe(2);
    expect(draftPlayersPerSide("twoManShamble")).toBe(2);
    expect(draftPlayersPerSide("twoManScramble")).toBe(2);
    expect(draftPlayersPerSide("fourManScramble")).toBe(4);
  });
});

describe("snake turn order", () => {
  it("alternates the nominating team each match", () => {
    expect(nominatingTeam("teamA", 0)).toBe("teamA");
    expect(nominatingTeam("teamA", 1)).toBe("teamB");
    expect(nominatingTeam("teamA", 2)).toBe("teamA");
    expect(respondingTeam("teamA", 0)).toBe("teamB");
    expect(respondingTeam("teamA", 1)).toBe("teamA");
  });

  it("respects firstPickTeam = teamB", () => {
    expect(nominatingTeam("teamB", 0)).toBe("teamB");
    expect(nominatingTeam("teamB", 1)).toBe("teamA");
  });

  it("produces the classic T1,T2,T2,T1,T1,T2 actor sequence", () => {
    // Singles draft of 3 matches: easy to read the actor of each action.
    let state = makeState({ playersPerSide: 1, teamA: ["a1", "a2", "a3"], teamB: ["b1", "b2", "b3"] });
    const actors: DraftTeam[] = [];
    const picksA = ["a1", "a2", "a3"];
    const picksB = ["b1", "b2", "b3"];
    let ai = 0;
    let bi = 0;
    while (state.turn) {
      const team = state.turn.team;
      actors.push(team);
      const pick = team === "teamA" ? picksA[ai++] : picksB[bi++];
      state = applyPick(state, team, [pick]);
    }
    expect(actors).toEqual(["teamA", "teamB", "teamB", "teamA", "teamA", "teamB"]);
    expect(state.phase).toBe("review");
  });
});

describe("applyPick — happy path (2v2)", () => {
  it("fills both sides of a match then advances, reaching review at the end", () => {
    let state = makeState({
      playersPerSide: 2,
      teamA: ["a1", "a2", "a3", "a4"],
      teamB: ["b1", "b2", "b3", "b4"],
      tierByPlayer: tiers,
    });

    // Match 1: teamA nominates, teamB responds.
    state = applyPick(state, "teamA", ["a1", "a2"]); // A,B
    expect(state.matches[0].teamAPlayers).toEqual(["a1", "a2"]);
    expect(state.turn).toEqual({ matchIndex: 0, awaiting: "response", team: "teamB" });

    state = applyPick(state, "teamB", ["b1", "b2"]); // A,B
    expect(state.matches[0].teamBPlayers).toEqual(["b1", "b2"]);
    // Match complete → teamB nominates match 2 (snake).
    expect(state.turn).toEqual({ matchIndex: 1, awaiting: "nomination", team: "teamB" });

    state = applyPick(state, "teamB", ["b3", "b4"]); // C,D
    state = applyPick(state, "teamA", ["a3", "a4"]); // C,D
    expect(state.phase).toBe("review");
    expect(state.turn).toBeNull();
    expect(remainingIds(state, "teamA")).toEqual([]);
    expect(remainingIds(state, "teamB")).toEqual([]);
  });
});

describe("applyPick — rejections", () => {
  const base = () =>
    makeState({
      playersPerSide: 2,
      teamA: ["a1", "a2", "a3", "a4"],
      teamB: ["b1", "b2", "b3", "b4"],
      tierByPlayer: tiers,
    });

  it("rejects the wrong team acting", () => {
    expect(() => applyPick(base(), "teamB", ["b1", "b2"])).toThrow(DraftError);
  });

  it("rejects the wrong number of players", () => {
    expect(() => applyPick(base(), "teamA", ["a1"])).toThrow(/exactly 2/);
  });

  it("rejects duplicate players in one pick", () => {
    expect(() => applyPick(base(), "teamA", ["a1", "a1"])).toThrow(/twice/);
  });

  it("rejects a player not on the team's available list", () => {
    expect(() => applyPick(base(), "teamA", ["a1", "z9"])).toThrow(/not available/);
  });

  it("rejects reusing an already-placed player", () => {
    let state = base();
    state = applyPick(state, "teamA", ["a1", "a2"]); // place a1,a2
    state = applyPick(state, "teamB", ["b1", "b2"]); // now teamB nominates match 2
    expect(() => applyPick(state, "teamB", ["b1", "b3"])).toThrow(/already been placed/);
  });

  it("rejects two A-tier players on one side", () => {
    const state = makeState({
      playersPerSide: 2,
      teamA: ["a1", "a2", "a3", "a4"],
      teamB: ["b1", "b2", "b3", "b4"],
      tierByPlayer: { ...tiers, a2: "A" }, // a1 & a2 both A
    });
    expect(() => applyPick(state, "teamA", ["a1", "a2"])).toThrow(/two A-tier/);
  });

  it("rejects two D-tier players on one side", () => {
    const state = makeState({
      playersPerSide: 2,
      teamA: ["a1", "a2", "a3", "a4"],
      teamB: ["b1", "b2", "b3", "b4"],
      tierByPlayer: { ...tiers, a1: "D" }, // a1 & a4 both D
    });
    expect(() => applyPick(state, "teamA", ["a1", "a4"])).toThrow(/two D-tier/);
  });

  it("allows mixed tiers like A/C and B/D", () => {
    const state = base();
    expect(() => applyPick(state, "teamA", ["a1", "a3"])).not.toThrow(); // A,C
  });

  it("does not apply the tier rule to singles (1 per side)", () => {
    const state = makeState({
      playersPerSide: 1,
      teamA: ["a1", "a2"],
      teamB: ["b1", "b2"],
      tierByPlayer: { a1: "A", a2: "A", b1: "A", b2: "A" },
    });
    expect(() => applyPick(state, "teamA", ["a1"])).not.toThrow();
  });
});

describe("isPairableRemainder", () => {
  const t = { p1: "A", p2: "A", p3: "D", p4: "D", p5: "B", p6: "C" };

  it("is true when #A and #D each fit within the remaining pairs", () => {
    expect(isPairableRemainder(["p1", "p2", "p3", "p4"], 2, t)).toBe(true); // A-D, A-D
    expect(isPairableRemainder(["p1", "p3"], 1, t)).toBe(true); // A-D
    expect(isPairableRemainder(["p5", "p6"], 1, t)).toBe(true); // B-C
    expect(isPairableRemainder([], 0, t)).toBe(true);
  });

  it("is false when a tier needs more than one slot per remaining pair", () => {
    expect(isPairableRemainder(["p1", "p2"], 1, t)).toBe(false); // two A in one pair
    expect(isPairableRemainder(["p3", "p4"], 1, t)).toBe(false); // two D in one pair
    // three A-tier across two pairs: one pair is forced to be A/A
    expect(isPairableRemainder(["p1", "p2", "pX", "p5"], 2, { ...t, pX: "A" })).toBe(false);
  });
});

describe("applyPick — tier feasibility look-ahead (no stranding)", () => {
  // teamA: two A-tier and two neutrals across 2 matches. Pairing the neutrals
  // together is legal on its own but strands the two A's for the final match.
  const tiers2 = {
    a1: "B", a2: "C", a3: "A", a4: "A",
    b1: "B", b2: "C", b3: "A", b4: "A",
  };
  const base = () =>
    makeState({
      playersPerSide: 2,
      teamA: ["a1", "a2", "a3", "a4"],
      teamB: ["b1", "b2", "b3", "b4"],
      tierByPlayer: tiers2,
    });

  it("rejects a legal pair that would strand two A-tier players for the last match", () => {
    expect(() => applyPick(base(), "teamA", ["a1", "a2"])).toThrow(/strand/);
  });

  it("allows a pair that keeps the remainder pairable", () => {
    // A+B now leaves A+C for the last match — fine.
    expect(() => applyPick(base(), "teamA", ["a3", "a1"])).not.toThrow();
  });

  it("does not strand-check singles or four-man (no tier rule)", () => {
    const singles = makeState({
      playersPerSide: 1,
      teamA: ["a3", "a4"],
      teamB: ["b3", "b4"],
      tierByPlayer: tiers2, // both A — would be illegal as a pair, but irrelevant here
    });
    expect(() => applyPick(singles, "teamA", ["a3"])).not.toThrow();
  });
});

describe("undo", () => {
  it("returns null lastPlacement at the very start (nothing to undo)", () => {
    const state = makeState({ playersPerSide: 1, teamA: ["a1"], teamB: ["b1"] });
    expect(lastPlacement(state)).toBeNull();
    expect(() => applyUndo(state)).toThrow(/no pick to undo/);
  });

  it("rewinds a nomination, freeing the player and restoring the turn", () => {
    let state = makeState({
      playersPerSide: 2,
      teamA: ["a1", "a2", "a3", "a4"],
      teamB: ["b1", "b2", "b3", "b4"],
      tierByPlayer: tiers,
    });
    state = applyPick(state, "teamA", ["a1", "a2"]);
    expect(lastPlacement(state)?.team).toBe("teamA");
    state = applyUndo(state);
    expect(state.matches[0].teamAPlayers).toBeNull();
    expect(state.turn).toEqual({ matchIndex: 0, awaiting: "nomination", team: "teamA" });
    expect(remainingIds(state, "teamA")).toContain("a1");
  });

  it("rewinds the final response from review back to drafting", () => {
    let state = makeState({ playersPerSide: 1, teamA: ["a1"], teamB: ["b1"] });
    state = applyPick(state, "teamA", ["a1"]);
    state = applyPick(state, "teamB", ["b1"]);
    expect(state.phase).toBe("review");
    expect(lastPlacement(state)?.team).toBe("teamB");
    state = applyUndo(state);
    expect(state.phase).toBe("drafting");
    expect(state.matches[0].teamBPlayers).toBeNull();
    expect(state.turn).toEqual({ matchIndex: 0, awaiting: "response", team: "teamB" });
  });
});
