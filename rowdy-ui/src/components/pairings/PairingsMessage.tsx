import type { ReactNode } from "react";

export interface PairingsMessageProps {
  /** Lucide (or any) icon node, rendered in a soft circle. */
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  /** Optional call-to-action (button / link). */
  action?: ReactNode;
}

/**
 * Friendly centered state for the pairings page — used for the captains-only
 * gate, "no draft yet", missing format/course, and load errors. Replaces the
 * old terse one-liners.
 */
export default function PairingsMessage({ icon, title, children, action }: PairingsMessageProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-12 text-center">
      {icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {children && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>}
      {action && <div className="mt-5 w-full">{action}</div>}
    </div>
  );
}
