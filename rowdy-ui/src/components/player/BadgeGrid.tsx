import { memo } from "react";
import type { EarnedBadge } from "../../lib/badges";

/** Grid of earned achievement badges; shows a friendly hint when empty. */
export const BadgeGrid = memo(function BadgeGrid({ badges }: { badges: EarnedBadge[] }) {
  if (badges.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No badges yet — they unlock as you rack up comebacks, clutch wins, and birdies.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {badges.map((b) => (
        <li
          key={b.id}
          className={`flex items-start gap-2 rounded-xl border p-3 ${
            b.tone === "gold" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"
          }`}
        >
          <span className="text-2xl leading-none" aria-hidden="true">
            {b.emoji}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="truncate text-sm font-semibold text-slate-900">{b.label}</span>
              {b.count > 1 && (
                <span className="shrink-0 rounded-full bg-white/70 px-1.5 text-xs font-bold text-slate-600">
                  ×{b.count}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs leading-snug text-slate-500">{b.description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
});

export default BadgeGrid;
