import { Link } from "react-router-dom";
import { WifiOff } from "lucide-react";
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
  /**
   * Gross-only formats (scramble, shamble) don't use handicap strokes, so the
   * Strokes button is hidden for them. Defaults to shown.
   */
  showStrokesInfo?: boolean;
  /**
   * The silent offline-cache warm failed for this scorer, so their scorecard
   * may not load without signal. Rare by design — surfaces the prep checklist.
   */
  offlineNotReady?: boolean;
  onOpenOfflinePrep?: () => void;
};

export function MatchStatusHeader({
  format,
  match,
  tournament,
  editBlockReason,
  roundLocked,
  isMatchClosed,
  onOpenStrokesInfo,
  showStrokesInfo = true,
  offlineNotReady,
  onOpenOfflinePrep,
}: MatchStatusHeaderProps) {
  const teamAColor = tournament?.teamA?.color || "var(--team-a-default)";
  const teamBColor = tournament?.teamB?.color || "var(--team-b-default)";

  return (
    <div className="space-y-3">
      {/* Top row: Strokes | centered format pill | offline prep or auth status.
          A 3-column grid (rather than absolute positioning) keeps the side items
          from overlapping the pill on narrow phones. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {/* Strokes Info label with tappable superscript icon (entire area is clickable).
            Hidden on gross-only formats — the empty cell keeps the pill centered. */}
        {showStrokesInfo ? (
          <button
            onClick={onOpenStrokesInfo}
            aria-label="Open strokes info"
            className="justify-self-start flex h-6 items-center px-2 rounded"
          >
            <span className="text-sm text-foreground">Strokes</span>
            <span className="ml-1 w-4 h-4 rounded-full bg-muted text-foreground flex items-center justify-center text-[0.6rem] relative -top-1" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <circle cx="12" cy="16" r="1" />
              </svg>
            </span>
          </button>
        ) : (
          <div className="justify-self-start h-6" />
        )}

        <div
          className="justify-self-center inline-flex h-6 items-center whitespace-nowrap px-3 rounded-full text-xs font-medium"
          style={{ backgroundColor: "#f1f5f9", color: "#64748b" }}
        >
          <span>{formatRoundType(format)}</span>
        </div>

        <div className="justify-self-end">
          {offlineNotReady ? (
            <button
              type="button"
              onClick={onOpenOfflinePrep}
              aria-label="Not ready for offline — open the offline prep checklist"
              className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 bg-amber-100 px-2.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-200"
            >
              <WifiOff className="h-3.5 w-3.5" />
              Not ready for offline
            </button>
          ) : (
            /* Auth status - inline with the pill */
            editBlockReason && (editBlockReason === "historical" || (!roundLocked && !isMatchClosed)) && (
              <div className="text-xs pr-2" style={{ color: "#94a3b8" }}>
                {editBlockReason === "historical" && (
                  <span> View only</span>
                )}
                {editBlockReason === "login" && (
                  <Link to="/login" className="underline hover:text-muted-foreground">Login to edit</Link>
                )}
                {editBlockReason === "not-rostered" && (
                  <span>👀 Spectating</span>
                )}
              </div>
            )
          )}
        </div>
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
              teeTime={match?.teeTime}
            />
          </div>
        );
      })()}
    </div>
  );
}
