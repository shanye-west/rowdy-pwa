import type { RoundFormat, PlayerMatchFact } from "../../types";

// =============================================================================
// TYPES
// =============================================================================

export type PostMatchStatsProps = {
  matchFacts: PlayerMatchFact[];
  format: RoundFormat;
  teamAPlayers: { playerId: string; strokesReceived: number[] }[];
  teamBPlayers: { playerId: string; strokesReceived: number[] }[];
  teamAColor: string;
  teamBColor: string;
  getPlayerName: (pid?: string) => string;
  marginHistory?: number[];
  teamAName?: string;
  teamBName?: string;
};

// =============================================================================
// HELPERS
// =============================================================================

/** Format +/- scores like golf standard: +5, -2, E (even) */
function formatStrokesVsPar(value: number | undefined | null): string {
  if (value == null) return "–";
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : `${value}`;
}

/** Count birdies from holePerformance array (gross < par) */
function countBirdies(fact: PlayerMatchFact | undefined): number {
  if (!fact?.holePerformance) return 0;
  return fact.holePerformance.filter(hp => hp.gross != null && hp.par != null && hp.gross < hp.par).length;
}

/** Count eagles from holePerformance array (gross <= par-2) */
function countEagles(fact: PlayerMatchFact | undefined): number {
  if (!fact?.holePerformance) return 0;
  return fact.holePerformance.filter(hp => hp.gross != null && hp.par != null && (hp.gross - hp.par) <= -2).length;
}

/** Shorten full name to first-initial + last name (e.g. "J. Smith") */
function shortName(fullName?: string): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

/** Render score with vs-par in parentheses */
function renderScoreWithVsPar(total: number | undefined | null, vsPar: number | undefined | null) {
  if (total == null) return null;
  return (
    <>
      <span className="font-semibold text-lg">{total}</span>
      <span className="text-sm text-slate-500 ml-1">({formatStrokesVsPar(vsPar)})</span>
    </>
  );
}

// =============================================================================
// SHARED UI COMPONENTS
// =============================================================================

type TeamColors = { teamAColor: string; teamBColor: string };

/** Team-level stat row: valueA | LABEL | valueB */
function TeamStatRow({ label, valueA, valueB, teamAColor, teamBColor, highlight = false }: {
  label: string;
  valueA: React.ReactNode;
  valueB: React.ReactNode;
  highlight?: boolean;
} & TeamColors) {
  return (
    <div className={`flex items-center gap-4 py-2 ${highlight ? "bg-slate-50 px-3 rounded-md" : ""}`}>
      <div className="flex-1 text-right pr-3 font-semibold text-sm" style={{ color: teamAColor }}>
        {valueA ?? "–"}
      </div>
      <div className="text-xs text-slate-500 font-medium text-center w-28 shrink-0 uppercase">
        {label}
      </div>
      <div className="flex-1 text-left pl-3 font-semibold text-sm" style={{ color: teamBColor }}>
        {valueB ?? "–"}
      </div>
    </div>
  );
}

/** Match-level stat (centered, no team coloring) */
function MatchStat({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null) return null;
  return (
    <div className="flex items-center justify-center gap-2 py-2">
      <span className="text-slate-600 font-semibold">{value}</span>
      <span className="text-xs text-slate-500 font-medium">{label}</span>
    </div>
  );
}

/** Player names header for 2-man formats (4 columns) */
function PlayerNamesHeader({ teamANames, teamBNames, teamAColor, teamBColor }: {
  teamANames: [string, string];
  teamBNames: [string, string];
} & TeamColors) {
  return (
    <div className="flex items-center py-2 mb-1">
      <div className="flex-1 text-right pr-1">
        <span className="text-xs font-semibold truncate" style={{ color: teamAColor }}>{teamANames[0]}</span>
      </div>
      <div className="flex-1 text-right pr-2">
        <span className="text-xs font-semibold truncate" style={{ color: teamAColor }}>{teamANames[1]}</span>
      </div>
      <div className="w-16 shrink-0" />
      <div className="flex-1 text-left pl-2">
        <span className="text-xs font-semibold truncate" style={{ color: teamBColor }}>{teamBNames[0]}</span>
      </div>
      <div className="flex-1 text-left pl-1">
        <span className="text-xs font-semibold truncate" style={{ color: teamBColor }}>{teamBNames[1]}</span>
      </div>
    </div>
  );
}

/** Simple header that lists each team name (left/right) with a centered label */
function TeamNamesHeader({ teamAName, teamBName, teamAColor, teamBColor }: {
  teamAName?: string;
  teamBName?: string;
} & TeamColors) {
  return (
    <div className="flex items-center py-2 mb-2">
      <div className="flex-1 text-right pr-3 font-semibold text-sm" style={{ color: teamAColor }}>
        {teamAName ?? "Team A"}
      </div>
      <div className="text-xs text-slate-500 font-medium text-center w-28 shrink-0 uppercase">Team</div>
      <div className="flex-1 text-left pl-3 font-semibold text-sm" style={{ color: teamBColor }}>
        {teamBName ?? "Team B"}
      </div>
    </div>
  );
}

/** Player-level stat row for 2-man formats (4 columns: 2 per team) */
function PlayerStatRow({ label, teamA, teamB, teamAColor, teamBColor, highlight = false }: {
  label: string;
  teamA: [React.ReactNode, React.ReactNode];
  teamB: [React.ReactNode, React.ReactNode];
  highlight?: boolean;
} & TeamColors) {
  return (
    <div className={`flex items-center py-2 ${highlight ? "bg-slate-50 px-3 rounded-md" : ""}`}>
      <div className="flex-1 text-right pr-1 font-semibold text-sm" style={{ color: teamAColor }}>
        {teamA[0] ?? "–"}
      </div>
      <div className="flex-1 text-right pr-2 font-semibold text-sm" style={{ color: teamAColor }}>
        {teamA[1] ?? "–"}
      </div>
      <div className="text-xs text-slate-500 font-medium text-center w-16 shrink-0 uppercase">
        {label}
      </div>
      <div className="flex-1 text-left pl-2 font-semibold text-sm" style={{ color: teamBColor }}>
        {teamB[0] ?? "–"}
      </div>
      <div className="flex-1 text-left pl-1 font-semibold text-sm" style={{ color: teamBColor }}>
        {teamB[1] ?? "–"}
      </div>
    </div>
  );
}

/** Story badge for achievements */
function StoryBadge({ icon, title, description, teamColor, alignRight = false }: {
  icon: string;
  title: string;
  description: string;
  teamColor: string;
  alignRight?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 py-2 ${alignRight ? "flex-row-reverse text-right pr-3" : "pl-3"}`}>
      <span className="text-lg">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm" style={{ color: teamColor }}>{title}</div>
        <div className="text-xs text-slate-500">{description}</div>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function PostMatchStats({
  matchFacts,
  format,
  teamAPlayers,
  teamBPlayers,
  teamAColor,
  teamBColor,
  getPlayerName,
  marginHistory,
  teamAName,
  teamBName,
}: PostMatchStatsProps) {
  // ---------------------------------------------------------------------------
  // DATA EXTRACTION
  // ---------------------------------------------------------------------------
  
  const teamAPlayerIds = teamAPlayers.map(p => p.playerId);
  const teamBPlayerIds = teamBPlayers.map(p => p.playerId);
  
  const getFactForPlayer = (playerId: string) => matchFacts.find(f => f.playerId === playerId);
  
  const teamAFacts = teamAPlayerIds.map(getFactForPlayer).filter(Boolean) as PlayerMatchFact[];
  const teamBFacts = teamBPlayerIds.map(getFactForPlayer).filter(Boolean) as PlayerMatchFact[];
  
  if (teamAFacts.length === 0 && teamBFacts.length === 0) return null;
  
  // Use first fact for match-level stats (consistent across all players)
  const factA = teamAFacts[0];
  const factB = teamBFacts[0];
  
  // Compute derived stats from marginHistory
  const largestLeadA = marginHistory?.length ? Math.max(0, ...marginHistory) : 0;
  const largestLeadB = marginHistory?.length ? Math.abs(Math.min(0, ...marginHistory)) : 0;
  const wasAllSquareThru17 = marginHistory && marginHistory.length >= 17 && marginHistory[16] === 0;
  
  // Story/badge stats
  const teamAWon = factA?.outcome === "win";
  const teamBWon = factB?.outcome === "win";
  const clutchWinA = teamAWon && factA?.winningHole === 18 && wasAllSquareThru17;
  const clutchWinB = teamBWon && factB?.winningHole === 18 && wasAllSquareThru17;
  const comebackWinA = factA?.comebackWin;
  const comebackWinB = factB?.comebackWin;
  const neverBehindA = factA?.wasNeverBehind && !factB?.wasNeverBehind;
  const neverBehindB = factB?.wasNeverBehind && !factA?.wasNeverBehind;
  const jekyllHydeA = factA?.jekyllAndHyde;
  const jekyllHydeB = factB?.jekyllAndHyde;
  
  // Shared props
  const colors = { teamAColor, teamBColor };

  // ---------------------------------------------------------------------------
  // SINGLES FORMAT
  // ---------------------------------------------------------------------------
  
  if (format === "singles") {
    const birdiesA = countBirdies(factA);
    const eaglesA = countEagles(factA);
    const birdiesB = countBirdies(factB);
    const eaglesB = countEagles(factB);
    const hasScoring = factA?.totalGross != null || factB?.totalGross != null;
    const hasLeadChanges = (factA?.leadChanges ?? 0) > 0;
    const hasLargestLead = largestLeadA > 0 || largestLeadB > 0;
    const hasBirdies = birdiesA > 0 || birdiesB > 0;
    const hasEagles = eaglesA > 0 || eaglesB > 0;
    const hasBadges = clutchWinA || clutchWinB || comebackWinA || comebackWinB || neverBehindA || neverBehindB;
    
    if (!hasScoring && !hasLeadChanges && !hasLargestLead && !hasBirdies && !hasEagles && !hasBadges) return null;
    
    return (
      <div className="card p-0">
        {/* Player names header (compact: 1 per team) */}
        <div className="flex items-center py-2">
          <div className="flex-1 text-right pr-3">
            <span className="text-sm font-semibold truncate" style={{ color: teamAColor }}>
              {getPlayerName(teamAPlayerIds[0])}
            </span>
          </div>
          <div className="w-24 shrink-0" />
          <div className="flex-1 text-left pl-3">
            <span className="text-sm font-semibold truncate" style={{ color: teamBColor }}>
              {getPlayerName(teamBPlayerIds[0])}
            </span>
          </div>
        </div>

        {/* Scoring */}
        {hasScoring && (
          <>
            <TeamStatRow label="Gross" {...colors}
              valueA={renderScoreWithVsPar(factA?.totalGross, factA?.strokesVsParGross)}
              valueB={renderScoreWithVsPar(factB?.totalGross, factB?.strokesVsParGross)}
            />
            <TeamStatRow label="Net" {...colors} highlight
              valueA={renderScoreWithVsPar(factA?.totalNet, factA?.strokesVsParNet)}
              valueB={renderScoreWithVsPar(factB?.totalNet, factB?.strokesVsParNet)}
            />
          </>
        )}

        {/* Birdies */}
        {hasBirdies && (
          <TeamStatRow label="Birdies" {...colors}
            valueA={birdiesA > 0 ? birdiesA : null}
            valueB={birdiesB > 0 ? birdiesB : null}
          />
        )}

        {/* Eagles */}
        {hasEagles && (
          <TeamStatRow label="Eagles" {...colors}
            valueA={eaglesA > 0 ? eaglesA : null}
            valueB={eaglesB > 0 ? eaglesB : null}
          />
        )}

        {/* Match stats */}
        {hasLargestLead && (
          <TeamStatRow label="Largest Lead" {...colors}
            valueA={largestLeadA > 0 ? largestLeadA : null}
            valueB={largestLeadB > 0 ? largestLeadB : null}
          />
        )}
        {hasLeadChanges && <MatchStat label="Lead Changes" value={factA?.leadChanges} />}

        {/* Badges */}
        {clutchWinA && <StoryBadge icon="⚡" title="Clutch Win" description="Won on 18 to take the match" teamColor={teamAColor} />}
        {clutchWinB && <StoryBadge icon="⚡" title="Clutch Win" description="Won on 18 to take the match" teamColor={teamBColor} alignRight />}
        {comebackWinA && <StoryBadge icon="🔥" title="Comeback Win" description="Rallied from 3+ down on the back 9" teamColor={teamAColor} />}
        {comebackWinB && <StoryBadge icon="🔥" title="Comeback Win" description="Rallied from 3+ down on the back 9" teamColor={teamBColor} alignRight />}
        {neverBehindA && <StoryBadge icon="🏆" title="Never Behind" description="Led or tied the entire match" teamColor={teamAColor} />}
        {neverBehindB && <StoryBadge icon="🏆" title="Never Behind" description="Led or tied the entire match" teamColor={teamBColor} alignRight />}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // TWO-MAN FORMATS (Best Ball, Shamble, Scramble)
  // ---------------------------------------------------------------------------
  
  // Player name arrays for header
  const teamANames: [string, string] = [
    shortName(getPlayerName(teamAPlayerIds[0])),
    shortName(getPlayerName(teamAPlayerIds[1])),
  ];
  const teamBNames: [string, string] = [
    shortName(getPlayerName(teamBPlayerIds[0])),
    shortName(getPlayerName(teamBPlayerIds[1])),
  ];
  
  // Format-specific flags
  const isBestBall = format === "twoManBestBall";
  const isShamble = format === "twoManShamble";
  const isScramble = format === "twoManScramble";
  
  // What to show
  const showIndividualScoring = isBestBall; // Gross/Net per player
  const showTeamScoring = isShamble || isScramble; // Team Gross total
  const showHamAndEgg = isBestBall || isShamble;
  const showHoleResults = isScramble; // Holes Won/Lost/Halved only for scramble
  
  const hasLeadChanges = (factA?.leadChanges ?? 0) > 0;
  const hasBadges = clutchWinA || clutchWinB || comebackWinA || comebackWinB || 
                    neverBehindA || neverBehindB || jekyllHydeA || jekyllHydeB;

  // Player-level birdie/eagle counts
  const playerBirdies = [
    teamAFacts[0] ? (teamAFacts[0].birdies ?? 0) : 0,
    teamAFacts[1] ? (teamAFacts[1].birdies ?? 0) : 0,
    teamBFacts[0] ? (teamBFacts[0].birdies ?? 0) : 0,
    teamBFacts[1] ? (teamBFacts[1].birdies ?? 0) : 0,
  ];
  const playerEagles = [
    teamAFacts[0] ? (teamAFacts[0].eagles ?? 0) : 0,
    teamAFacts[1] ? (teamAFacts[1].eagles ?? 0) : 0,
    teamBFacts[0] ? (teamBFacts[0].eagles ?? 0) : 0,
    teamBFacts[1] ? (teamBFacts[1].eagles ?? 0) : 0,
  ];
  const anyBirdies = playerBirdies.some(v => v > 0);
  const anyEagles = playerEagles.some(v => v > 0);

  return (
    <div className="card p-0">
      
      {/* ===== SECTION 1: TEAM-LEVEL STATS ===== */}
      
      {/* Hole results (Scramble only) */}
      {showHoleResults && (
        <>
          <TeamStatRow label="Holes Won" {...colors} highlight valueA={factA?.holesWon} valueB={factB?.holesWon} />
          <TeamStatRow label="Holes Lost" {...colors} valueA={factA?.holesLost} valueB={factB?.holesLost} />
          <TeamStatRow label="Holes Halved" {...colors} valueA={factA?.holesHalved} valueB={factB?.holesHalved} />
          {(largestLeadA > 0 || largestLeadB > 0) && (
            <TeamStatRow label="Largest Lead" {...colors}
              valueA={largestLeadA > 0 ? largestLeadA : "–"}
              valueB={largestLeadB > 0 ? largestLeadB : "–"}
            />
          )}
        </>
      )}

      {/* Best Ball & Worst Ball totals (Best Ball & Shamble) */}
      {(isBestBall || isShamble) && (factA?.worstBallTotal != null || factB?.worstBallTotal != null) && (
        <>
          <TeamNamesHeader teamAName={teamAName} teamBName={teamBName} {...colors} />
          <TeamStatRow label="Worst Ball" {...colors} highlight
            valueA={factA?.worstBallTotal}
            valueB={factB?.worstBallTotal}
          />
          <TeamStatRow label="Best Ball" {...colors}
            valueA={factA?.bestBallTotal}
            valueB={factB?.bestBallTotal}
          />
        </>
      )}

      {/* Team scoring (Shamble & Scramble) */}
      {showTeamScoring && (
        <>
          <TeamStatRow label="Team Gross" {...colors} highlight
            valueA={factA?.teamTotalGross}
            valueB={factB?.teamTotalGross}
          />
          <TeamStatRow label="vs Par" {...colors}
            valueA={formatStrokesVsPar(factA?.teamStrokesVsParGross)}
            valueB={formatStrokesVsPar(factB?.teamStrokesVsParGross)}
          />
        </>
      )}

      {/* ===== SECTION 2: PLAYER-LEVEL STATS ===== */}
      
      {/* Individual scoring (Best Ball) */}
      {showIndividualScoring && (
        <>
          <PlayerNamesHeader teamANames={teamANames} teamBNames={teamBNames} {...colors} />
          <PlayerStatRow label="Gross" {...colors}
            teamA={[
              renderScoreWithVsPar(teamAFacts[0]?.totalGross, teamAFacts[0]?.strokesVsParGross),
              renderScoreWithVsPar(teamAFacts[1]?.totalGross, teamAFacts[1]?.strokesVsParGross),
            ]}
            teamB={[
              renderScoreWithVsPar(teamBFacts[0]?.totalGross, teamBFacts[0]?.strokesVsParGross),
              renderScoreWithVsPar(teamBFacts[1]?.totalGross, teamBFacts[1]?.strokesVsParGross),
            ]}
          />
          <PlayerStatRow label="Net" {...colors} highlight
            teamA={[
              renderScoreWithVsPar(teamAFacts[0]?.totalNet, teamAFacts[0]?.strokesVsParNet),
              renderScoreWithVsPar(teamAFacts[1]?.totalNet, teamAFacts[1]?.strokesVsParNet),
            ]}
            teamB={[
              renderScoreWithVsPar(teamBFacts[0]?.totalNet, teamBFacts[0]?.strokesVsParNet),
              renderScoreWithVsPar(teamBFacts[1]?.totalNet, teamBFacts[1]?.strokesVsParNet),
            ]}
          />
          <PlayerStatRow label="Solo Balls" {...colors}
            teamA={[teamAFacts[0]?.ballsUsedSolo, teamAFacts[1]?.ballsUsedSolo]}
            teamB={[teamBFacts[0]?.ballsUsedSolo, teamBFacts[1]?.ballsUsedSolo]}
          />
          {/* Birdies */}
          {anyBirdies && (
            <PlayerStatRow label="Birdies" {...colors}
              teamA={[playerBirdies[0] > 0 ? playerBirdies[0] : null, playerBirdies[1] > 0 ? playerBirdies[1] : null]}
              teamB={[playerBirdies[2] > 0 ? playerBirdies[2] : null, playerBirdies[3] > 0 ? playerBirdies[3] : null]}
            />
          )}
          {/* Eagles */}
          {anyEagles && (
            <PlayerStatRow label="Eagles" {...colors}
              teamA={[playerEagles[0] > 0 ? playerEagles[0] : null, playerEagles[1] > 0 ? playerEagles[1] : null]}
              teamB={[playerEagles[2] > 0 ? playerEagles[2] : null, playerEagles[3] > 0 ? playerEagles[3] : null]}
            />
          )}
        </>
      )}

      {/* Solo balls + Drives (Shamble) */}
      {isShamble && (
        <>
          <PlayerNamesHeader teamANames={teamANames} teamBNames={teamBNames} {...colors} />
          <PlayerStatRow label="Solo Balls" {...colors}
            teamA={[teamAFacts[0]?.ballsUsedSolo, teamAFacts[1]?.ballsUsedSolo]}
            teamB={[teamBFacts[0]?.ballsUsedSolo, teamBFacts[1]?.ballsUsedSolo]}
          />
          <PlayerStatRow label="Drives Used" {...colors}
            teamA={[teamAFacts[0]?.drivesUsed, teamAFacts[1]?.drivesUsed]}
            teamB={[teamBFacts[0]?.drivesUsed, teamBFacts[1]?.drivesUsed]}
          />
        </>
      )}

      {/* Drives only (Scramble) */}
      {isScramble && (
        <>
          <PlayerNamesHeader teamANames={teamANames} teamBNames={teamBNames} {...colors} />
          <PlayerStatRow label="Drives Used" {...colors}
            teamA={[teamAFacts[0]?.drivesUsed, teamAFacts[1]?.drivesUsed]}
            teamB={[teamBFacts[0]?.drivesUsed, teamBFacts[1]?.drivesUsed]}
          />
        </>
      )}

      {/* ===== SECTION 3: TEAM COMPARISON STATS ===== */}
      {/* Visual separator + grouped team-wide stats */}
      {(showHamAndEgg || hasLeadChanges) && (
        <div className="mt-3 pt-3 border-t border-slate-200">
          <TeamNamesHeader teamAName={teamAName} teamBName={teamBName} {...colors} />
          {showHamAndEgg && (
            <TeamStatRow label="🍳 Ham & Eggs" {...colors}
              valueA={factA?.hamAndEggCount ?? 0}
              valueB={factB?.hamAndEggCount ?? 0}
            />
          )}
          {hasLeadChanges && <MatchStat label="Lead Changes" value={factA?.leadChanges} />}
        </div>
      )}

      {/* ===== SECTION 4: BADGES ===== */}
      
      {hasBadges && (
        <div className="pt-1">
          {jekyllHydeA && <StoryBadge icon="🎭" title="Jekyll & Hyde" description="Great Best Ball Team...Horrible Worst Ball Team" teamColor={teamAColor} />}
          {jekyllHydeB && <StoryBadge icon="🎭" title="Jekyll & Hyde" description="Great Best Ball Team...Horrible Worst Ball Team" teamColor={teamBColor} alignRight />}
          {clutchWinA && <StoryBadge icon="⚡" title="Clutch Win" description="Won on 18 to take the match" teamColor={teamAColor} />}
          {clutchWinB && <StoryBadge icon="⚡" title="Clutch Win" description="Won on 18 to take the match" teamColor={teamBColor} alignRight />}
          {comebackWinA && <StoryBadge icon="🔥" title="Comeback Win" description="Rallied from 3+ down on the back 9" teamColor={teamAColor} />}
          {comebackWinB && <StoryBadge icon="🔥" title="Comeback Win" description="Rallied from 3+ down on the back 9" teamColor={teamBColor} alignRight />}
          {neverBehindA && <StoryBadge icon="🏆" title="Never Behind" description="Led or tied the entire match" teamColor={teamAColor} />}
          {neverBehindB && <StoryBadge icon="🏆" title="Never Behind" description="Led or tied the entire match" teamColor={teamBColor} alignRight />}
        </div>
      )}
    </div>
  );
}

export default PostMatchStats;
