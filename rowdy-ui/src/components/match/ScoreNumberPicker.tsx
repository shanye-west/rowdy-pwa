import { memo, useState, useCallback, useRef } from "react";

export interface ScoreNumberPickerProps {
  value: number | "";
  onSelect: (value: number) => void;
  onClear: () => void;
  id: string;
}

/** Custom number picker for score entry - 3x3 grid (1-9) with expandable 10-15 */
export const ScoreNumberPicker = memo(function ScoreNumberPicker({
  value,
  onSelect,
  onClear,
  id,
}: ScoreNumberPickerProps) {
  const [showExtended, setShowExtended] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Trigger haptic feedback
  const haptic = useCallback(() => {
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  }, []);

  const handleNumberClick = useCallback((num: number) => {
    haptic();
    onSelect(num);
  }, [haptic, onSelect]);

  const handleClear = useCallback(() => {
    haptic();
    onClear();
  }, [haptic, onClear]);

  const toggleExtended = useCallback(() => {
    haptic();
    setShowExtended((prev) => !prev);
  }, [haptic]);

  // Common button styles
  const buttonBase = "flex items-center justify-center text-lg font-semibold rounded-lg transition-all duration-100 active:scale-95 select-none";
  const buttonSize = "w-12 h-12"; // 48px - good touch target
  const buttonNormal = "bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 active:bg-slate-100";
  const buttonSelected = "bg-blue-500 border border-blue-500 text-white";
  const buttonSpecial = "bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 active:bg-slate-300";

  const isSelected = (num: number) => value === num;

  return (
    <div
      ref={pickerRef}
      id={id}
      popover="auto"
      className="bg-white rounded-xl shadow-xl border border-slate-200 p-3 m-0"
      style={{ minWidth: "180px" }}
    >
      {/* Main 3x3 grid (1-9) */}
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            type="button"
            className={`${buttonBase} ${buttonSize} ${isSelected(num) ? buttonSelected : buttonNormal}`}
            onClick={() => handleNumberClick(num)}
          >
            {num}
          </button>
        ))}
      </div>

      {/* Bottom row: Clear button + spacer + More button */}
      <div className="grid grid-cols-3 gap-2 mt-2">
        <button
          type="button"
          className={`${buttonBase} ${buttonSize} ${buttonSpecial} text-sm`}
          onClick={handleClear}
          aria-label="Clear score"
        >
          Clear
        </button>
        <div /> {/* Empty spacer */}
        <button
          type="button"
          className={`${buttonBase} ${buttonSize} ${buttonSpecial} text-sm ${showExtended ? 'bg-slate-200' : ''}`}
          onClick={toggleExtended}
          aria-label={showExtended ? "Show fewer numbers" : "Show more numbers"}
        >
          {showExtended ? "Less" : "More"}
        </button>
      </div>

      {/* Extended numbers (10-15) - shown when expanded */}
      {showExtended && (
        <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-slate-200">
          {[10, 11, 12, 13, 14, 15].map((num) => (
            <button
              key={num}
              type="button"
              className={`${buttonBase} ${buttonSize} ${isSelected(num) ? buttonSelected : buttonNormal} text-base`}
              onClick={() => handleNumberClick(num)}
            >
              {num}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
