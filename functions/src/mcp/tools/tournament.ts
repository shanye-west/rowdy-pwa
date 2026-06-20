/**
 * Tournament-level tools: get_tournament (teams, rosters, live cup score) and
 * get_draft_pool (captain draft-analysis: pool handicaps joined with all-time stats).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getAllRealPlayers,
  getPlayerStats,
  getRoundsForTournament,
  getAllRecentRounds,
  resolveTournament,
  resolveSeries,
} from "../firestore.js";
import { jsonResult, errorResult } from "./util.js";
import type { RoundDoc, TeamSide, PlayerRecentRoundsDoc } from "../types.js";

function teamSummary(side: TeamSide | undefined, nameById: Map<string, string>) {
  if (!side) return null;
  const tiers = side.rosterByTier || {};
  const roster: Array<{ playerId: string; displayName: string; tier: string; handicap?: number }> = [];
  for (const tier of ["A", "B", "C", "D"] as const) {
    for (const pid of tiers[tier] || []) {
      roster.push({
        playerId: pid,
        displayName: nameById.get(pid) || pid,
        tier,
        handicap: side.handicapByPlayer?.[pid],
      });
    }
  }
  return {
    id: side.id,
    name: side.name,
    captainId: side.captainId,
    coCaptainId: side.coCaptainId,
    roster,
  };
}

function cupScore(rounds: RoundDoc[]) {
  let teamA = 0;
  let teamB = 0;
  let teamAPending = 0;
  let teamBPending = 0;
  for (const r of rounds) {
    const pt = r.pointTotals;
    if (!pt) continue;
    teamA += pt.teamAConfirmed || 0;
    teamB += pt.teamBConfirmed || 0;
    teamAPending += pt.teamAPending || 0;
    teamBPending += pt.teamBPending || 0;
  }
  return { teamA, teamB, teamAPending, teamBPending };
}

export function registerTournamentTools(server: McpServer): void {
  server.registerTool(
    "get_tournament",
    {
      title: "Get tournament",
      description:
        "The active tournament (or a given one): teams, rosters by tier with " +
        "handicaps, captains, and the current cup score from round point totals.",
      inputSchema: {
        tournamentId: z.string().optional().describe("Defaults to the active tournament."),
      },
    },
    async ({ tournamentId }) => {
      const t = await resolveTournament(tournamentId);
      if (!t) return errorResult("No tournament found (none active and no tournamentId given).");
      const players = await getAllRealPlayers();
      const nameById = new Map(players.map((p) => [p.id, p.displayName || p.id]));
      const rounds = await getRoundsForTournament(t.id);
      return jsonResult({
        id: t.id,
        name: t.name,
        year: t.year,
        series: t.series,
        active: t.active,
        tiebreakerWinner: t.tiebreakerWinner,
        totalPointsAvailable: t.totalPointsAvailable,
        cupScore: cupScore(rounds),
        roundCount: rounds.length,
        teamA: teamSummary(t.teamA, nameById),
        teamB: teamSummary(t.teamB, nameById),
        hasDraftPool: !!(t.draftPool && Object.keys(t.draftPool).length),
      });
    }
  );

  server.registerTool(
    "get_draft_pool",
    {
      title: "Get draft pool (captain analysis)",
      description:
        "The pre-draft pool of available players with their handicap index, joined " +
        "with each player's all-time Rowdy Cup stats (record, points, format " +
        "breakdown, badges) AND a compact recent-form summary from their last ~20 " +
        "GHIN rounds (average / recent / best score differential). Each player may also " +
        "carry a subjective free-text 'scoutingNotes' take (e.g. driving distance, " +
        "consistency, putting, temperament) — factor it into draft and pairing reasoning. " +
        "Built for captains doing draft analysis. Use get_player_recent_rounds for the full " +
        "round-by-round detail, and get_head_to_head / get_player_stats for pairing decisions.",
      inputSchema: {
        tournamentId: z.string().optional().describe("Defaults to the active tournament."),
        series: z
          .string()
          .optional()
          .describe("Series for the joined all-time stats (default active series)."),
      },
    },
    async ({ tournamentId, series }) => {
      const t = await resolveTournament(tournamentId);
      if (!t) return errorResult("No tournament found (none active and no tournamentId given).");
      const pool = t.draftPool || {};
      const poolIds = Object.keys(pool);
      if (poolIds.length === 0) {
        return jsonResult({
          tournamentId: t.id,
          note: "This tournament has no draft pool set.",
          pool: [],
        });
      }
      const seriesKey = await resolveSeries(series);
      const players = await getAllRealPlayers();
      // recentForm is enrichment — never let it break the core draft tool (e.g.
      // if the playerRecentRounds collection/rule isn't present yet).
      const recentByPlayer = await getAllRecentRounds().catch(
        (): Map<string, PlayerRecentRoundsDoc> => new Map()
      );
      const nameById = new Map(players.map((p) => [p.id, p.displayName || p.id]));
      const notesById = new Map(players.map((p) => [p.id, p.scoutingNotes]));

      const rows = await Promise.all(
        poolIds.map(async (pid) => {
          const s = await getPlayerStats(pid, "allTime", seriesKey);
          const rr = recentByPlayer.get(pid);
          return {
            playerId: pid,
            displayName: nameById.get(pid) || pid,
            handicapIndex: pool[pid],
            scoutingNotes: notesById.get(pid) || undefined,
            allTime: s
              ? {
                  wins: s.wins ?? 0,
                  losses: s.losses ?? 0,
                  halves: s.halves ?? 0,
                  points: s.points ?? 0,
                  matchesPlayed: s.matchesPlayed ?? 0,
                  formatBreakdown: s.formatBreakdown,
                  birdies: s.birdies,
                  eagles: s.eagles,
                  comebackWins: s.comebackWins,
                  blownLeads: s.blownLeads,
                  clutchWins: s.clutchWins,
                }
              : null,
            // Current off-course form from the last ~20 GHIN rounds. Lower
            // differential = better. Full detail via get_player_recent_rounds.
            recentForm: rr
              ? {
                  lowHandicapIndex: rr.lowHandicapIndex ?? null,
                  rounds: rr.summary?.rounds ?? rr.roundCount ?? null,
                  avgDifferential: rr.summary?.avgDifferential ?? null,
                  last5AvgDifferential: rr.summary?.last5AvgDifferential ?? null,
                  bestDifferential: rr.summary?.bestDifferential ?? null,
                }
              : null,
          };
        })
      );
      // Sort by handicap (lowest first) as a sensible default for draft view.
      rows.sort((a, b) => (a.handicapIndex ?? 99) - (b.handicapIndex ?? 99));
      return jsonResult({
        tournamentId: t.id,
        series: seriesKey,
        poolSize: rows.length,
        pool: rows,
      });
    }
  );
}
