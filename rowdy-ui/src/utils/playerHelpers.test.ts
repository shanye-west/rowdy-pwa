/**
 * Unit tests for playerHelpers.ts
 */

import { describe, it, expect } from "vitest";
import { getPlayerName, getPlayerShortName, getPlayerInitials } from "./playerHelpers";
import type { PlayerLookup } from "./playerHelpers";

// --- Test data ---

const mockPlayers: PlayerLookup = {
  "player1": { id: "player1", displayName: "Shane West", username: "swest" },
  "player2": { id: "player2", displayName: "John Smith", username: "jsmith" },
  "player3": { id: "player3", displayName: "Mary Jane Watson", username: "mjw" },
  "player4": { id: "player4", displayName: "Madonna", username: "madonna" },
  "player5": { id: "player5", username: "onlyusername" },
  "player6": { id: "player6", displayName: "", username: "emptyname" },
  "player7": { id: "player7" },
};

// --- getPlayerName tests ---

describe("getPlayerName", () => {
  it("returns displayName when available", () => {
    expect(getPlayerName("player1", mockPlayers)).toBe("Shane West");
  });

  it("falls back to username when displayName missing", () => {
    expect(getPlayerName("player5", mockPlayers)).toBe("onlyusername");
  });

  it("falls back to username when displayName empty", () => {
    expect(getPlayerName("player6", mockPlayers)).toBe("emptyname");
  });

  it("returns 'Unknown' when neither displayName nor username", () => {
    expect(getPlayerName("player7", mockPlayers)).toBe("Unknown");
  });

  it("returns '...' for unknown player ID", () => {
    expect(getPlayerName("unknownId", mockPlayers)).toBe("...");
  });

  it("returns 'Player' for undefined pid", () => {
    expect(getPlayerName(undefined, mockPlayers)).toBe("Player");
  });

  it("returns 'Player' for empty string pid", () => {
    expect(getPlayerName("", mockPlayers)).toBe("Player");
  });
});

// --- getPlayerShortName tests ---

describe("getPlayerShortName", () => {
  it("returns 'F. LastName' for two-word name", () => {
    expect(getPlayerShortName("player1", mockPlayers)).toBe("S. West");
  });

  it("returns 'F. LastName' using last word for three-word name", () => {
    expect(getPlayerShortName("player3", mockPlayers)).toBe("M. Watson");
  });

  it("returns 'F.' for single-word name", () => {
    expect(getPlayerShortName("player4", mockPlayers)).toBe("M.");
  });

  it("returns '?' for unknown player ID", () => {
    expect(getPlayerShortName("unknownId", mockPlayers)).toBe("?");
  });

  it("returns '?' for undefined pid", () => {
    expect(getPlayerShortName(undefined, mockPlayers)).toBe("?");
  });

  it("returns '?' for empty string pid", () => {
    expect(getPlayerShortName("", mockPlayers)).toBe("?");
  });

  it("falls back to username for short name", () => {
    expect(getPlayerShortName("player5", mockPlayers)).toBe("o.");
  });
});

// --- getPlayerInitials tests ---

describe("getPlayerInitials", () => {
  it("returns uppercase initials for two-word name", () => {
    expect(getPlayerInitials("player1", mockPlayers)).toBe("SW");
    expect(getPlayerInitials("player2", mockPlayers)).toBe("JS");
  });

  it("returns first and last initials for three-word name", () => {
    expect(getPlayerInitials("player3", mockPlayers)).toBe("MW");
  });

  it("returns single initial for single-word name", () => {
    expect(getPlayerInitials("player4", mockPlayers)).toBe("M");
  });

  it("returns '?' for unknown player ID", () => {
    expect(getPlayerInitials("unknownId", mockPlayers)).toBe("?");
  });

  it("returns '?' for undefined pid", () => {
    expect(getPlayerInitials(undefined, mockPlayers)).toBe("?");
  });

  it("returns '?' for empty string pid", () => {
    expect(getPlayerInitials("", mockPlayers)).toBe("?");
  });

  it("handles lowercase names (returns uppercase)", () => {
    expect(getPlayerInitials("player5", mockPlayers)).toBe("O");
  });
});

// --- Edge cases ---

describe("edge cases", () => {
  it("handles empty players lookup", () => {
    const emptyPlayers: PlayerLookup = {};
    expect(getPlayerName("player1", emptyPlayers)).toBe("...");
    expect(getPlayerShortName("player1", emptyPlayers)).toBe("?");
    expect(getPlayerInitials("player1", emptyPlayers)).toBe("?");
  });

  it("handles names with extra whitespace", () => {
    const playersWithWhitespace: PlayerLookup = {
      "p1": { id: "p1", displayName: "  Shane   West  " },
    };
    // trim() is called, so extra internal spaces become multiple parts
    expect(getPlayerInitials("p1", playersWithWhitespace)).toBe("SW");
  });
});
