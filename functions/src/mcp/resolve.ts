/**
 * Resolve a free-text player reference (a name, or a player id) to a playerId.
 *
 * Players type names, not ids. We accept:
 *  - an exact player id (starts with `p`, e.g. "pAustinBrady")
 *  - a case-insensitive exact display-name match
 *  - a case-insensitive substring match
 * On multiple substring matches we report ambiguity so the AI can disambiguate.
 */
import type { PlayerDoc } from "./types.js";

export type ResolveResult =
  | { kind: "ok"; playerId: string; displayName: string }
  | { kind: "ambiguous"; candidates: Array<{ playerId: string; displayName: string }> }
  | { kind: "notFound"; query: string };

export function resolvePlayer(input: string, players: PlayerDoc[]): ResolveResult {
  const q = input.trim();
  if (!q) return { kind: "notFound", query: input };

  // Direct id hit.
  const byId = players.find((p) => p.id === q);
  if (byId) return { kind: "ok", playerId: byId.id, displayName: byId.displayName || byId.id };

  const lower = q.toLowerCase();

  // Exact display-name match (case-insensitive) wins outright.
  const exact = players.filter((p) => (p.displayName || "").toLowerCase() === lower);
  if (exact.length === 1) {
    return { kind: "ok", playerId: exact[0].id, displayName: exact[0].displayName || exact[0].id };
  }
  if (exact.length > 1) {
    return { kind: "ambiguous", candidates: exact.map(toCandidate) };
  }

  // Substring match (first name, partial, etc.).
  const partial = players.filter((p) => (p.displayName || "").toLowerCase().includes(lower));
  if (partial.length === 1) {
    return { kind: "ok", playerId: partial[0].id, displayName: partial[0].displayName || partial[0].id };
  }
  if (partial.length > 1) {
    return { kind: "ambiguous", candidates: partial.map(toCandidate) };
  }

  return { kind: "notFound", query: input };
}

function toCandidate(p: PlayerDoc): { playerId: string; displayName: string } {
  return { playerId: p.id, displayName: p.displayName || p.id };
}
