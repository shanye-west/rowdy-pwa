/**
 * get_leaderboard — all-time (by series) or current-tournament standings.
 *
 *  - allTime: scan players, fetch each bySeries/{series} doc by path, sort by
 *    points (mirrors the frontend useAllTimeLeaderboard; needs no extra index).
 *  - tournament: the existing `byTournament` collection-group query.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getAllRealPlayers,
  getPlayerStats,
  getTournamentStatRows,
  resolveTournament,
  resolveSeries,
} from "../firestore.js";
import { jsonResult, errorResult } from "./util.js";

interface Row {
  rank?: number;
  playerId: string;
  displayName: string;
  points: number;
  wins: number;
  losses: number;
  halves: number;
  matchesPlayed: number;
  birdies: number;
}

/** Rank by points, then wins, then fewest losses (matches the app's ordering). */
function sortRows(a: Row, b: Row): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  return a.losses - b.losses;
}

export function registerLeaderboardTool(server: McpServer): void {
  server.registerTool(
    "get_leaderboard",
    {
      title: "Get leaderboard",
      description:
        "Player standings sorted by points. scope 'allTime' spans every player " +
        "ever in the series; scope 'tournament' covers a single event.",
      inputSchema: {
        scope: z.enum(["allTime", "tournament"]).describe("'allTime' or 'tournament'."),
        series: z
          .string()
          .optional()
          .describe("Series for all-time scope (default active series, e.g. 'rowdyCup')."),
        tournamentId: z
          .string()
          .optional()
          .describe("Tournament for 'tournament' scope; defaults to the active one."),
        limit: z.number().int().min(1).max(200).optional().describe("Cap rows (default all)."),
      },
    },
    async ({ scope, series, tournamentId, limit }) => {
      const players = await getAllRealPlayers();
      const nameById = new Map(players.map((p) => [p.id, p.displayName || p.id]));
      let rows: Row[] = [];
      let key: string;

      if (scope === "allTime") {
        key = await resolveSeries(series);
        const results = await Promise.all(
          players.map(async (p) => {
            const s = await getPlayerStats(p.id, "allTime", key);
            return s ? { p, s } : null;
          })
        );
        for (const r of results) {
          if (!r) continue;
          rows.push({
            playerId: r.p.id,
            displayName: r.p.displayName || r.p.id,
            points: r.s.points ?? 0,
            wins: r.s.wins ?? 0,
            losses: r.s.losses ?? 0,
            halves: r.s.halves ?? 0,
            matchesPlayed: r.s.matchesPlayed ?? 0,
            birdies: r.s.birdies ?? 0,
          });
        }
      } else {
        const t = await resolveTournament(tournamentId);
        if (!t) return errorResult("No tournament found (none active and no tournamentId given).");
        key = t.id;
        const statRows = await getTournamentStatRows(t.id);
        for (const s of statRows) {
          if (!s.playerId) continue;
          // byTournament docs exist for test players too; keep only real ones.
          if (!nameById.has(s.playerId)) continue;
          const wins = s.wins ?? 0;
          const losses = s.losses ?? 0;
          const halves = s.halves ?? 0;
          rows.push({
            playerId: s.playerId,
            displayName: nameById.get(s.playerId) || s.playerId,
            points: s.points ?? wins + 0.5 * halves,
            wins,
            losses,
            halves,
            matchesPlayed: s.matchesPlayed ?? wins + losses + halves,
            birdies: s.birdies ?? 0,
          });
        }
      }

      rows.sort(sortRows);
      if (limit) rows = rows.slice(0, limit);
      rows.forEach((r, i) => (r.rank = i + 1));
      return jsonResult({ scope, key, count: rows.length, leaderboard: rows });
    }
  );
}
