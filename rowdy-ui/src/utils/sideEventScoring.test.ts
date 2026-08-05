import { describe, it, expect } from "vitest";
import {
  holeNumbersForNine,
  rankSideEventTeams,
  assignSideEventPayouts,
  formatPlace,
  formatToPar,
  formatMoney,
} from "./sideEventScoring";
import type { SideEventPayout, SideEventTeamDoc } from "../types";

/** Par 4 on every hole of both nines, so a par round is 36. */
const PARS: Record<number, number> = Object.fromEntries(
  Array.from({ length: 18 }, (_, i) => [i + 1, 4])
);

function team(
  id: string,
  teamNumber: number,
  scores: Partial<Record<number, number>>
): SideEventTeamDoc {
  const holes: Record<string, { gross: number }> = {};
  for (const [hole, gross] of Object.entries(scores)) {
    if (typeof gross === "number") holes[hole] = { gross };
  }
  return { id, sideEventId: "se1", teamNumber, playerIds: [], holes };
}

/** Nine identical scores across the given nine. */
function evenNine(value: number, nine: "front" | "back" = "front") {
  const out: Record<number, number> = {};
  for (const h of holeNumbersForNine(nine)) out[h] = value;
  return out;
}

describe("holeNumbersForNine", () => {
  it("maps front to 1-9 and back to 10-18", () => {
    expect(holeNumbersForNine("front")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(holeNumbersForNine("back")).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });
});

describe("rankSideEventTeams", () => {
  it("totals only holes in the event's nine", () => {
    // Scores on the front nine must be ignored by a back-nine event.
    const t = team("a", 1, { ...evenNine(5, "front"), 10: 3, 11: 3 });
    const [ranked] = rankSideEventTeams([t], PARS, "back");
    expect(ranked.total).toBe(6);
    expect(ranked.thru).toBe(2);
    expect(ranked.toPar).toBe(-2);
  });

  it("ranks completed rounds by total", () => {
    const teams = [
      team("a", 1, evenNine(4)), // 36, E
      team("b", 2, evenNine(3)), // 27, -9
      team("c", 3, evenNine(5)), // 45, +9
    ];
    const ranked = rankSideEventTeams(teams, PARS, "front");
    expect(ranked.map((t) => t.teamId)).toEqual(["b", "a", "c"]);
    expect(ranked.map((t) => t.rank)).toEqual([1, 2, 3]);
    expect(ranked.map((t) => t.total)).toEqual([27, 36, 45]);
  });

  it("ranks by to-par so a partial round does not leapfrog a finished one", () => {
    const finished = team("done", 1, evenNine(4)); // 36 total, E thru 9
    const partial = team("part", 2, { 1: 5, 2: 5 }); // 10 total, +2 thru 2
    const ranked = rankSideEventTeams([partial, finished], PARS, "front");
    expect(ranked.map((t) => t.teamId)).toEqual(["done", "part"]);
  });

  it("gives tied teams the same rank and skips the next (1,1,3)", () => {
    const teams = [
      team("a", 1, evenNine(4)),
      team("b", 2, evenNine(4)),
      team("c", 3, evenNine(5)),
    ];
    const ranked = rankSideEventTeams(teams, PARS, "front");
    expect(ranked.map((t) => t.rank)).toEqual([1, 1, 3]);
    expect(ranked.map((t) => t.tied)).toEqual([true, true, false]);
  });

  it("sorts teams with nothing entered to the bottom", () => {
    const teams = [team("empty", 1, {}), team("scored", 2, { 1: 4 })];
    const ranked = rankSideEventTeams(teams, PARS, "front");
    expect(ranked.map((t) => t.teamId)).toEqual(["scored", "empty"]);
    expect(ranked[1].thru).toBe(0);
    expect(ranked[1].toPar).toBeNull();
  });

  it("ignores implausible gross scores rather than counting them", () => {
    const t = team("a", 1, { 1: 4, 2: 0, 3: 99 });
    const [ranked] = rankSideEventTeams([t], PARS, "front");
    expect(ranked.total).toBe(4);
    expect(ranked.thru).toBe(1);
  });

  it("falls back to raw total when the event has no course pars", () => {
    const teams = [team("a", 1, evenNine(4)), team("b", 2, evenNine(3))];
    const ranked = rankSideEventTeams(teams, {}, "front");
    expect(ranked.map((t) => t.teamId)).toEqual(["b", "a"]);
    expect(ranked[0].toPar).toBeNull();
  });
});

describe("assignSideEventPayouts", () => {
  const payouts: SideEventPayout[] = [
    { place: 1, amount: 150 },
    { place: 2, amount: 100 },
    { place: 3, amount: 50 },
  ];

  it("pays the top places in order", () => {
    const ranked = rankSideEventTeams(
      [
        team("a", 1, evenNine(3)),
        team("b", 2, evenNine(4)),
        team("c", 3, evenNine(5)),
        team("d", 4, evenNine(6)),
      ],
      PARS,
      "front"
    );
    const paid = assignSideEventPayouts(ranked, payouts);
    expect(paid.a).toEqual({ amount: 150, shared: false });
    expect(paid.b).toEqual({ amount: 100, shared: false });
    expect(paid.c).toEqual({ amount: 50, shared: false });
    expect(paid.d).toBeUndefined();
  });

  it("splits the pooled places evenly on a tie", () => {
    // a and b tie for 1st: they pool 1st + 2nd ($250) and take $125 each.
    const ranked = rankSideEventTeams(
      [team("a", 1, evenNine(3)), team("b", 2, evenNine(3)), team("c", 3, evenNine(5))],
      PARS,
      "front"
    );
    const paid = assignSideEventPayouts(ranked, payouts);
    expect(paid.a).toEqual({ amount: 125, shared: true });
    expect(paid.b).toEqual({ amount: 125, shared: true });
    // c is 3rd on the card and still collects 3rd money.
    expect(paid.c).toEqual({ amount: 50, shared: false });
  });

  it("pays nothing when no payouts are configured", () => {
    const ranked = rankSideEventTeams([team("a", 1, evenNine(3))], PARS, "front");
    expect(assignSideEventPayouts(ranked, [])).toEqual({});
    expect(assignSideEventPayouts(ranked, undefined)).toEqual({});
  });

  it("never pays a team with no score entered", () => {
    const ranked = rankSideEventTeams([team("a", 1, {})], PARS, "front");
    expect(assignSideEventPayouts(ranked, payouts)).toEqual({});
  });

  it("handles a tie that runs past the last paid place", () => {
    // Three-way tie for 3rd: only 3rd place money exists, split three ways.
    const ranked = rankSideEventTeams(
      [
        team("a", 1, evenNine(3)),
        team("b", 2, evenNine(4)),
        team("c", 3, evenNine(5)),
        team("d", 4, evenNine(5)),
        team("e", 5, evenNine(5)),
      ],
      PARS,
      "front"
    );
    const paid = assignSideEventPayouts(ranked, payouts);
    expect(paid.c.amount).toBeCloseTo(50 / 3);
    expect(paid.c.shared).toBe(true);
    expect(paid.d.amount).toBeCloseTo(50 / 3);
    expect(paid.e.amount).toBeCloseTo(50 / 3);
  });
});

describe("formatters", () => {
  it("formats places with ordinals and ties", () => {
    expect(formatPlace(1, false)).toBe("1st");
    expect(formatPlace(2, false)).toBe("2nd");
    expect(formatPlace(3, false)).toBe("3rd");
    expect(formatPlace(4, false)).toBe("4th");
    expect(formatPlace(11, false)).toBe("11th");
    expect(formatPlace(2, true)).toBe("T2");
  });

  it("formats to-par", () => {
    expect(formatToPar(0)).toBe("E");
    expect(formatToPar(3)).toBe("+3");
    expect(formatToPar(-2)).toBe("-2");
    expect(formatToPar(null)).toBe("");
  });

  it("formats money without pointless decimals", () => {
    expect(formatMoney(150)).toBe("$150");
    expect(formatMoney(62.5)).toBe("$62.50");
  });
});
