/**
 * The "review your bet" confirmation step shown before a wager is posted — the
 * single screen that makes the flow feel like a real sportsbook. Presentational
 * only: the parent owns the submit state and the API call. Rendered inside a
 * Modal by the inline builder, and as an in-place step inside PlaceBetModal.
 */

interface BetSlipReviewProps {
  /** Context heading — the matchup, or "Cup Winner". */
  contextLabel: string;
  /** Label of the side being backed (player pairing or team name). */
  sideLabel: string;
  /** Optional team tag shown beside the side label. */
  sideTag?: string;
  /** Team color for the backed side. */
  sideColor: string;
  amount: number;
  directed: boolean;
  /** Name of the challenged player (directed challenges only). */
  targetName?: string;
  submitting: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

export default function BetSlipReview({
  contextLabel,
  sideLabel,
  sideTag,
  sideColor,
  amount,
  directed,
  targetName,
  submitting,
  onConfirm,
  onBack,
}: BetSlipReviewProps) {
  return (
    <div className="space-y-4">
      <div className="text-center text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-slate-400">
        Review your bet
      </div>
      {contextLabel && <div className="text-center text-sm text-slate-500">{contextLabel}</div>}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400">Backing</span>
          <span className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-900">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: sideColor }} />
            <span className="truncate">{sideLabel}</span>
            {sideTag && sideTag !== sideLabel && <span className="shrink-0 text-slate-400">({sideTag})</span>}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400">Stake</span>
          <span className="font-bold tabular-nums text-slate-900">${amount}</span>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 pt-3">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400">To win</span>
          <span className="text-lg font-bold tabular-nums text-emerald-600">${amount}</span>
        </div>
      </div>

      <p className="text-center text-xs text-slate-400">
        {directed
          ? `Challenge to ${targetName || "your pick"} — both of you confirm to lock it in.`
          : "Open to anyone — both of you confirm to lock it in."}
      </p>

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex-1 rounded-lg bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-transform active:scale-95 hover:bg-slate-300 disabled:opacity-60"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-transform active:scale-95 hover:bg-green-700 disabled:opacity-60"
        >
          {submitting ? "Posting…" : "Confirm bet"}
        </button>
      </div>
    </div>
  );
}
