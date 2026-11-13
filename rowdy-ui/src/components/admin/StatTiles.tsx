import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface StatTile {
  label: string;
  value: ReactNode;
  /** Small line under the value. */
  detail?: ReactNode;
  tone?: "default" | "good" | "warning";
}

/** A row of at-a-glance numbers at the top of an admin page. */
export default function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm">
          <dt className="truncate text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
            {t.label}
          </dt>
          <dd
            className={cn(
              "mt-0.5 text-lg font-bold leading-tight tabular-nums",
              t.tone === "good" ? "text-emerald-700" : t.tone === "warning" ? "text-amber-700" : "text-foreground"
            )}
          >
            {t.value}
          </dd>
          {t.detail && <dd className="truncate text-[0.7rem] text-muted-foreground">{t.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}
