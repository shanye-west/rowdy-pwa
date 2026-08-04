/**
 * The app's standard section heading — the quiet, wide-tracked uppercase label
 * used above "Schedule" on the Tournament page and "Matches" on the Round page.
 * Extracted here so busier pages (the Sportsbook) can group content with the
 * same visual grammar instead of inventing their own headers.
 *
 * Deliberately not interactive and deliberately unadorned: no emoji, no chevron,
 * no count baked into the title. A count or badge goes in `trailing`.
 */

import type { ReactNode } from "react";

export interface SectionLabelProps {
  children: ReactNode;
  /** Optional right-aligned node — a count, a net badge, a link. */
  trailing?: ReactNode;
}

export default function SectionLabel({ children, trailing }: SectionLabelProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <h2 className="text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        {children}
      </h2>
      {trailing}
    </div>
  );
}
