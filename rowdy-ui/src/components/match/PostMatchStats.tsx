import type { RoundFormat, PlayerMatchFact } from "../../types";

export type PostMatchStatsProps = {
  matchFacts: PlayerMatchFact[];
  format: RoundFormat;
  teamAPlayers: { playerId: string; strokesReceived: number[] }[];
  teamBPlayers: { playerId: string; strokesReceived: number[] }[];
  teamAName: string;
  teamBName: string;
  teamAColor: string;
  teamBColor: string;
  getPlayerName: (pid?: string) => string;
  marginHistory?: number[];
};

// Format +/- scores like golf standard: +5, -2, E (even)
function formatStrokesVsPar(value: number | undefined | null): string {
  if (value == null) return "–";
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : `${value}`;
}

export function PostMatchStats({
  matchFacts,
  format,
  teamAPlayers,
  teamBPlayers,
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
  getPlayerName,
  marginHistory,
}: PostMatchStatsProps) {
  // Get fact for a specific player
  const getFactForPlayer = (playerId: string): PlayerMatchFact | undefined => {
    return matchFacts.find(f => f.playerId === playerId);
  };

  // Compute largest lead from marginHistory
  const largestLeadA = marginHistory && marginHistory.length > 0 
    ? Math.max(0, ...marginHistory) 
    : 0;
  const largestLeadB = marginHistory && marginHistory.length > 0 
    ? Math.abs(Math.min(0, ...marginHistory)) 
    : 0;

  // Determine which stat categories apply to this format
  const showIndividualScoring = format === "twoManBestBall";
  const showTeamScoring = format === "twoManScramble" || format === "twoManShamble";
  const showBallUsage = format === "twoManBestBall" || format === "twoManShamble";
  const showDrives = format === "twoManScramble" || format === "twoManShamble";

  // Build player id lists
  const teamAPlayerIds: string[] = teamAPlayers.map(p => p.playerId);
  const teamBPlayerIds: string[] = teamBPlayers.map(p => p.playerId);

    const StatRow = ({ label, valueA, valueB, highlight = false, center = false }: { 
      label: string; 
      valueA: React.ReactNode; 
      valueB: React.ReactNode;
      highlight?: boolean;
      center?: boolean;
    }) => (
      <div className={`flex items-center gap-4 py-2 ${highlight ? "bg-slate-50 px-3 py-1 rounded-md" : ""}`}>
        <div className={`flex-1 ${center ? "text-right" : "text-right pr-3"} font-semibold text-sm`} style={{ color: teamAColor }}>
          {valueA != null ? valueA : "–"}
        </div>
        <div className="text-xs text-slate-500 font-medium text-center w-28 shrink-0 uppercase">
          {label}
        </div>
        <div className={`flex-1 ${center ? "text-left" : "text-left pl-3"} font-semibold text-sm`} style={{ color: teamBColor }}>
          {valueB != null ? valueB : "–"}
        </div>
      </div>
    );

  // Player names header row for per-player stat sections
  const PlayerNamesHeader = () => (
    <div className="flex items-center py-2 mb-2 border-b border-slate-100">
      <div className="flex-1 text-right pr-3">
        <span className="text-sm font-semibold truncate" style={{ color: teamAColor }}>
          {getPlayerName(teamAPlayerIds[0])}
        </span>
      </div>
      <div className="flex-1 text-right pr-3">
        <span className="text-sm font-semibold truncate" style={{ color: teamAColor }}>
          {getPlayerName(teamAPlayerIds[1])}
        </span>
      </div>
      <div className="w-28 shrink-0" />
      <div className="flex-1 text-left pl-3">
        <span className="text-sm font-semibold truncate" style={{ color: teamBColor }}>
          {getPlayerName(teamBPlayerIds[0])}
        </span>
      </div>
      <div className="flex-1 text-left pl-3">
        <span className="text-sm font-semibold truncate" style={{ color: teamBColor }}>
          {getPlayerName(teamBPlayerIds[1])}
        </span>
      </div>
    </div>
  );

  // Stat row for per-player stats (4 columns: 2 players per team)
  const PlayerStatRow = ({ label, teamA, teamB, highlight = false }: { 
    label: string; 
    teamA: React.ReactNode[];
    teamB: React.ReactNode[];
    highlight?: boolean;
  }) => (
    <div className={`flex items-center gap-4 py-2 ${highlight ? "bg-slate-50 px-3 py-1 rounded-md" : ""}`}>
      <div className="flex-1 text-right pr-1 font-semibold text-sm" style={{ color: teamAColor }}>
        {teamA[0] != null ? teamA[0] : "–"}
      </div>
      <div className="flex-1 text-right pr-3 font-semibold text-sm" style={{ color: teamAColor }}>
        {teamA[1] != null ? teamA[1] : "–"}
      </div>
      <div className="text-xs text-slate-500 font-medium text-center w-24 shrink-0">
        {label}
      </div>
      <div className="flex-1 text-left pl-3 font-semibold text-sm" style={{ color: teamBColor }}>
        {teamB[0] != null ? teamB[0] : "–"}
      </div>
      <div className="flex-1 text-left pl-1 font-semibold text-sm" style={{ color: teamBColor }}>
        {teamB[1] != null ? teamB[1] : "–"}
      </div>
    </div>
  );

  // Helper to render a combined value: number + smaller vs-par in parentheses
  const renderCombined = (total: number | undefined | null, vsPar: number | undefined | null) => {
    if (total == null) return null;
    return (
      <>
        <span className="font-semibold text-lg">{total}</span>
        <span className="text-sm text-slate-500 ml-2">({formatStrokesVsPar(vsPar)})</span>
      </>
    );
  };

  // Helper to shorten a full name to first-initial + last name (e.g. "J. Smith")
  const shortName = (fullName?: string) => {
    if (!fullName) return "";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const first = parts[0][0] || "";
    const last = parts[parts.length - 1] || "";
    return `${first}. ${last}`;
  };

  // Get aggregated stats for display
  const teamAFacts = teamAPlayerIds.map(id => getFactForPlayer(id)).filter(Boolean) as PlayerMatchFact[];
  const teamBFacts = teamBPlayerIds.map(id => getFactForPlayer(id)).filter(Boolean) as PlayerMatchFact[];

  if (teamAFacts.length === 0 && teamBFacts.length === 0) return null;

  // Get first fact from either team for match-level stats (they should be consistent)
  const sampleFact = teamAFacts[0] || teamBFacts[0];

  // Story stats
  const teamAWon = teamAFacts[0]?.outcome === "win";
  const teamBWon = teamBFacts[0]?.outcome === "win";
  const teamAComebackWin = teamAFacts[0]?.comebackWin;
  const teamBComebackWin = teamBFacts[0]?.comebackWin;
  const teamABlownLead = teamAFacts[0]?.blownLead;
  const teamBBlownLead = teamBFacts[0]?.blownLead;
  const teamANeverBehind = teamAFacts[0]?.wasNeverBehind && !teamBFacts[0]?.wasNeverBehind;
  const teamBNeverBehind = teamBFacts[0]?.wasNeverBehind && !teamAFacts[0]?.wasNeverBehind;
  
  // Clutch win: won on hole 18 (winningHole === 18 means decided on final hole)
  const clutchWinTeamA = teamAWon && sampleFact?.winningHole === 18;
  const clutchWinTeamB = teamBWon && sampleFact?.winningHole === 18;

  // Check if any story stats exist
  const hasStoryStats = teamAComebackWin || teamBComebackWin || teamABlownLead || teamBBlownLead || 
                        teamANeverBehind || teamBNeverBehind || clutchWinTeamA || clutchWinTeamB;

  // Story badge component
  const StoryBadge = ({ icon, title, description, teamColor }: { 
    icon: string; 
    title: string; 
    description: string;
    teamColor: string;
  }) => (
    <div className="flex items-start gap-2 py-2 px-3 bg-slate-50 rounded-lg">
      <span className="text-lg">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm" style={{ color: teamColor }}>{title}</div>
        <div className="text-xs text-slate-500">{description}</div>
      </div>
    </div>
  );

  // Centered match-level stat row
  const MatchLevelStat = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-center justify-center gap-2 py-1.5">
      <span className="text-slate-600 font-semibold">{value}</span>
      <span className="text-xs text-slate-500 font-medium">{label}</span>
    </div>
  );

  // --- SINGLES FORMAT ---
  if (format === "singles") {
    // Check if we have any stats to show
    const hasScoring = teamAFacts[0]?.totalGross != null || teamBFacts[0]?.totalGross != null;
    const hasLargestLead = largestLeadA > 0 || largestLeadB > 0;
    const hasLeadChanges = sampleFact?.leadChanges != null && sampleFact.leadChanges > 0;

    if (!hasScoring && !hasLargestLead && !hasLeadChanges && !hasStoryStats) return null;

    return (
      <div className="card p-4 space-y-4">
        <h3 className="text-sm font-bold uppercase text-slate-500 tracking-wide text-center">
          Match Stats
        </h3>

              {/* Player Headers (Singles) - show short player names (initial + last) in team colors */}
              <div className="flex items-center pb-2 border-b border-slate-200">
                <div className="flex-1 text-right pr-3">
                  <span className="text-sm font-semibold truncate" style={{ color: teamAColor }}>
                    {shortName(getPlayerName(teamAPlayerIds[0]))}
                  </span>
                </div>
                <div className="w-24 shrink-0" />
                <div className="flex-1 text-left pl-3">
                  <span className="text-sm font-semibold truncate" style={{ color: teamBColor }}>
                    {shortName(getPlayerName(teamBPlayerIds[0]))}
                  </span>
                </div>
              </div>

        {/* SCORING (Singles) */}
        {hasScoring && (
          <div>
            {/* Gross row (centered under player names) */}
            <StatRow
              label="Gross"
              valueA={renderCombined(teamAFacts[0]?.totalGross, teamAFacts[0]?.strokesVsParGross)}
              valueB={renderCombined(teamBFacts[0]?.totalGross, teamBFacts[0]?.strokesVsParGross)}
              center
            />

            {/* Net row (highlight, centered) */}
            <StatRow
              label="Net"
              valueA={renderCombined(teamAFacts[0]?.totalNet, teamAFacts[0]?.strokesVsParNet)}
              valueB={renderCombined(teamBFacts[0]?.totalNet, teamBFacts[0]?.strokesVsParNet)}
              highlight
              center
            />
          </div>
        )}

        {/* LARGEST LEAD */}
        {hasLargestLead && (
          <div className="border-t border-slate-200 pt-3">
            <StatRow 
              label="Largest Lead" 
              valueA={largestLeadA > 0 ? largestLeadA : null} 
              valueB={largestLeadB > 0 ? largestLeadB : null} 
            />
          </div>
        )}

        {/* MATCH-LEVEL STATS (centered) */}
        {hasLeadChanges && (
          <div className="border-t border-slate-200 pt-3">
            <MatchLevelStat label="Lead Changes" value={sampleFact?.leadChanges} />
          </div>
        )}

        {/* STORY STATS (conditional badges) */}
        {hasStoryStats && (
          <div className="border-t border-slate-200 pt-3 space-y-2">
            {clutchWinTeamA && (
              <StoryBadge 
                icon="⚡" 
                title="Clutch Win" 
                description="Won on 18 to take the match"
                teamColor={teamAColor}
              />
            )}
            {clutchWinTeamB && (
              <StoryBadge 
                icon="⚡" 
                title="Clutch Win" 
                description="Won on 18 to take the match"
                teamColor={teamBColor}
              />
            )}
            {teamAComebackWin && (
              <StoryBadge 
                icon="🔥" 
                title="Comeback Win" 
                description="Rallied from 3+ down on the back 9"
                teamColor={teamAColor}
              />
            )}
            {teamBComebackWin && (
              <StoryBadge 
                icon="🔥" 
                title="Comeback Win" 
                description="Rallied from 3+ down on the back 9"
                teamColor={teamBColor}
              />
            )}
            {teamABlownLead && (
              <StoryBadge 
                icon="💔" 
                title="Blown Lead" 
                description="Lost 3+ lead on the back 9"
                teamColor={teamAColor}
              />
            )}
            {teamBBlownLead && (
              <StoryBadge 
                icon="💔" 
                title="Blown Lead" 
                description="Lost 3+ lead on the back 9"
                teamColor={teamBColor}
              />
            )}
            {teamANeverBehind && (
              <StoryBadge 
                icon="🏆" 
                title="Never Behind" 
                description="Led or tied the entire match"
                teamColor={teamAColor}
              />
            )}
            {teamBNeverBehind && (
              <StoryBadge 
                icon="🏆" 
                title="Never Behind" 
                description="Led or tied the entire match"
                teamColor={teamBColor}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  // --- NON-SINGLES FORMATS (Best Ball, Scramble, Shamble) ---
  return (
    <div className="card p-4 space-y-4">
      <h3 className="text-sm font-bold uppercase text-slate-500 tracking-wide text-center">
        Match Stats
      </h3>

      {/* Team Headers */}
      <div className="flex items-center pb-2 border-b border-slate-200">
        <div className="flex-1 text-right pr-3">
          <span className="text-xs font-bold uppercase" style={{ color: teamAColor }}>{teamAName}</span>
        </div>
        <div className="w-24 shrink-0" />
        <div className="flex-1 text-left pl-3">
          <span className="text-xs font-bold uppercase" style={{ color: teamBColor }}>{teamBName}</span>
        </div>
      </div>

      {/* MATCH RESULT */}
      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
          Match Result
        </div>
        <StatRow 
          label="Holes Won" 
          valueA={teamAFacts[0]?.holesWon} 
          valueB={teamBFacts[0]?.holesWon} 
          highlight 
        />
        <StatRow 
          label="Holes Lost" 
          valueA={teamAFacts[0]?.holesLost} 
          valueB={teamBFacts[0]?.holesLost} 
        />
        <StatRow 
          label="Holes Halved" 
          valueA={teamAFacts[0]?.holesHalved} 
          valueB={teamBFacts[0]?.holesHalved} 
        />
        {marginHistory && marginHistory.length > 0 && (
          <StatRow 
            label="Largest Lead" 
            valueA={largestLeadA > 0 ? largestLeadA : "–"} 
            valueB={largestLeadB > 0 ? largestLeadB : "–"} 
          />
        )}
      </div>

      {/* INDIVIDUAL SCORING (Best Ball) */}
      {showIndividualScoring && (
        <div className="border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
            Scoring
          </div>
          <PlayerNamesHeader />
          <PlayerStatRow
            label="Gross"
            teamA={teamAFacts.map(f => renderCombined(f?.totalGross, f?.strokesVsParGross))}
            teamB={teamBFacts.map(f => renderCombined(f?.totalGross, f?.strokesVsParGross))}
          />
          <PlayerStatRow
            label="Net"
            teamA={teamAFacts.map(f => renderCombined(f?.totalNet, f?.strokesVsParNet))}
            teamB={teamBFacts.map(f => renderCombined(f?.totalNet, f?.strokesVsParNet))}
          />
          <PlayerStatRow
            label="Strokes Recv'd"
            teamA={teamAFacts.map(f => f.strokesGiven)}
            teamB={teamBFacts.map(f => f.strokesGiven)}
          />
        </div>
      )}

      {/* TEAM SCORING (Scramble & Shamble) */}
      {showTeamScoring && (
        <div className="border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
            Team Scoring
          </div>
          <StatRow 
            label="Team Gross" 
            valueA={teamAFacts[0]?.teamTotalGross} 
            valueB={teamBFacts[0]?.teamTotalGross} 
            highlight
          />
          <StatRow 
            label="vs Par" 
            valueA={formatStrokesVsPar(teamAFacts[0]?.teamStrokesVsParGross)} 
            valueB={formatStrokesVsPar(teamBFacts[0]?.teamStrokesVsParGross)} 
          />
        </div>
      )}

      {/* BALL USAGE (Best Ball & Shamble) */}
      {showBallUsage && (
        <div className="border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
            Ball Usage
          </div>
          <PlayerNamesHeader />
          <PlayerStatRow 
            label="Balls Used" 
            teamA={teamAFacts.map(f => f.ballsUsed)} 
            teamB={teamBFacts.map(f => f.ballsUsed)} 
          />
          <PlayerStatRow 
            label="Solo Balls" 
            teamA={teamAFacts.map(f => f.ballsUsedSolo)} 
            teamB={teamBFacts.map(f => f.ballsUsedSolo)} 
          />
          <PlayerStatRow 
            label="Shared Balls" 
            teamA={teamAFacts.map(f => f.ballsUsedShared)} 
            teamB={teamBFacts.map(f => f.ballsUsedShared)} 
          />
          <PlayerStatRow 
            label="Solo → Won" 
            teamA={teamAFacts.map(f => f.ballsUsedSoloWonHole)} 
            teamB={teamBFacts.map(f => f.ballsUsedSoloWonHole)} 
          />
          <PlayerStatRow 
            label="Solo → Halved" 
            teamA={teamAFacts.map(f => f.ballsUsedSoloPush)} 
            teamB={teamBFacts.map(f => f.ballsUsedSoloPush)} 
          />
        </div>
      )}

      {/* DRIVE USAGE (Scramble & Shamble) */}
      {showDrives && (
        <div className="border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
            Drives
          </div>
          <PlayerNamesHeader />
          <PlayerStatRow 
            label="Drives Used" 
            teamA={teamAFacts.map(f => f.drivesUsed)} 
            teamB={teamBFacts.map(f => f.drivesUsed)} 
          />
        </div>
      )}

      {/* MOMENTUM STATS (non-singles) */}
      <div className="border-t border-slate-200 pt-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
          Momentum
        </div>
        {sampleFact?.leadChanges != null && sampleFact.leadChanges > 0 && (
          <MatchLevelStat label="Lead Changes" value={sampleFact.leadChanges} />
        )}
        {hasStoryStats && (
          <div className="space-y-2 mt-2">
            {clutchWinTeamA && (
              <StoryBadge icon="⚡" title="Clutch Win" description="Won on 18 to take the match" teamColor={teamAColor} />
            )}
            {clutchWinTeamB && (
              <StoryBadge icon="⚡" title="Clutch Win" description="Won on 18 to take the match" teamColor={teamBColor} />
            )}
            {teamAComebackWin && (
              <StoryBadge icon="🔥" title="Comeback Win" description="Rallied from 3+ down on the back 9" teamColor={teamAColor} />
            )}
            {teamBComebackWin && (
              <StoryBadge icon="🔥" title="Comeback Win" description="Rallied from 3+ down on the back 9" teamColor={teamBColor} />
            )}
            {teamABlownLead && (
              <StoryBadge icon="💔" title="Blown Lead" description="Lost 3+ lead on the back 9" teamColor={teamAColor} />
            )}
            {teamBBlownLead && (
              <StoryBadge icon="💔" title="Blown Lead" description="Lost 3+ lead on the back 9" teamColor={teamBColor} />
            )}
            {teamANeverBehind && (
              <StoryBadge icon="🏆" title="Never Behind" description="Led or tied the entire match" teamColor={teamAColor} />
            )}
            {teamBNeverBehind && (
              <StoryBadge icon="🏆" title="Never Behind" description="Led or tied the entire match" teamColor={teamBColor} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PostMatchStats;