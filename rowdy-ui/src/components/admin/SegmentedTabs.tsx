import { cn } from "../../lib/utils";

export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
  /** Tints the tab red while selected — for a "Danger" tab. */
  danger?: boolean;
}

/** Segmented control used for in-page tabs and list filters. */
export default function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: SegmentedTab<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex gap-1 rounded-xl bg-muted/60 p-1">
      {tabs.map((t) => {
        const selected = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.id)}
            className={cn(
              "min-h-9 flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
              selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              selected && t.danger && "text-destructive"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
