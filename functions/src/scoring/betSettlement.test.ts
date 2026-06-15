/**
 * Unit tests for betSettlement.ts
 */

import { describe, it, expect } from "vitest";
import { settleMatchBet, settleCupFutureBet } from "./betSettlement.js";
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
