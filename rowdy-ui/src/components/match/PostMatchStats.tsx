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
  const showIndividualScoring = format === "singles" || format === "twoManBestBall";
  const showTeamScoring = format === "twoManScramble" || format === "twoManShamble";
  const showBallUsage = format === "twoManBestBall" || format === "twoManShamble";
  const showDrives = format === "twoManScramble" || format === "twoManShamble";

  // Build player lists
  const teamAPlayerIds = teamAPlayers.map(p => p.playerId);
  const teamBPlayerIds = teamBPlayers.map(p => p.playerId);

  // Stat row component for team-level stats (1 value per team)
  const StatRow = ({ label, valueA, valueB, highlight = false }: { 
    label: string; 
    valueA: React.ReactNode; 
    valueB: React.ReactNode;
    highlight?: boolean;
  }) => (
    <div className={`flex items-center py-1.5 ${highlight ? "bg-slate-50 -mx-2 px-2 rounded" : ""}`}>
      <div className="flex-1 text-right pr-3 font-semibold" style={{ color: teamAColor }}>
        {valueA != null ? valueA : "–"}
      </div>
      <div className="text-xs text-slate-500 font-medium text-center w-24 shrink-0">
        {label}
      </div>
      <div className="flex-1 text-left pl-3 font-semibold" style={{ color: teamBColor }}>
        {valueB != null ? valueB : "–"}
      </div>
    </div>
  );

  // Player names header row for per-player stat sections
  const PlayerNamesHeader = () => (
    <div className="flex items-center py-1 mb-1 border-b border-slate-100">
      <div className="flex-1 text-right pr-1">
        <span className="text-xs font-semibold truncate" style={{ color: teamAColor }}>
          {getPlayerName(teamAPlayerIds[0])}
        </span>
      </div>
      <div className="flex-1 text-right pr-3">
        <span className="text-xs font-semibold truncate" style={{ color: teamAColor }}>
          {getPlayerName(teamAPlayerIds[1])}
        </span>
      </div>
      <div className="w-24 shrink-0" />
      <div className="flex-1 text-left pl-3">
        <span className="text-xs font-semibold truncate" style={{ color: teamBColor }}>
          {getPlayerName(teamBPlayerIds[0])}
        </span>
      </div>
      <div className="flex-1 text-left pl-1">
        <span className="text-xs font-semibold truncate" style={{ color: teamBColor }}>
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
    <div className={`flex items-center py-1.5 ${highlight ? "bg-slate-50 -mx-2 px-2 rounded" : ""}`}>
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
        <span className="font-semibold">{total}</span>
        <span className="text-xs text-slate-500 ml-2">({formatStrokesVsPar(vsPar)})</span>
      </>
    );
  };

  // Get aggregated stats for display
  const teamAFacts = teamAPlayerIds.map(id => getFactForPlayer(id)).filter(Boolean) as PlayerMatchFact[];
  const teamBFacts = teamBPlayerIds.map(id => getFactForPlayer(id)).filter(Boolean) as PlayerMatchFact[];

  if (teamAFacts.length === 0 && teamBFacts.length === 0) return null;

  // Get first fact from either team for match-level stats (they should be consistent)
  const sampleFact = teamAFacts[0] || teamBFacts[0];

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
        <StatRow 
          label="Final Thru" 
          valueA={sampleFact?.finalThru} 
          valueB={sampleFact?.finalThru} 
        />
        {marginHistory && marginHistory.length > 0 && (
          <>
            <StatRow 
              label="Largest Lead" 
              valueA={largestLeadA > 0 ? largestLeadA : "–"} 
              valueB={largestLeadB > 0 ? largestLeadB : "–"} 
            />
          </>
        )}
      </div>

      {/* INDIVIDUAL SCORING (Singles & Best Ball) */}
      {showIndividualScoring && (
        <div className="border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
            Scoring
          </div>
          {format === "singles" ? (
            // Singles: one player per team (Gross shown first)
            <>
              {/* Gross row */}
              <StatRow
                label="Gross"
                valueA={renderCombined(teamAFacts[0]?.totalGross, teamAFacts[0]?.strokesVsParGross)}
                valueB={renderCombined(teamBFacts[0]?.totalGross, teamBFacts[0]?.strokesVsParGross)}
              />

              {/* Net row (highlight) */}
              <StatRow
                label="Net"
                valueA={renderCombined(teamAFacts[0]?.totalNet, teamAFacts[0]?.strokesVsParNet)}
                valueB={renderCombined(teamBFacts[0]?.totalNet, teamBFacts[0]?.strokesVsParNet)}
                highlight
              />

              <StatRow
                label="Strokes Received"
                valueA={teamAFacts[0]?.strokesGiven}
                valueB={teamBFacts[0]?.strokesGiven}
              />
            </>
          ) : (
            // Best Ball: two players per team
            <>
              <PlayerNamesHeader />
              {/* Gross row (per player) */}
              <PlayerStatRow
                label="Gross"
                teamA={teamAFacts.map(f => renderCombined(f?.totalGross, f?.strokesVsParGross))}
                teamB={teamBFacts.map(f => renderCombined(f?.totalGross, f?.strokesVsParGross))}
              />

              {/* Net row (per player) */}
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
            </>
          )}
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

      {/* MOMENTUM STATS (All formats) */}
      <div className="border-t border-slate-200 pt-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
          Momentum
        </div>
        <StatRow 
          label="Lead Changes" 
          valueA={sampleFact?.leadChanges} 
          valueB={sampleFact?.leadChanges} 
        />
        <StatRow 
          label="Never Behind" 
          valueA={teamAFacts[0]?.wasNeverBehind ? "✓" : "–"} 
          valueB={teamBFacts[0]?.wasNeverBehind ? "✓" : "–"} 
        />
        <StatRow 
          label="Comeback Win" 
          valueA={teamAFacts[0]?.comebackWin ? "✓" : "–"} 
          valueB={teamBFacts[0]?.comebackWin ? "✓" : "–"} 
        />
        <StatRow 
          label="Blown Lead" 
          valueA={teamAFacts[0]?.blownLead ? "✓" : "–"} 
          valueB={teamBFacts[0]?.blownLead ? "✓" : "–"} 
        />
        {sampleFact?.winningHole && (
          <StatRow 
            label="Closed on Hole" 
            valueA={sampleFact.winningHole} 
            valueB={sampleFact.winningHole} 
          />
        )}
      </div>
    </div>
  );
}

export default PostMatchStats;
