/**
 * Popup for placing a bet on a specific match (or the Cup), opened from a
 * "Bet Me" button on the Round / scorecard pages. The side you tapped is
 * preselected; you set the stake and whether it's an open marketplace offer or
 * a directed challenge, then post.
 */

import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Modal } from "./Modal";
import { useToast } from "../contexts/ToastContext";
import { betsApi } from "../api/bets";
import type { BetMarket, BetSide } from "../types";

const QUICK_AMOUNTS = [5, 10, 20, 50];
const STEP = 5;

export interface PlaceBetModalProps {
  isOpen: boolean;
  onClose: () => void;
  tournamentId: string;
  market: BetMarket;
  /** Required for match markets. */
  matchId?: string;
  /** Heading describing the matchup or "Cup Winner". */
  contextLabel: string;
  /** Player names (matches) or team names (Cup) for each side. */
  sideLabels: { teamA: string; teamB: string };
  /** Team display names, shown as a colored tag on each side. */
  teamTags: { teamA: string; teamB: string };
  /** Team brand colors (hex/CSS) for each side. */
  teamColors: { teamA: string; teamB: string };
  /** The side preselected by the tapped "Bet Me" button. */
  initialSide: BetSide;
  /** Roster (excluding self) for the challenge target picker. */
  rosterOptions: { id: string; name: string }[];
  /** Called after a bet is successfully posted. */
  onPosted?: () => void;
}

export default function PlaceBetModal({
  isOpen,
  onClose,
  tournamentId,
  market,
  matchId,
  contextLabel,
  sideLabels,
  teamTags,
  teamColors,
  initialSide,
  rosterOptions,
  onPosted,
}: PlaceBetModalProps) {
  const { showToast } = useToast();
  const [side, setSide] = useState<BetSide>(initialSide);
  const [amount, setAmount] = useState<number>(10);
  const [directed, setDirected] = useState(false);
  const [targetId, setTargetId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const sortedRoster = useMemo(
    () => [...rosterOptions].sort((a, b) => a.name.localeCompare(b.name)),
    [rosterOptions]
  );

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const canSubmit = amount > 0 && (!directed || !!targetId) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const base = { tournamentId, market, matchId, side, amount };
      if (directed) {
        await betsApi.createBetChallenge({ ...base, targetId });
        showToast({ variant: "success", message: "Challenge sent — both players confirm to lock it in." });
      } else {
        await betsApi.createBetOffer(base);
        showToast({ variant: "success", message: "Offer posted to the marketplace." });
      }
      onPosted?.();
      onClose();
    } catch (e) {
      showToast({ variant: "error", message: e instanceof Error ? e.message : "Couldn't post the bet" });
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Place a bet" ariaLabel="Place a bet">
      <div className="space-y-4">
        <div className="text-center text-sm text-slate-500">{contextLabel}</div>

        {/* Side picker — colored by team */}
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">You're backing</div>
          <div className="flex items-stretch gap-2">
            {(["teamA", "teamB"] as const).map((s) => {
              const selected = side === s;
              const color = teamColors[s];
              const showTag = teamTags[s] && teamTags[s] !== sideLabels[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  aria-pressed={selected}
                  style={
                    selected
                      ? { backgroundColor: color, borderColor: color }
                      : { borderLeftColor: color, borderLeftWidth: 4 }
                  }
                  className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected ? "text-white" : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  {showTag && (
                    <span
                      className="block text-[0.6rem] font-bold uppercase tracking-wide"
                      style={selected ? { color: "rgba(255,255,255,0.85)" } : { color }}
                    >
                      {teamTags[s]}
                    </span>
                  )}
                  <span className={`block text-sm font-semibold ${selected ? "text-white" : "text-slate-800"}`}>
                    {sideLabels[s]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Stake stepper + presets */}
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Stake (each side risks this)
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAmount((a) => Math.max(STEP, a - STEP))}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-700 active:scale-95"
              aria-label="Decrease stake"
            >
              <Minus className="h-4 w-4" />
            </button>
            <div className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white py-2">
              <span className="text-lg font-bold text-slate-400">$</span>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="w-20 bg-transparent text-center text-lg font-bold text-slate-900 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setAmount((a) => a + STEP)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-700 active:scale-95"
              aria-label="Increase stake"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            {QUICK_AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAmount(a)}
                className={`flex-1 rounded-full px-2 py-1 text-xs font-semibold transition-colors ${
                  amount === a ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                ${a}
              </button>
            ))}
          </div>
        </div>

        {/* Offer vs challenge */}
        <div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDirected(false)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                !directed ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              Open offer
            </button>
            <button
              type="button"
              onClick={() => setDirected(true)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                directed ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              Challenge a player
            </button>
          </div>
          {directed && (
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
            >
              <option value="">Select a player…</option>
              {sortedRoster.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <p className="mt-2 text-center text-xs text-slate-400">
            {directed
              ? "They'll be notified; both of you confirm to lock it in."
              : "Anyone can take the other side; both of you then confirm to lock it in."}
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="flex-1 rounded-lg bg-slate-200 py-3 px-4 text-base font-semibold text-slate-700 transition-transform active:scale-95 hover:bg-slate-300 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 rounded-lg bg-green-600 py-3 px-4 text-base font-semibold text-white transition-transform active:scale-95 hover:bg-green-700 disabled:opacity-60"
          >
            {submitting ? "Posting…" : "Post bet"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
