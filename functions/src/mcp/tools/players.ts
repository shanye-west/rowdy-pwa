/**
 * Player-centric tools: search_players, get_player_stats, get_player_match_history.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getAllRealPlayers,
  getActiveTournament,
  getPlayerStats,
  getFactsForPlayer,
  resolveTournament,
  resolveSeries,
} from "../firestore.js";
import { jsonResult, errorResult, resolveOrExplain, rosterInfo } from "./util.js";

export function registerPlayerTools(server: McpServer): void {
  server.registerTool(
    "search_players",
    {
      title: "Search players",
      description:
        "Find Rowdy Cup players by (partial) name and resolve them to player ids. " +
        "Returns each match with their current team, tier, and handicap (when on " +
        "the active tournament roster). Call this first to discover names/ids.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Partial or full display name. Omit to list all players."),
      },
    },
    async ({ query }) => {
      const [players, active] = await Promise.all([getAllRealPlayers(), getActiveTournament()]);
      const roster = rosterInfo(active);
      const q = (query || "").trim().toLowerCase();
      const matched = q
        ? players.filter((p) => (p.displayName || "").toLowerCase().includes(q))
        : players;
      const rows = matched
        .map((p) => ({
          playerId: p.id,
          displayName: p.displayName || p.id,
          ...(roster[p.id]
            ? {
                team: roster[p.id].team,
                teamName: roster[p.id].teamName,
                tier: roster[p.id].tier,
                handicap: roster[p.id].handicap,
                isCaptain: roster[p.id].isCaptain || undefined,
              }
            : {}),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      return jsonResult({ count: rows.length, players: rows });
    }
  );

  server.registerTool(
    "get_player_stats",
    {
      title: "Get player stats",
      description:
        "Aggregated stats for one player: win/loss/halve record, points, format " +
        "breakdown, birdies/eagles, and badges (comebacks, blown leads, clutch " +
        "wins, etc.). Scope is all-time (by series) or a single tournament.",
      inputSchema: {
        player: z.string().describe("Player name or id (e.g. 'Austin' or 'pAustinBrady')."),
        scope: z
          .enum(["allTime", "tournament"])
          .optional()
          .describe("Default 'allTime'. Use 'tournament' for a single event."),
        series: z
          .string()
          .optional()
          .describe("Series key for all-time scope (default the active series, e.g. 'rowdyCup')."),
        tournamentId: z
          .string()
          .optional()
          .describe("Required-ish for 'tournament' scope; defaults to the active tournament."),
      },
    },
    async ({ player, scope, series, tournamentId }) => {
      const resolved = await resolveOrExplain(player);
      if (!resolved.ok) return resolved.result;

      const useScope = scope ?? "allTime";
      let key: string;
      if (useScope === "tournament") {
        const t = await resolveTournament(tournamentId);
        if (!t) return errorResult("No tournament found (none active and no tournamentId given).");
        key = t.id;
      } else {
        key = await resolveSeries(series);
      }

      const stats = await getPlayerStats(resolved.playerId, useScope, key);
      if (!stats) {
        return jsonResult({
          playerId: resolved.playerId,
          displayName: resolved.displayName,
          scope: useScope,
          key,
          stats: null,
          note: "No stats recorded for this player in this scope.",
        });
      }
      return jsonResult({
        playerId: resolved.playerId,
        displayName: resolved.displayName,
        scope: useScope,
        key,
        stats,
      });
    }
  );

  server.registerTool(
    "get_player_match_history",
    {
      title: "Get player match history",
      description:
        "A player's most recent matches: outcome, format, points, opponents, " +
        "partners, and birdies/eagles. Optionally filter to one tournament.",
      inputSchema: {
        player: z.string().describe("Player name or id."),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20."),
        tournamentId: z.string().optional().describe("Filter to a single tournament."),
      },
    },
    async ({ player, limit, tournamentId }) => {
      const resolved = await resolveOrExplain(player);
      if (!resolved.ok) return resolved.result;

      let facts = await getFactsForPlayer(resolved.playerId);
      if (tournamentId) facts = facts.filter((f) => f.tournamentId === tournamentId);
      // Newest first: by tournament year, then day.
      facts.sort(
        (a, b) => (b.tournamentYear ?? 0) - (a.tournamentYear ?? 0) || (b.day ?? 0) - (a.day ?? 0)
      );
      const rows = facts.slice(0, limit ?? 20).map((f) => ({
        tournament: f.tournamentName,
        year: f.tournamentYear,
        day: f.day,
        format: f.format,
        team: f.team,
        outcome: f.outcome,
        points: f.pointsEarned,
        margin: f.finalMargin,
        opponents: f.opponentIds,
        partners: f.partnerIds,
        birdies: f.birdies,
        eagles: f.eagles,
      }));
      return jsonResult({
        playerId: resolved.playerId,
        displayName: resolved.displayName,
        matchesReturned: rows.length,
        totalMatches: facts.length,
        matches: rows,
      });
    }
  );
}
