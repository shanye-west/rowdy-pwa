/**
 * MCP server factory. Builds a fresh McpServer with all read-only tools
 * registered. Used per-request by the stateless HTTP transport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPlayerTools } from "./tools/players.js";
import { registerHeadToHeadTool } from "./tools/headToHead.js";
import { registerLeaderboardTool } from "./tools/leaderboards.js";
import { registerTournamentTools } from "./tools/tournament.js";
import { registerRecapTool } from "./tools/recaps.js";

const INSTRUCTIONS = `Read-only access to Rowdy Cup data — a 12v12, Ryder-Cup-style
golf tournament played as a series ("rowdyCup") across multiple years.

Guidance:
- Players are referenced by name; resolve them with search_players first if a
  lookup is ambiguous (tools also accept a name directly).
- Stats scope is "allTime" (across a series) or "tournament" (one event). The
  default series is "rowdyCup"; the default tournament is the active one.
- For captain draft analysis and pairing help, start with get_draft_pool (pool
  handicaps + each player's all-time record), then use get_head_to_head and
  get_player_stats to compare specific players.
This server is strictly read-only; it cannot modify any data.`;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "rowdy-cup", version: "1.0.0" },
    { instructions: INSTRUCTIONS }
  );

  registerPlayerTools(server);
  registerHeadToHeadTool(server);
  registerLeaderboardTool(server);
  registerTournamentTools(server);
  registerRecapTool(server);

  return server;
}
