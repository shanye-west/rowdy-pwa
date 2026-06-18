/**
 * Pure settlement logic for the sportsbook (peer-to-peer betting) feature.
 *
 * Kept free of Firestore so it can be unit-tested in isolation, mirroring the
 * rest of functions/src/scoring/. The settleMatchBets trigger and the
 * settleCupFutures callable apply these results to `active` bets.
 *
 * Even-money, flat stakes: the winner is owed `amount`; the loser pays `amount`;
 * a halved match (AS) is a push (no money changes hands).
 */

import type { BetDoc, BetResult, BetSide } from "../types.js";

/** The subset of a bet needed to resolve it. */
type ResolvableBet = Pick<
  BetDoc,
  "proposerId" | "proposerSide" | "acceptorId" | "acceptorSide" | "amount"
>;

/**
 * Resolve a two-sided bet given the winning side (or a push). The proposer and
 * acceptor always hold opposite sides, so the winning side identifies the payee.
 */
function resolve(bet: ResolvableBet, outcome: BetSide | "push"): BetResult {
  if (outcome === "push") {
    return { outcome: "push", payout: 0 };
  }
  const proposerWon = bet.proposerSide === outcome;
  return {
    outcome,
    winnerId: proposerWon ? bet.proposerId : bet.acceptorId,
    loserId: proposerWon ? bet.acceptorId : bet.proposerId,
    payout: bet.amount,
  };
}

/**
 * Settle a match-winner bet from a closed match's result.
 * `winner` comes straight from `MatchDoc.result.winner` ("teamA" | "teamB" | "AS").
 */
export function settleMatchBet(bet: ResolvableBet, winner: "teamA" | "teamB" | "AS"): BetResult {
  return resolve(bet, winner === "AS" ? "push" : winner);
}

/**
 * Settle a Cup-futures bet given the team that won the Cup. A tied Cup (no
 * outright winner) is a push.
 */
export function settleCupFutureBet(bet: ResolvableBet, winningTeam: BetSide | "push"): BetResult {
  return resolve(bet, winningTeam);
}

/**
 * Settle a round/session-winner bet from the round's final team points. The team
 * with more points wins; equal points (a halved session) is a push.
 */
export function settleRoundBet(bet: ResolvableBet, teamAPoints: number, teamBPoints: number): BetResult {
  const outcome = teamAPoints > teamBPoints ? "teamA" : teamBPoints > teamAPoints ? "teamB" : "push";
  return resolve(bet, outcome);
}

/**
 * Settle an over/under bet by comparing the realized value to the line. Landing
 * exactly on the line is a push — use half-lines (e.g. 16.5) to avoid it.
 */
export function settleOverUnderBet(bet: ResolvableBet, actualValue: number, line: number): BetResult {
  const outcome = actualValue > line ? "over" : actualValue < line ? "under" : "push";
  return resolve(bet, outcome);
}
