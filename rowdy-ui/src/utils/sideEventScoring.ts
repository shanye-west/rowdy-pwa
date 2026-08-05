/**
 * Leaderboard + payout math for SIDE EVENTS (the optional, for-fun 9-hole
 * game — currently the 3-man scramble).
 *
 * This is deliberately independent of the match-play scoring in
 * utils/matchScoring.ts: a side event is stroke play across N free-form teams
 * with no handicaps, no points and no stats. Keeping it here as pure functions
 * means the leaderboard is computed client-side from the team docs — no Cloud
 * Function, no trigger, nothing that could ever touch Cup scoring.
 */

import type { SideEventNine, SideEventPayout, SideEventTeamDoc } from "../types";

/** Plausible-score guard, mirroring isValidGross in the match scoring path. */
const MIN_GROSS = 1;
const MAX_GROSS = 30;

export function isValidSideEventGross(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n) && n >= MIN_GROSS && n <= MAX_GROSS;
}

/** The nine real course hole numbers a side event plays. */
export function holeNumbersForNine(nine: SideEventNine): number[] {
  const start = nine === "back" ? 10 : 1;
  return Array.from({ length: 9 }, (_, i) => start + i);
}

export function nineLabel(nine: SideEventNine): string {
  return nine === "back" ? "Back 9" : "Front 9";
}

export type RankedSideEventTeam = {
  teamId: string;
  teamNumber: number;
  playerIds: string[];
  /** Sum of entered gross scores. */
  total: number;
  /** How many of the nine holes have a score. */
  thru: number;
  /**
   * Strokes vs par over the holes actually played, or null when the event has
   * no course (no pars to measure against).
   */
  toPar: number | null;
  /** 1-based finishing position; tied teams share the same rank. */
  rank: number;
  /** True when another team shares this rank. */
  tied: boolean;
};

/**
 * Rank teams for the leaderboard.
 *
 * Ordering is by strokes-vs-par over holes played, which is the honest live
 * ordering (a team thru 4 isn't beating a team thru 9 just by having a smaller
 * total) and collapses to plain total once everyone has finished the nine.
 * Ties break on more holes played, then team number, so the order is stable.
 *
 * With no course (and therefore no pars), it falls back to ranking by raw
 * total among teams that have played the same number of holes.
 *
 * @param teams the event's team docs
 * @param parByHole map of course hole number -> par; empty when no course is set
 */
export function rankSideEventTeams(
  teams: SideEventTeamDoc[],
  parByHole: Record<number, number>,
  nine: SideEventNine
): RankedSideEventTeam[] {
  const holes = holeNumbersForNine(nine);
  const hasPars = holes.some((h) => typeof parByHole[h] === "number");

  const scored = teams.map((team) => {
    let total = 0;
    let thru = 0;
    let parPlayed = 0;
    for (const hole of holes) {
      const gross = team.holes?.[String(hole)]?.gross;
      if (!isValidSideEventGross(gross)) continue;
      total += gross;
      thru += 1;
      const par = parByHole[hole];
      if (typeof par === "number") parPlayed += par;
    }
    return {
      teamId: team.id,
      teamNumber: team.teamNumber ?? 0,
      playerIds: team.playerIds ?? [],
      total,
      thru,
      toPar: hasPars && thru > 0 ? total - parPlayed : null,
      rank: 0,
      tied: false,
    };
  });

  // Teams with no score yet always sort last, whatever the metric.
  const sortKey = (t: (typeof scored)[number]) =>
    hasPars && t.toPar !== null ? t.toPar : t.total;

  scored.sort((a, b) => {
    if (a.thru === 0 && b.thru === 0) return a.teamNumber - b.teamNumber;
    if (a.thru === 0) return 1;
    if (b.thru === 0) return -1;
    const keyDiff = sortKey(a) - sortKey(b);
    if (keyDiff !== 0) return keyDiff;
    if (a.thru !== b.thru) return b.thru - a.thru; // further along wins the tiebreak
    return a.teamNumber - b.teamNumber;
  });

  // Assign competition ranks (1, 2, 2, 4). Teams with nothing entered are all
  // unranked-but-listed at the bottom and share the same rank.
  let previousKey: string | null = null;
  let previousRank = 0;
  scored.forEach((team, index) => {
    const key = team.thru === 0 ? "none" : `${sortKey(team)}|${team.thru}`;
    if (key === previousKey) {
      team.rank = previousRank;
    } else {
      team.rank = index + 1;
      previousKey = key;
      previousRank = team.rank;
    }
  });

  const rankCounts = new Map<number, number>();
  scored.forEach((t) => rankCounts.set(t.rank, (rankCounts.get(t.rank) ?? 0) + 1));
  scored.forEach((t) => {
    t.tied = (rankCounts.get(t.rank) ?? 0) > 1;
  });

  return scored;
}

export type SideEventTeamPayout = {
  /** Dollars this team collects. */
  amount: number;
  /** True when the amount is a split of pooled places. */
  shared: boolean;
};

/**
 * Work out what each team collects.
 *
 * Standard golf tie handling: teams tied for a paid place pool the money for
 * every place they occupy and split it evenly. Two teams tied for 1st with a
 * 1st/2nd payout of $150/$100 each take $125.
 *
 * Teams with no score entered are never paid.
 */
export function assignSideEventPayouts(
  ranked: RankedSideEventTeam[],
  payouts: SideEventPayout[] | undefined
): Record<string, SideEventTeamPayout> {
  const out: Record<string, SideEventTeamPayout> = {};
  if (!payouts || payouts.length === 0) return out;

  const amountForPlace = new Map<number, number>();
  for (const p of payouts) amountForPlace.set(p.place, p.amount);

  // Group by rank, preserving the leaderboard order.
  const groups = new Map<number, RankedSideEventTeam[]>();
  for (const team of ranked) {
    if (team.thru === 0) continue;
    const group = groups.get(team.rank);
    if (group) group.push(team);
    else groups.set(team.rank, [team]);
  }

  for (const [rank, group] of groups) {
    // A group of K teams tied at `rank` occupies places rank .. rank+K-1.
    let pool = 0;
    for (let place = rank; place < rank + group.length; place++) {
      pool += amountForPlace.get(place) ?? 0;
    }
    if (pool <= 0) continue;
    const each = pool / group.length;
    for (const team of group) {
      out[team.teamId] = { amount: each, shared: group.length > 1 };
    }
  }

  return out;
}

/** "$150" / "$62.50" — money for the podium, trimmed of pointless decimals. */
export function formatMoney(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** "1st" / "2nd" / "T3" */
export function formatPlace(rank: number, tied: boolean): string {
  if (tied) return `T${rank}`;
  const suffix = rank % 100 >= 11 && rank % 100 <= 13
    ? "th"
    : rank % 10 === 1
      ? "st"
      : rank % 10 === 2
        ? "nd"
        : rank % 10 === 3
          ? "rd"
          : "th";
  return `${rank}${suffix}`;
}

/** "+3" / "E" / "-2" */
export function formatToPar(toPar: number | null): string {
  if (toPar === null) return "";
  if (toPar === 0) return "E";
  return toPar > 0 ? `+${toPar}` : String(toPar);
}
