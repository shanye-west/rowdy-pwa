/**
 * get_head_to_head — record between any two players, computed from playerMatchFacts.
 *
 * Reads facts for player A (single-field auto-index, no composite needed) and
 * filters in memory to those where A faced B (opponentIds contains B).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getFactsForPlayer } from "../firestore.js";
import { jsonResult, resolveOrExplain } from "./util.js";
import type { PlayerMatchFact } from "../types.js";

interface Tally {
  wins: number;
  losses: number;
  halves: number;
  points: number;
}

function emptyTally(): Tally {
  return { wins: 0, losses: 0, halves: 0, points: 0 };
}

/** Tally A's outcomes across the given facts (one fact = one match for A). */
export function tallyHeadToHead(facts: PlayerMatchFact[]): {
  overall: Tally;
  byFormat: Record<string, Tally>;
} {
  const overall = emptyTally();
  const byFormat: Record<string, Tally> = {};
  for (const f of facts) {
    const fmt = f.format || "unknown";
    const bucket = (byFormat[fmt] ??= emptyTally());
    const pts = f.pointsEarned ?? 0;
    overall.points += pts;
    bucket.points += pts;
    if (f.outcome === "win") {
      overall.wins++;
      bucket.wins++;
    } else if (f.outcome === "loss") {
      overall.losses++;
      bucket.losses++;
    } else if (f.outcome === "halve") {
      overall.halves++;
      bucket.halves++;
    }
  }
  return { overall, byFormat };
}

export function registerHeadToHeadTool(server: McpServer): void {
  server.registerTool(
    "get_head_to_head",
    {
      title: "Head-to-head record",
      description:
        "The head-to-head record of player A against player B (matches where they " +
        "were on opposing teams). Returns A's wins/losses/halves and points, " +
        "overall and split by format. Optionally restrict to a series or format.",
      inputSchema: {
        playerA: z.string().describe("First player (name or id)."),
        playerB: z.string().describe("Second player (name or id)."),
        series: z.string().optional().describe("Restrict to a series (e.g. 'rowdyCup')."),
        format: z
          .enum(["singles", "twoManBestBall", "twoManShamble", "twoManScramble", "fourManScramble"])
          .optional()
          .describe("Restrict to one match format."),
      },
    },
    async ({ playerA, playerB, series, format }) => {
      const a = await resolveOrExplain(playerA);
      if (!a.ok) return a.result;
      const b = await resolveOrExplain(playerB, a.players);
      if (!b.ok) return b.result;
      if (a.playerId === b.playerId) {
        return jsonResult({ note: "Both arguments resolved to the same player." });
      }

      let facts = await getFactsForPlayer(a.playerId);
      facts = facts.filter((f) => (f.opponentIds || []).includes(b.playerId));
      if (series) facts = facts.filter((f) => f.tournamentSeries === series);
      if (format) facts = facts.filter((f) => f.format === format);

      const { overall, byFormat } = tallyHeadToHead(facts);
      return jsonResult({
        playerA: { playerId: a.playerId, displayName: a.displayName },
        playerB: { playerId: b.playerId, displayName: b.displayName },
        filters: { series: series ?? null, format: format ?? null },
        record: overall, // from A's perspective
        byFormat,
        matches: facts.map((f) => ({
          tournament: f.tournamentName,
          year: f.tournamentYear,
          day: f.day,
          format: f.format,
          outcome: f.outcome,
          points: f.pointsEarned,
          margin: f.finalMargin,
        })),
      });
    }
  );
}
