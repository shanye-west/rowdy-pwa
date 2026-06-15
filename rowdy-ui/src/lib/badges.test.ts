import { describe, it, expect } from "vitest";
import { getBadges } from "./badges";
import type { PlayerStatsBySeries } from "../types";

const base: PlayerStatsBySeries = {
  playerId: "p1",
  series: "rowdyCup",
  wins: 0,
  losses: 0,
  halves: 0,
  points: 0,
  matchesPlayed: 0,
  comebackWins: 0,
  blownLeads: 0,
  neverBehindWins: 0,
  jekyllAndHydes: 0,
  clutchWins: 0,
};

describe("getBadges", () => {
  it("returns no badges for an empty stat line", () => {
    expect(getBadges(base)).toEqual([]);
  });

  it("returns no badges for null/undefined", () => {
    expect(getBadges(null)).toEqual([]);
    expect(getBadges(undefined)).toEqual([]);
  });

  it("awards Clutch Hero with the right count for an 18th-hole win", () => {
    const clutch = getBadges({ ...base, clutchWins: 2 }).find((b) => b.id === "clutch");
    expect(clutch?.count).toBe(2);
    expect(clutch?.tone).toBe("gold");
  });

  it("respects thresholds (Ham & Egger needs 3)", () => {
    expect(getBadges({ ...base, hamAndEggs: 2 }).some((b) => b.id === "hamandegg")).toBe(false);
    expect(getBadges({ ...base, hamAndEggs: 3 }).some((b) => b.id === "hamandegg")).toBe(true);
  });

  it("tags blown leads as a 'fun' badge", () => {
    const heartbreak = getBadges({ ...base, blownLeads: 1 }).find((b) => b.id === "heartbreak");
    expect(heartbreak?.tone).toBe("fun");
  });

  it("ignores non-finite / missing counters without crashing", () => {
    const dirty = { ...base, drivesUsed: undefined, birdies: NaN as unknown as number };
    expect(() => getBadges(dirty)).not.toThrow();
    expect(getBadges(dirty)).toEqual([]);
  });
});
