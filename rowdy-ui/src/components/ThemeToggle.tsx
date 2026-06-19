import { useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "../lib/utils";
import { getThemePref, setThemePref, type ThemePref } from "../lib/theme";

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Auto", Icon: Monitor },
];

/**
 * Segmented Light / Dark / Auto control for the header menu. Writes the choice
 * via the theme engine (which flips the `.dark` class) and reflects the saved
 * preference.
 */
export default function ThemeToggle() {
  // CSR-only app, so it's safe to read the persisted preference at init.
  const [pref, setPref] = useState<ThemePref>(getThemePref);

  const choose = (next: ThemePref) => {
    setPref(next);
    setThemePref(next);
  };

  return (
    <div className="px-2 pb-1">
      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex items-center gap-1 rounded-lg bg-muted/60 p-1"
      >
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = pref === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(value)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
