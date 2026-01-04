import { memo, useCallback, useMemo, type CSSProperties } from "react";
import { ScoreNumberPicker } from "./ScoreNumberPicker";

/** Props for ScoreInputCell */
export interface ScoreInputCellProps {
  holeKey: string;
  holeNum: number;
  value: number | "";
  par: number;
  locked: boolean;
  hasStroke: boolean;
  hasDrive: boolean;
  lowScoreStatus: 'solo' | 'tied' | null;
  /** CSS color string for the team (e.g. '#1e40af' or 'var(--team-a-default)') */
  teamColor: string;
  onChange: (holeKey: string, value: number | null) => void;
  /** When true, cell is for a post-match hole (after match was decided) - uses muted styling */
  isPostMatch?: boolean;
  /** When true, player is winning a skin on this hole (no ties) */
  hasSkinWin?: boolean;
  /** Unique cell identifier for popover targeting (e.g., 'teamA-p0-h1') */
  cellId?: string;
}

/** Memoized score input cell - prevents re-render unless props change */
export const ScoreInputCell = memo(function ScoreInputCell({
  holeKey,
  holeNum,
  value,
  par,
  locked,
  hasStroke,
  hasDrive,
  lowScoreStatus,
  teamColor,
  onChange,
  isPostMatch = false,
  hasSkinWin = false,
  cellId,
}: ScoreInputCellProps) {
  // Generate unique popover ID based on cellId (or fall back to holeKey)
  const popoverId = useMemo(() => `picker-${cellId || holeKey}`, [cellId, holeKey]);
  
  // Create a subtle tint using the passed teamColor. Use a darker tint for solo and lighter for tied.
  const tintPercent = lowScoreStatus === 'solo' ? '15%' : lowScoreStatus === 'tied' ? '5%' : null;
  const lowScoreStyle: CSSProperties | undefined = tintPercent && teamColor
    ? (() => {
        const tint = `color-mix(in srgb, ${teamColor} ${tintPercent}, white)`;
        return {
          background: tint,
          borderColor: tint,
        } as CSSProperties;
      })()
    : undefined;

  // Calculate how many under par (only for birdies or better)
  const underPar = typeof value === 'number' && par ? par - value : 0;
  // Number of circles: 1 for birdie (1 under), 2 for eagle (2 under), etc.
  const circleCount = underPar > 0 ? underPar : 0;
  
  // Calculate how many over par (for bogeys and worse)
  const overPar = typeof value === 'number' && par ? value - par : 0;
  // Number of squares: 1 for bogey (1 over), 2 for double bogey (2 over), etc.
  const squareCount = overPar > 0 ? overPar : 0;
  
  // Handle number selection from picker
  const handleSelect = useCallback((num: number) => {
    onChange(holeKey, num);
    // Popover will auto-dismiss after selection with togglepopover
    const popover = document.getElementById(popoverId) as HTMLElement & { hidePopover?: () => void };
    if (popover?.hidePopover) {
      popover.hidePopover();
    }
  }, [holeKey, onChange, popoverId]);
  
  // Handle clear from picker
  const handleClear = useCallback(() => {
    onChange(holeKey, null);
    // Close popover
    const popover = document.getElementById(popoverId) as HTMLElement & { hidePopover?: () => void };
    if (popover?.hidePopover) {
      popover.hidePopover();
    }
  }, [holeKey, onChange, popoverId]);

  return (
    <div className="relative flex flex-col items-center">
      {/* Score display cell - tap to open picker */}
      <button
        type="button"
        aria-label={`Score for hole ${holeNum}${value ? `: ${value}` : ''}`}
        popoverTarget={popoverId}
        className={`
          w-11 h-11 text-center text-base font-semibold rounded-md border
          transition-colors duration-100 select-none
          ${isPostMatch
            ? "bg-slate-50 text-slate-400 border-slate-200"
            : locked 
              ? "bg-slate-50 text-slate-600 border-slate-200 cursor-default" 
              : "bg-white border-slate-200 hover:border-slate-300 active:bg-slate-100"
          }
        `}
        disabled={locked}
        style={lowScoreStyle}
      >
        {value !== "" ? value : ""}
      </button>
      
      {/* Number picker popover - uses Popover API with anchor positioning */}
      <ScoreNumberPicker
        id={popoverId}
        value={value}
        onSelect={handleSelect}
        onClear={handleClear}
      />
      {/* Birdie/Eagle circles - centered over input */}
      {circleCount > 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {/* Outer circles for eagle+ (2+ under par) */}
          {circleCount >= 2 && (
            <div
              className="absolute rounded-full"
              style={{ width: '32px', height: '32px', borderWidth: '1px', borderColor: isPostMatch ? '#cbd5e1' : '#000000', borderStyle: 'solid' }}
            />
          )}
          {circleCount >= 3 && (
            <div
              className="absolute rounded-full"
              style={{ width: '24px', height: '24px', borderWidth: '1px', borderColor: isPostMatch ? '#cbd5e1' : '#000000', borderStyle: 'solid' }}
            />
          )}
          {circleCount >= 4 && (
            <div
              className="absolute rounded-full"
              style={{ width: '20px', height: '20px', borderWidth: '1px', borderColor: isPostMatch ? '#cbd5e1' : '#000000', borderStyle: 'solid' }}
            />
          )}
          {/* Inner circle for birdie (always shown when under par) */}
          <div
            className="absolute rounded-full"
            style={{ width: '28px', height: '28px', borderWidth: '1px', borderColor: isPostMatch ? '#cbd5e1' : '#000000', borderStyle: 'solid' }}
          />
        </div>
      )}
      
      {/* Bogey/Double Bogey squares - centered over input */}
      {squareCount > 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {/* Outer squares for double bogey+ (2+ over par) */}
          {squareCount >= 2 && (
            <div
              className="absolute"
              style={{ width: '32px', height: '32px', borderWidth: '1px', borderColor: isPostMatch ? '#cbd5e1' : '#000000', borderStyle: 'solid', borderRadius: '3px' }}
            />
          )}
          {squareCount >= 3 && (
            <div
              className="absolute"
              style={{ width: '24px', height: '24px', borderWidth: '1px', borderColor: isPostMatch ? '#cbd5e1' : '#000000', borderStyle: 'solid', borderRadius: '3px' }}
            />
          )}
          {squareCount >= 4 && (
            <div
              className="absolute"
              style={{ width: '20px', height: '20px', borderWidth: '1px', borderColor: isPostMatch ? '#cbd5e1' : '#000000', borderStyle: 'solid', borderRadius: '3px' }}
            />
          )}
          {/* Inner square for bogey (always shown when over par) */}
          <div
            className="absolute"
            style={{ width: '28px', height: '28px', borderWidth: '1px', borderColor: isPostMatch ? '#cbd5e1' : '#000000', borderStyle: 'solid', borderRadius: '3px' }}
          />
        </div>
      )}
      
      {hasStroke && (
        <div className="absolute top-1 right-1 w-2 h-2 bg-sky-400 rounded-full"></div>
      )}
      {hasDrive && (
        <div className="absolute bottom-0.5 left-0.5 text-[8px] font-bold text-green-600">D</div>
      )}
      {hasSkinWin && !hasDrive && (
        <div className="absolute top-0.5 left-1 text-[8px] font-bold text-amber-500">$</div>
      )}
    </div>
  );
});
