import { memo, useState, useCallback, useRef, useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";

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

  // Arrow-key navigation across the number grid (3 columns).
  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const buttons = Array.from(
      pickerRef.current?.querySelectorAll<HTMLButtonElement>("button[data-pick]") ?? []
    );
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const cols = 3;
    let next = current < 0 ? 0 : current;
    if (e.key === "ArrowRight") next = Math.min(buttons.length - 1, current + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (e.key === "ArrowDown") next = Math.min(buttons.length - 1, current + cols);
    else if (e.key === "ArrowUp") next = Math.max(0, current - cols);
    e.preventDefault();
    buttons[next]?.focus();
  }, []);

  // Focus the selected (or first) number when the popover opens, for keyboard users.
  useEffect(() => {
    const el = pickerRef.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      if ((e as Event & { newState?: string }).newState !== "open") return;
      requestAnimationFrame(() => {
        const target =
          el.querySelector<HTMLButtonElement>('button[data-pick][data-selected="true"]') ??
          el.querySelector<HTMLButtonElement>("button[data-pick]");
        target?.focus();
      });
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, []);

  // Common button styles
  const buttonBase = "flex items-center justify-center text-lg font-semibold rounded-lg transition-all duration-100 active:scale-95 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1";
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
      onKeyDown={handleKeyDown}
      className="bg-white rounded-xl shadow-xl border border-slate-200 p-3 m-0"
      style={{ minWidth: "180px" }}
    >
      {/* Main 3x3 grid (1-9) */}
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            type="button"
            data-pick
            data-selected={isSelected(num)}
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
              data-pick
              data-selected={isSelected(num)}
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
