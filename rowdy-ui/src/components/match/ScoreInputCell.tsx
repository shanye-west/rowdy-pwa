import { memo, useCallback, useMemo, type CSSProperties } from "react";
import { ScoreNumberPicker } from "./ScoreNumberPicker";
import { ScoreShapeOverlay } from "./ScoreShapeOverlay";

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
  /** When true, this hole's last save failed — show a retry affordance. */
  hasError?: boolean;
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
  hasError = false,
  cellId,
}: ScoreInputCellProps) {
  // Generate unique popover ID based on cellId (or fall back to holeKey)
  const popoverId = useMemo(() => `picker-${cellId || holeKey}`, [cellId, holeKey]);

  // Create a subtle tint using the passed teamColor. Use a darker tint for solo and lighter for tied.
  const tintPercent = lowScoreStatus === 'solo' ? '15%' : lowScoreStatus === 'tied' ? '5%' : null;
  const lowScoreStyle: CSSProperties | undefined = tintPercent && teamColor
    ? (() => {
        const tint = `color-mix(in srgb, ${teamColor} ${tintPercent}, var(--card-bg))`;
        return {
          background: tint,
          borderColor: tint,
        } as CSSProperties;
      })()
    : undefined;

  // Handle number selection from picker
  const handleSelect = useCallback((num: number) => {
    // Light haptic tick on score entry (Android; iOS Safari ignores it).
    navigator.vibrate?.(10);
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
        aria-label={`Score for hole ${holeNum}${value ? `: ${value}` : ''}${hasError ? ' — not saved, tap to retry' : ''}`}
        popoverTarget={popoverId}
        className={`
          w-11 h-11 text-center text-base font-semibold rounded-md border
          transition-colors duration-100 select-none
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1
          ${isPostMatch
            ? "bg-muted text-muted-foreground border-border"
            : locked
              ? "bg-muted text-muted-foreground border-border cursor-default"
              : "bg-card border-border hover:border-border active:bg-muted"
          }
          ${hasError ? " ring-2 ring-red-500 ring-offset-1" : ""}
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
      {/* Birdie/eagle circles and bogey squares - centered over input */}
      <ScoreShapeOverlay value={value} par={par} muted={isPostMatch} />

      {hasStroke && (
        <div className="absolute top-1 right-1 w-2 h-2 bg-sky-400 rounded-full"></div>
      )}
      {hasDrive && (
        <div className="absolute bottom-0.5 left-0.5 text-[8px] font-bold text-green-600">D</div>
      )}
      {hasSkinWin && !hasDrive && (
        <div className="absolute top-0.5 left-1 text-[8px] font-bold text-amber-500">$</div>
      )}
      {/* Failed-save indicator: visible cue (paired with the red ring + aria-label)
          so sighted users know to tap and retry. */}
      {hasError && (
        <div
          className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold leading-none text-white shadow"
          aria-hidden="true"
        >
          !
        </div>
      )}
    </div>
  );
});
