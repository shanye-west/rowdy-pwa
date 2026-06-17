import { describe, it, expect } from "vitest";
import { resolvePlayer } from "./resolve.js";
import type { PlayerDoc } from "./types.js";

const players: PlayerDoc[] = [
  { id: "pAustinBrady", displayName: "Austin Brady" },
  { id: "pAustinKemp", displayName: "Austin Kemp" },
  { id: "pShane", displayName: "Shane Peterson" },
  { id: "pGaryTrock", displayName: "Gary Trock" },
];

describe("resolvePlayer", () => {
  it("matches an exact player id", () => {
    const r = resolvePlayer("pShane", players);
    expect(r).toEqual({ kind: "ok", playerId: "pShane", displayName: "Shane Peterson" });
  });

  it("matches an exact display name case-insensitively", () => {
    const r = resolvePlayer("shane peterson", players);
    expect(r).toMatchObject({ kind: "ok", playerId: "pShane" });
  });

  it("matches a unique substring", () => {
    const r = resolvePlayer("trock", players);
    expect(r).toMatchObject({ kind: "ok", playerId: "pGaryTrock" });
  });

  it("reports ambiguity for multiple substring matches", () => {
    const r = resolvePlayer("austin", players);
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") {
      expect(r.candidates.map((c) => c.playerId).sort()).toEqual(["pAustinBrady", "pAustinKemp"].sort());
    }
  });

  it("prefers an exact name over substring collisions", () => {
    const r = resolvePlayer("Austin Brady", players);
    expect(r).toMatchObject({ kind: "ok", playerId: "pAustinBrady" });
  });

  it("returns notFound for no match", () => {
    const r = resolvePlayer("nobody", players);
    expect(r).toMatchObject({ kind: "notFound" });
  });

  it("returns notFound for empty input", () => {
    const r = resolvePlayer("   ", players);
    expect(r.kind).toBe("notFound");
  });
});
