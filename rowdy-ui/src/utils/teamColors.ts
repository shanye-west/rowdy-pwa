export type SeriesKey = "rowdyCup" | "christmasClassic" | string;
export type TeamKey = "teamA" | "teamB";

const DEFAULT_COLORS: Record<string, Record<TeamKey, string>> = {
  rowdyCup: { teamA: "#132448", teamB: "#bf203c" },
  christmasClassic: { teamA: "#00863c", teamB: "#ef211c" },
};

function isTruthyColor(v?: string | null): v is string {
  return !!v && v.trim().length > 0;
}

export function getTeamColor(series: SeriesKey | undefined, team: TeamKey, override?: string | null): string {
  if (isTruthyColor(override)) return override!.trim();
  const key = series === "christmasClassic" ? "christmasClassic" : "rowdyCup";
  return DEFAULT_COLORS[key][team];
}

export function ensureTournamentTeamColors<T extends { series?: SeriesKey; teamA?: any; teamB?: any }>(t: T | null): T | null {
  if (!t) return t;
  const series = t.series ?? "rowdyCup";
  const teamA = { ...(t.teamA ?? {}) };
  const teamB = { ...(t.teamB ?? {}) };

  teamA.color = getTeamColor(series, "teamA", teamA.color ?? null);
  teamB.color = getTeamColor(series, "teamB", teamB.color ?? null);

  return { ...t, teamA, teamB } as T;
}

export default ensureTournamentTeamColors;
