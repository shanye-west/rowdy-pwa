import type { ReactNode } from "react";

/**
 * The square leading tile on admin list rows — "Day 2", "Rd 7", a match
 * number. One component so every list numbers its rows the same way.
 */
export default function IndexTile({ label, value }: { label?: string; value: ReactNode }) {
  return (
    <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-muted text-center">
      {label && (
        <span className="text-[0.5rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      )}
      <span className="text-xs font-bold leading-none text-foreground">{value}</span>
    </div>
  );
}
