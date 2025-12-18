import { Link } from "react-router-dom";
import { formatRoundType } from "../../utils";
import { MatchStatusBadge, getMatchCardStyles } from "../MatchStatusBadge";
import type { MatchDoc, TournamentDoc, RoundFormat } from "../../types";

type MatchStatusHeaderProps = {
  format: RoundFormat;
  match: MatchDoc;
  tournament: TournamentDoc | null;
  editBlockReason: string | null;
  roundLocked: boolean;
  isMatchClosed: boolean;
  onOpenStrokesInfo: () => void;
};

export function MatchStatusHeader({
  format,
  match,
  tournament,
  editBlockReason,
  roundLocked,
  isMatchClosed,
  onOpenStrokesInfo,
}: MatchStatusHeaderProps) {
  const teamAColor = tournament?.teamA?.color || "var(--team-a-default)";
  const teamBColor = tournament?.teamB?.color || "var(--team-b-default)";

  return (
    <div className="space-y-3">
      {/* Top row: centered format pill with auth status on the right */}
      <div className="relative">
        {/* Strokes Info label with tappable superscript icon (entire area is clickable) */}
        <button
          onClick={onOpenStrokesInfo}
          aria-label="Open strokes info"
          className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center px-2 py-1 rounded"
        >
          <span className="text-sm text-slate-700">Strokes</span>
          <span className="ml-1 w-4 h-4 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[0.6rem] relative -top-1" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <circle cx="12" cy="16" r="1" />
            </svg>
          </span>
        </button>
        
        <div className="flex justify-center">
          <div 
            className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium"
            style={{ backgroundColor: "#f1f5f9", color: "#64748b" }}
          >
            <span>{formatRoundType(format)}</span>
          </div>
        </div>

        {/* Auth status - positioned to the right, inline with pill */}
        {editBlockReason && (editBlockReason === "historical" || (!roundLocked && !isMatchClosed)) && (
          <div className="absolute right-0 top-1/2 -translate-y-1/2 text-xs pr-2" style={{ color: "#94a3b8" }}>
            {editBlockReason === "historical" && (
              <span> View only</span>
            )}
            {editBlockReason === "login" && (
              <Link to="/login" className="underline hover:text-slate-600">Login to edit</Link>
            )}
            {editBlockReason === "not-rostered" && (
              <span>👀 Spectating</span>
            )}
          </div>
        )}
      </div>
      
      {/* Main status display - uses shared MatchStatusBadge component */}
      {(() => {
        const { bgStyle, borderStyle } = getMatchCardStyles(
          match.status,
          match.result,
          teamAColor,
          teamBColor
        );

        return (
          <div 
            className="card"
            role="status"
            aria-label="Match status"
            style={{ 
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '12px 16px',
              ...bgStyle,
              ...borderStyle
            }}
          >
            <MatchStatusBadge
              status={match.status}
              result={match.result}
              teamAColor={teamAColor}
              teamBColor={teamBColor}
              teamAName={tournament?.teamA?.name}
              teamBName={tournament?.teamB?.name}
              teeTime={match?.teeTimeLocalIso ?? match?.teeTime}
            />
          </div>
        );
      })()}
    </div>
  );
}
