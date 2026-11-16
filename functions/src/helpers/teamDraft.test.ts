/**
 * Unit tests for the captains' team-draft state machine (teamDraft.ts).
 * Pure logic — no Firestore. Covers tiering, snake order, the tier lock,
 * keepers (pre-placed captains), undo and the final rosters.
 */

import { describe, it, expect } from "vitest";
import {
  TeamDraftError,
  buildTiers,
  snakeTeam,
  initTeamDraft,
  applyTeamPick,
  applyTeamUndo,
  availablePlayerIds,
  pickBlockReason,
  rosterByTierFromDraft,
  tierCounts,
  type TeamDraftState,
} from "./teamDraft.js";

/** 16-player pool: p01 (best, 1.0) … p16 (worst, 16.0). */
function pool16(): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 1; i <= 16; i++) out[`p${String(i).padStart(2, "0")}`] = i;
  return out;
}

function fresh(first: "teamA" | "teamB" = "teamA"): TeamDraftState {
  // p05 (tier B) captains A, p16 (tier D) captains B — mirrors the 2026 Christmas field.
  return initTeamDraft({ handicapByPlayer: pool16(), keepers: { teamA: ["p05"], teamB: ["p16"] }, firstPickTeam: first });
}

describe("buildTiers", () => {
  it("ranks by handicap and cuts 4 equal tiers", () => {
    const { tierByPlayer, perTeamPerTier } = buildTiers(pool16());
    expect(perTeamPerTier).toBe(2);
    expect(tierByPlayer.p01).toBe("A");
    expect(tierByPlayer.p04).toBe("A");
    expect(tierByPlayer.p05).toBe("B");
    expect(tierByPlayer.p12).toBe("C");
    expect(tierByPlayer.p13).toBe("D");
  });

  it("breaks ties by id and puts missing handicaps last", () => {
    const pool: Record<string, number | null> = pool16();
    pool.p01 = null;
    pool.p09 = 8; // ties p08
    const { rankedIds } = buildTiers(pool);
    expect(rankedIds[rankedIds.length - 1]).toBe("p01");
    expect(rankedIds.indexOf("p08")).toBeLessThan(rankedIds.indexOf("p09"));
  });

  it("rejects a pool that isn't a multiple of 8", () => {
    const pool = pool16();
    delete pool.p16;
    expect(() => buildTiers(pool)).toThrow(TeamDraftError);
  });
});

describe("snakeTeam", () => {
  it("goes 1-2-2-1-1-2…", () => {
    const order = Array.from({ length: 6 }, (_, i) => snakeTeam("teamB", i));
    expect(order).toEqual(["teamB", "teamA", "teamA", "teamB", "teamB", "teamA"]);
  });
});

describe("initTeamDraft", () => {
  it("pre-places captains and opens with the first-pick team", () => {
    const s = fresh("teamB");
    expect(s.picks).toEqual([]);
    expect(s.turn).toEqual({ pickIndex: 0, team: "teamB" });
    expect(availablePlayerIds(s)).toHaveLength(14);
    expect(tierCounts(s, "teamA").B).toBe(1);
  });

  it("rejects a captain who isn't in the pool", () => {
    expect(() =>
      initTeamDraft({ handicapByPlayer: pool16(), keepers: { teamA: ["nope"], teamB: ["p16"] }, firstPickTeam: "teamA" })
    ).toThrow(/isn't in the draft pool/);
  });

  it("rejects mismatched keeper counts", () => {
    expect(() =>
      initTeamDraft({ handicapByPlayer: pool16(), keepers: { teamA: ["p05"], teamB: [] }, firstPickTeam: "teamA" })
    ).toThrow(/same number/);
  });
});

describe("applyTeamPick", () => {
  it("enforces turn order", () => {
    expect(() => applyTeamPick(fresh("teamA"), "teamB", "p01")).toThrow(/not this team's turn/);
  });

  it("rejects drafted players", () => {
    const s = applyTeamPick(fresh("teamA"), "teamA", "p01");
    expect(() => applyTeamPick(s, "teamB", "p01")).toThrow(/Already drafted/);
    expect(() => applyTeamPick(s, "teamB", "p05")).toThrow(/Already drafted/); // a keeper
  });

  it("auto-places the rest of a tier on the other team once one team fills it", () => {
    // Captain p05 (tier B) takes another B first → p07 and p08 go to team B free.
    let s = fresh("teamA");
    s = applyTeamPick(s, "teamA", "p06");
    expect(s.picks).toEqual([
      { team: "teamA", playerId: "p06" },
      { team: "teamB", playerId: "p07", auto: true },
      { team: "teamB", playerId: "p08", auto: true },
    ]);
    expect(tierCounts(s, "teamB").B).toBe(2);
    // Auto placements cost no pick: the snake carries on at pick 2 (team B).
    expect(s.turn).toEqual({ pickIndex: 1, team: "teamB" });
    expect(availablePlayerIds(s)).not.toContain("p07");
  });

  it("locks a filled tier for the team that filled it", () => {
    let s = fresh("teamA");
    s = applyTeamPick(s, "teamA", "p01");
    s = applyTeamPick(s, "teamB", "p09");
    s = applyTeamPick(s, "teamB", "p10"); // B fills tier C → p11, p12 auto to A
    expect(tierCounts(s, "teamA").C).toBe(2);
    expect(pickBlockReason(s, "teamA", "p02")).toBeNull();
    s = applyTeamPick(s, "teamA", "p02"); // A fills tier A → p03, p04 auto to B
    expect(tierCounts(s, "teamB").A).toBe(2);
    expect(pickBlockReason(s, "teamB", "p13")).toBeNull();
  });

  it("settles a tier the captains fill on their own at start", () => {
    // An 8-player pool takes 1 per team per tier, so each captain fills their tier immediately.
    const pool8: Record<string, number> = {};
    for (let i = 1; i <= 8; i++) pool8[`q${i}`] = i;
    const s = initTeamDraft({ handicapByPlayer: pool8, keepers: { teamA: ["q1"], teamB: ["q8"] }, firstPickTeam: "teamA" });
    // q1 fills A for team A → q2 to B; q8 fills D for team B → q7 to A.
    expect(s.picks).toEqual([
      { team: "teamB", playerId: "q2", auto: true },
      { team: "teamA", playerId: "q7", auto: true },
    ]);
    expect(s.turn).toEqual({ pickIndex: 0, team: "teamA" });
  });

  it("can always finish: greedy best-available fills every tier 2/2", () => {
    for (const first of ["teamA", "teamB"] as const) {
      let s = fresh(first);
      while (s.phase === "drafting") {
        const team = s.turn!.team;
        const pid = availablePlayerIds(s).find((id) => pickBlockReason(s, team, id) === null);
        expect(pid).toBeDefined();
        s = applyTeamPick(s, team, pid!);
      }
      expect(s.phase).toBe("review");
      expect(s.picks.filter((p) => !p.auto).length).toBeLessThanOrEqual(14);
      expect(s.turn).toBeNull();
      for (const team of ["teamA", "teamB"] as const) {
        expect(tierCounts(s, team)).toEqual({ A: 2, B: 2, C: 2, D: 2 });
      }
      expect(() => applyTeamPick(s, "teamA", "p01")).toThrow(/not accepting picks/);
    }
  });
});

describe("random drafts", () => {
  it("always offer a legal pick and finish 2/2 in every tier for both teams", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let run = 0; run < 200; run++) {
      let s = fresh(rand() < 0.5 ? "teamA" : "teamB");
      while (s.phase === "drafting") {
        const team = s.turn!.team;
        const legal = availablePlayerIds(s).filter((id) => pickBlockReason(s, team, id) === null);
        expect(legal.length).toBeGreaterThan(0);
        s = applyTeamPick(s, team, legal[Math.floor(rand() * legal.length)]);
      }
      expect(availablePlayerIds(s)).toEqual([]);
      for (const team of ["teamA", "teamB"] as const) {
        expect(tierCounts(s, team)).toEqual({ A: 2, B: 2, C: 2, D: 2 });
      }
    }
  });
});

describe("applyTeamUndo", () => {
  it("removes the auto placements a pick caused", () => {
    let s = fresh("teamA");
    s = applyTeamPick(s, "teamA", "p06"); // + p07, p08 auto to B
    const u = applyTeamUndo(s);
    expect(u.picks).toEqual([]);
    expect(u.turn).toEqual({ pickIndex: 0, team: "teamA" });
    expect(availablePlayerIds(u)).toEqual(expect.arrayContaining(["p06", "p07", "p08"]));
  });

  it("rewinds the last pick and its turn", () => {
    let s = fresh("teamA");
    s = applyTeamPick(s, "teamA", "p01");
    s = applyTeamPick(s, "teamB", "p02");
    const u = applyTeamUndo(s);
    expect(u.picks).toHaveLength(1);
    expect(u.turn).toEqual({ pickIndex: 1, team: "teamB" });
    expect(availablePlayerIds(u)).toContain("p02");
  });

  it("refuses with nothing to undo", () => {
    expect(() => applyTeamUndo(fresh())).toThrow(/no pick to undo/);
  });
});

describe("rosterByTierFromDraft", () => {
  it("files each player under their tier, keepers first", () => {
    let s = fresh("teamA");
    s = applyTeamPick(s, "teamA", "p08");
    expect(rosterByTierFromDraft(s, "teamA")).toEqual({ A: [], B: ["p05", "p08"], C: [], D: [] });
  });
});
