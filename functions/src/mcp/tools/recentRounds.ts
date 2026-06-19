/**
 * Recent-rounds tool: get_player_recent_rounds.
 *
 * Surfaces a golfer's last ~20 posted GHIN rounds (real off-course scoring),
 * imported into playerRecentRounds/{playerId}. This is "current form" for draft
 * analysis — distinct from Rowdy Cup match results — and is intentionally not
 * shown in the app UI.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRecentRounds } from "../firestore.js";
import { jsonResult, resolveOrExplain } from "./util.js";

const LEGEND = {
  scoreDifferential:
    "USGA Score Differential (lower is better), already 18-hole-equivalent " +
    "even for nine-hole rounds. The headline metric for current form.",
  usedInHandicap: "true = one of the rounds currently counting toward the handicap index.",
  scoreType: "GHIN posting code: H=home, A=away, N=nine-hole, C=combined/competition.",
  holesPlayed: "Holes actually played when fewer than the full round; null = full round.",
  lowHandicapIndex:
    "Numeric; plus handicaps are negative (e.g. +1.2 stored as -1.2). " +
    "lowHandicapIndexDisplay preserves the original signed string.",
};

export function registerRecentRoundsTool(server: McpServer): void {
  server.registerTool(
    "get_player_recent_rounds",
    {
      title: "Get player recent rounds (GHIN form)",
      description:
        "A golfer's last ~20 posted GHIN rounds: per-round adjusted gross, USGA " +
        "score differential, course rating/slope, date, and which rounds count " +
        "toward their handicap — plus a form summary (average / recent / best " +
        "differential). This is real off-course scoring for assessing CURRENT form " +
        "and consistency, distinct from Rowdy Cup match results, and is the main " +
        "input for captain draft analysis alongside get_draft_pool. Only the 2026 " +
        "draft-pool golfers have this data.",
      inputSchema: {
        player: z.string().describe("Player name or id (e.g. 'Austin' or 'pAustinBrady')."),
      },
    },
    async ({ player }) => {
      const resolved = await resolveOrExplain(player);
      if (!resolved.ok) return resolved.result;

      const data = await getRecentRounds(resolved.playerId);
      if (!data) {
        return jsonResult({
          playerId: resolved.playerId,
          displayName: resolved.displayName,
          rounds: null,
          note: "No recent-rounds (GHIN) data on file for this player — only 2026 draft-pool golfers have it.",
        });
      }
      return jsonResult({
        playerId: resolved.playerId,
        displayName: resolved.displayName,
        lowHandicapIndex: data.lowHandicapIndex,
        lowHandicapIndexDisplay: data.lowHandicapIndexDisplay,
        source: data.source,
        updatedAt: data.updatedAt,
        roundCount: data.roundCount,
        summary: data.summary,
        rounds: data.rounds,
        legend: LEGEND,
      });
    }
  );
}
