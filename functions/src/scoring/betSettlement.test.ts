/**
 * Unit tests for betSettlement.ts
 */

import { describe, it, expect } from "vitest";
import {
  settleMatchBet,
  settleCupFutureBet,
  settleRoundBet,
  settleOverUnderBet,
  settlePlayerMatchupBet,
} from "./betSettlement.js";
import type { BetDoc } from "../types.js";

/** A matched/active bet: proposer backs teamA, acceptor backs teamB, $20 each. */
function activeBet(overrides: Partial<BetDoc> = {}): BetDoc {
  return {
    id: "bet1",
    tournamentId: "t1",
    market: "match",
    matchId: "m1",
    kind: "offer",
    status: "active",
    amount: 20,
    proposerId: "pAlice",
    proposerSide: "teamA",
    acceptorId: "pBob",
    acceptorSide: "teamB",
    proposerConfirmed: true,
    acceptorConfirmed: true,
    participantIds: ["pAlice", "pBob"],
    ...overrides,
  };
}

describe("settleMatchBet", () => {
  it("pays the proposer when their side (teamA) wins", () => {
    const result = settleMatchBet(activeBet(), "teamA");
    expect(result).toEqual({
      outcome: "teamA",
      winnerId: "pAlice",
      loserId: "pBob",
      payout: 20,
    });
  });

  it("pays the acceptor when their side (teamB) wins", () => {
    const result = settleMatchBet(activeBet(), "teamB");
    expect(result).toEqual({
      outcome: "teamB",
      winnerId: "pBob",
      loserId: "pAlice",
      payout: 20,
    });
  });

  it("is a push (no money) when the match is halved (AS)", () => {
    const result = settleMatchBet(activeBet(), "AS");
    expect(result).toEqual({ outcome: "push", payout: 0 });
    expect(result.winnerId).toBeUndefined();
    expect(result.loserId).toBeUndefined();
  });

  it("resolves correctly when the proposer backed teamB instead", () => {
    const bet = activeBet({ proposerSide: "teamB", acceptorSide: "teamA" });
    expect(settleMatchBet(bet, "teamB")).toMatchObject({ winnerId: "pAlice", loserId: "pBob", payout: 20 });
    expect(settleMatchBet(bet, "teamA")).toMatchObject({ winnerId: "pBob", loserId: "pAlice", payout: 20 });
  });

  it("carries the bet's stake amount into the payout", () => {
    expect(settleMatchBet(activeBet({ amount: 100 }), "teamA").payout).toBe(100);
  });
});

describe("settleCupFutureBet", () => {
  function futureBet(overrides: Partial<BetDoc> = {}): BetDoc {
    return activeBet({ market: "cupFuture", matchId: undefined, ...overrides });
  }

  it("pays the player who backed the Cup-winning team", () => {
    expect(settleCupFutureBet(futureBet(), "teamA")).toMatchObject({ winnerId: "pAlice", loserId: "pBob", payout: 20 });
    expect(settleCupFutureBet(futureBet(), "teamB")).toMatchObject({ winnerId: "pBob", loserId: "pAlice", payout: 20 });
  });

  it("is a push when the Cup is tied/retained", () => {
    expect(settleCupFutureBet(futureBet(), "push")).toEqual({ outcome: "push", payout: 0 });
  });
});

describe("settleRoundBet", () => {
  function roundBet(overrides: Partial<BetDoc> = {}): BetDoc {
    return activeBet({ market: "round", matchId: undefined, roundId: "r1", ...overrides });
  }

  it("pays the team with more round points", () => {
    expect(settleRoundBet(roundBet(), 2.5, 1.5)).toMatchObject({ winnerId: "pAlice", loserId: "pBob", payout: 20 });
    expect(settleRoundBet(roundBet(), 1, 3)).toMatchObject({ winnerId: "pBob", loserId: "pAlice", payout: 20 });
  });

  it("is a push when the session is split evenly", () => {
    expect(settleRoundBet(roundBet(), 2, 2)).toEqual({ outcome: "push", payout: 0 });
  });
});

describe("settleOverUnderBet", () => {
  // Proposer backs the over, acceptor the under.
  function ouBet(overrides: Partial<BetDoc> = {}): BetDoc {
    return activeBet({
      market: "overUnder",
      metric: "matchHolesPlayed",
      line: 16.5,
      proposerSide: "over",
      acceptorSide: "under",
      ...overrides,
    });
  }

  it("pays the over when the value clears the line", () => {
    expect(settleOverUnderBet(ouBet(), 18, 16.5)).toMatchObject({ winnerId: "pAlice", loserId: "pBob", payout: 20 });
  });

  it("pays the under when the value falls short", () => {
    expect(settleOverUnderBet(ouBet(), 15, 16.5)).toMatchObject({ winnerId: "pBob", loserId: "pAlice", payout: 20 });
  });

  it("is a push when the value lands exactly on the line", () => {
    expect(settleOverUnderBet(ouBet({ line: 16 }), 16, 16)).toEqual({ outcome: "push", payout: 0 });
  });

  it("resolves from the acceptor's perspective when the proposer took the under", () => {
    const bet = ouBet({ proposerSide: "under", acceptorSide: "over" });
    expect(settleOverUnderBet(bet, 18, 16.5)).toMatchObject({ winnerId: "pBob", loserId: "pAlice", payout: 20 });
    expect(settleOverUnderBet(bet, 12, 16.5)).toMatchObject({ winnerId: "pAlice", loserId: "pBob", payout: 20 });
  });

  it("settles a player's tournament-points over/under from their total", () => {
    const bet = ouBet({ metric: "playerTournamentPoints", matchId: undefined, subjectId: "pCarol", line: 3.5 });
    expect(settleOverUnderBet(bet, 4, 3.5)).toMatchObject({ winnerId: "pAlice", loserId: "pBob", payout: 20 });
    expect(settleOverUnderBet(bet, 2.5, 3.5)).toMatchObject({ winnerId: "pBob", loserId: "pAlice", payout: 20 });
  });
});

describe("settlePlayerMatchupBet", () => {
  // Proposer (pAlice) backs subject A via teamA; acceptor (pBob) backs subject B.
  function matchupBet(overrides: Partial<BetDoc> = {}): BetDoc {
    return activeBet({
      market: "playerMatchup",
      matchId: undefined,
      subjectAId: "pCarol",
      subjectBId: "pDave",
      ...overrides,
    });
  }

  it("pays the side backing the higher-scoring player", () => {
    expect(settlePlayerMatchupBet(matchupBet(), 4, 2.5)).toMatchObject({ winnerId: "pAlice", loserId: "pBob", payout: 20 });
    expect(settlePlayerMatchupBet(matchupBet(), 1, 3)).toMatchObject({ winnerId: "pBob", loserId: "pAlice", payout: 20 });
  });

  it("is a push when the two players tie on points", () => {
    expect(settlePlayerMatchupBet(matchupBet(), 3, 3)).toEqual({ outcome: "push", payout: 0 });
  });

  it("resolves correctly when the proposer backed subject B (teamB)", () => {
    const bet = matchupBet({ proposerSide: "teamB", acceptorSide: "teamA" });
    expect(settlePlayerMatchupBet(bet, 2, 5)).toMatchObject({ winnerId: "pAlice", loserId: "pBob", payout: 20 });
  });
});
