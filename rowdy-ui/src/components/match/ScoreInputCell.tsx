import { memo, useCallback, useState, useRef, useLayoutEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
}: ScoreInputCellProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [pickerPos, setPickerPos] = useState<{left: number; top: number} | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  
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
  
  // Handle cell tap to open picker
  const handleCellClick = useCallback(() => {
    if (!locked) {
      setShowPicker(true);
    }
  }, [locked]);
  
  // Handle number selection from picker
  const handleSelect = useCallback((num: number) => {
    onChange(holeKey, num);
    // Always close picker after any selection
    setShowPicker(false);
  }, [holeKey, onChange]);
  
  // Handle clear from picker
  const handleClear = useCallback(() => {
    onChange(holeKey, null);
    setShowPicker(false);
  }, [holeKey, onChange]);
  
  // Handle picker close
  const handleClose = useCallback(() => {
    setShowPicker(false);
  }, []);

  // When picker opens, compute its position relative to the viewport so we can portal it.
  useLayoutEffect(() => {
    if (showPicker && buttonRef.current) {
      const btnRect = buttonRef.current.getBoundingClientRect();
      // center horizontally in viewport
      const left = window.innerWidth / 2;
      // position directly below the tapped cell
      const top = btnRect.bottom + 8; // 8px gap below the cell
      setPickerPos({ left, top });
    } else {
      setPickerPos(null);
    }
  }, [showPicker]);

  return (
    <div className="relative flex flex-col items-center">
      {/* Score display cell - tap to open picker */}
      <button
        type="button"
        aria-label={`Score for hole ${holeNum}${value ? `: ${value}` : ''}`}
        ref={buttonRef}
        className={`
          w-11 h-11 text-center text-base font-semibold rounded-md border
          transition-colors duration-100 select-none
          ${isPostMatch
            ? "bg-slate-50 text-slate-400 border-slate-200"
            : locked 
              ? "bg-slate-50 text-slate-600 border-slate-200 cursor-default" 
              : "bg-white border-slate-200 hover:border-slate-300 active:bg-slate-100"
          }
          ${showPicker ? 'ring-2 ring-blue-400 shadow-lg z-30 scale-[1.02]' : ''}
        `}
        disabled={locked}
        onClick={handleCellClick}
        style={lowScoreStyle}
      >
        {value !== "" ? value : ""}
      </button>
      
      {/* Number picker popover */}
      {showPicker && pickerPos && createPortal(
        <div style={{ position: 'fixed', left: pickerPos.left, top: pickerPos.top, transform: 'translateX(-50%)', zIndex: 9999 }}>
          <ScoreNumberPicker
            value={value}
            onSelect={handleSelect}
            onClear={handleClear}
            onClose={handleClose}
          />
        </div>,
        document.body
      )}
      {/* Birdie/Eagle circles - centered over input */}
      {circleCount > 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {/* Outer circles for eagle+ (2+ under par) */}
          {circleCount >= 2 && (
            <div
              className="absolute rounded-full"
              style={{ width: '38px', height: '38px', borderColor: isPostMatch ? undefined : teamColor, borderStyle: 'solid' }}
            />
          )}
          {circleCount >= 3 && (
            <div
              className="absolute rounded-full"
              style={{ width: '42px', height: '42px', borderColor: isPostMatch ? undefined : teamColor, borderStyle: 'solid' }}
            />
          )}
          {circleCount >= 4 && (
            <div
              className="absolute rounded-full"
              style={{ width: '46px', height: '46px', borderColor: isPostMatch ? undefined : teamColor, borderStyle: 'solid' }}
            />
          )}
          {/* Inner circle for birdie (always shown when under par) */}
          <div
            className="absolute rounded-full"
            style={{ width: '34px', height: '34px', borderColor: isPostMatch ? undefined : teamColor, borderStyle: 'solid' }}
          />
        </div>
      )}
      {hasStroke && (
        <div className="absolute top-1 right-1 w-2 h-2 bg-sky-400 rounded-full"></div>
      )}
      {hasDrive && (
        <div className="absolute bottom-0.5 left-0.5 text-[8px] font-bold text-green-600">D</div>
      )}
    </div>
  );
});
