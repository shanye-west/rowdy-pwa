/**
 * The "review your bet" confirmation step shown before a wager is posted — the
 * single screen that makes the flow feel like a real sportsbook. Presentational
 * only: the parent owns the submit state and the API call. Rendered as an
 * in-place step inside the bet sheet (BetSheet).
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
      <div className="text-center text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Review your bet
      </div>
      {contextLabel && <div className="text-center text-sm text-muted-foreground">{contextLabel}</div>}

      <div className="space-y-3 rounded-xl border border-border bg-muted p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Backing</span>
          <span className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: sideColor }} />
            <span className="truncate">{sideLabel}</span>
            {sideTag && sideTag !== sideLabel && <span className="shrink-0 text-muted-foreground">({sideTag})</span>}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Stake</span>
          <span className="font-bold tabular-nums text-foreground">${amount}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">To win</span>
          <span className="text-lg font-bold tabular-nums text-emerald-600">${amount}</span>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {directed
          ? `Challenge to ${targetName || "your pick"} — both of you confirm to lock it in.`
          : "Open to anyone — both of you confirm to lock it in."}
      </p>

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex-1 rounded-lg bg-muted px-4 py-2.5 text-sm font-semibold text-foreground transition-transform active:scale-95 hover:bg-muted disabled:opacity-60"
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
