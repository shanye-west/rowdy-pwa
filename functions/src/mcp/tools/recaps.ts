/**
 * get_round_recap — pre-computed round recap: scoring leaders (birdies/eagles/
 * low rounds), per-hole averages, and "vs all" records.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getRoundRecap,
  getRoundsForTournament,
  resolveTournament,
} from "../firestore.js";
import { jsonResult, errorResult } from "./util.js";

export function registerRecapTool(server: McpServer): void {
  server.registerTool(
    "get_round_recap",
    {
      title: "Get round recap",
      description:
        "A round's recap: scoring leaders (birdie/eagle counts, low gross/net), " +
        "per-hole scoring averages, and 'vs all' records. Identify the round by " +
        "roundId, or by day within a tournament.",
      inputSchema: {
        roundId: z.string().optional().describe("Round id (preferred if known)."),
        day: z.number().int().optional().describe("Day number; resolved within the tournament."),
        tournamentId: z
          .string()
          .optional()
          .describe("Tournament for the 'day' lookup; defaults to the active one."),
      },
    },
    async ({ roundId, day, tournamentId }) => {
      let id = roundId;
      if (!id) {
        if (day === undefined) {
          return errorResult("Provide either roundId or day.");
        }
        const t = await resolveTournament(tournamentId);
        if (!t) return errorResult("No tournament found to resolve the day against.");
        const rounds = await getRoundsForTournament(t.id);
        const match = rounds.find((r) => (r.day ?? null) === day);
        if (!match) {
          return errorResult(`No round found for day ${day} in tournament ${t.id}.`, {
            availableDays: rounds.map((r) => r.day).filter((d) => d !== undefined),
          });
        }
        id = match.id;
      }

      const recap = await getRoundRecap(id);
      if (!recap) {
        return jsonResult({
          roundId: id,
          recap: null,
          note: "No recap computed for this round (recaps are generated after a round finishes).",
        });
      }
      return jsonResult({ roundId: id, recap });
    }
  );
}
