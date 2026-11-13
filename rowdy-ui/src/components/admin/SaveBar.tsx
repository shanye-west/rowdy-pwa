import type { ReactNode } from "react";

/**
 * Sticky save bar for long admin forms: a status line on the left, the save
 * button (passed as children) on the right. Stays in reach however far the
 * form scrolls.
 */
export default function SaveBar({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return (
    <div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-xl border border-border/70 bg-card/95 p-2 shadow-lg backdrop-blur">
      <span className="min-w-0 truncate pl-1 text-xs text-muted-foreground">{status}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
