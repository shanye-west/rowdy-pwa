/**
 * Shared helpers for MCP tool handlers: result formatting, player-name
 * resolution, and roster lookups.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getAllRealPlayers } from "../firestore.js";
import { resolvePlayer } from "../resolve.js";
import type { PlayerDoc, TournamentDoc } from "../types.js";

/** Alias for the SDK's tool-result shape (carries the required index signature). */
export type ToolResult = CallToolResult;

export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string, extra?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message, ...extra }, null, 2) }],
    isError: true,
  };
}

export type ResolveOutcome =
  | { ok: true; playerId: string; displayName: string; players: PlayerDoc[] }
  | { ok: false; result: ToolResult; players: PlayerDoc[] };

/**
 * Resolve a name/id argument to a playerId, returning an explanatory ToolResult
 * (with candidates) when ambiguous or not found. Pass an existing `players`
 * list to avoid re-fetching.
 */
export async function resolveOrExplain(input: string, players?: PlayerDoc[]): Promise<ResolveOutcome> {
  const list = players ?? (await getAllRealPlayers());
  const r = resolvePlayer(input, list);
  if (r.kind === "ok") {
    return { ok: true, playerId: r.playerId, displayName: r.displayName, players: list };
  }
  if (r.kind === "ambiguous") {
    return {
      ok: false,
      players: list,
      result: errorResult(`Multiple players match "${input}" — specify which one.`, {
        candidates: r.candidates,
      }),
    };
  }
  return {
    ok: false,
    players: list,
    result: errorResult(`No player found matching "${input}".`, {
      hint: "Call search_players to see available names.",
    }),
  };
}

export interface RosterEntry {
  team: "teamA" | "teamB";
  teamName?: string;
  tier?: string;
  handicap?: number;
  isCaptain?: boolean;
}

/** playerId -> roster info (team, tier, handicap, captaincy) for a tournament. */
export function rosterInfo(t: TournamentDoc | null): Record<string, RosterEntry> {
  const out: Record<string, RosterEntry> = {};
  if (!t) return out;
  for (const teamKey of ["teamA", "teamB"] as const) {
    const side = t[teamKey];
    if (!side) continue;
    const tiers = side.rosterByTier || {};
    for (const tier of ["A", "B", "C", "D"] as const) {
      for (const pid of tiers[tier] || []) {
        out[pid] = {
          team: teamKey,
          teamName: side.name,
          tier,
          handicap: side.handicapByPlayer?.[pid],
          isCaptain: side.captainId === pid || side.coCaptainId === pid,
        };
      }
    }
  }
  return out;
}
