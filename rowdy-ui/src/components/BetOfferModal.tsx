/**
 * Modal for creating a bet from scratch — the player first picks what to bet on
 * (a bettable match or the Cup), then which side they're backing, the stake, and
 * whether it's an open marketplace offer (anyone may take the other side) or a
 * directed challenge to one specific player. Opened from the My Bets tab.
 */

import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { useToast } from "../contexts/ToastContext";
import { betsApi } from "../api/bets";
import type { BetMarket, BetSide } from "../types";

const QUICK_AMOUNTS = [5, 10, 20, 50];

/** One thing a player can bet on — a match, or the Cup futures market. */
export interface BetEvent {
  /** Unique key: the matchId for matches, "cupFuture" for the futures market. */
  key: string;
  market: BetMarket;
  matchId?: string;
  /** Short label for the event picker (e.g. the matchup, or "Cup Winner"). */
  label: string;
  /** Labels for each side, shown on the side-picker buttons. */
  sideLabels: { teamA: string; teamB: string };
}

export interface BetOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  tournamentId: string;
  /** Everything currently bettable; the player chooses one. */
  events: BetEvent[];
  /** Optional event to preselect (otherwise the first event). */
  initialEventKey?: string;
  /** Roster (excluding self) for the challenge target picker. */
  rosterOptions: { id: string; name: string }[];
  /** Called after a bet is successfully posted. */
  onPosted: () => void;
}

export default function BetOfferModal({
  isOpen,
  onClose,
  tournamentId,
  events,
  initialEventKey,
  rosterOptions,
  onPosted,
}: BetOfferModalProps) {
  const { showToast } = useToast();
  const [eventKey, setEventKey] = useState<string>(initialEventKey ?? events[0]?.key ?? "");
  const [side, setSide] = useState<BetSide>("teamA");
  const [amount, setAmount] = useState<number>(10);
  const [directed, setDirected] = useState(false);
  const [targetId, setTargetId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const selectedEvent = useMemo(
    () => events.find((e) => e.key === eventKey),
    [events, eventKey]
  );

  const sortedRoster = useMemo(
    () => [...rosterOptions].sort((a, b) => a.name.localeCompare(b.name)),
    [rosterOptions]
  );

  const reset = () => {
    setSide("teamA");
    setAmount(10);
    setDirected(false);
    setTargetId("");
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const canSubmit = !!selectedEvent && amount > 0 && (!directed || !!targetId) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedEvent) return;
    setSubmitting(true);
    try {
      const base = { tournamentId, market: selectedEvent.market, matchId: selectedEvent.matchId, side, amount };
      if (directed) {
        await betsApi.createBetChallenge({ ...base, targetId });
        showToast({ variant: "success", message: "Challenge sent — both players confirm to lock it in." });
      } else {
        await betsApi.createBetOffer(base);
        showToast({ variant: "success", message: "Offer posted to the marketplace." });
      }
      reset();
      onPosted();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't post the bet";
      showToast({ variant: "error", message: msg });
      setSubmitting(false);
    }
  };

  const sideLabels = selectedEvent?.sideLabels ?? { teamA: "Team A", teamB: "Team B" };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create a bet" ariaLabel="Create a bet">
      {events.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-500">
          Nothing's bettable right now — every match has started.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Event picker */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Bet on</div>
            <select
              value={eventKey}
              onChange={(e) => {
                setEventKey(e.target.value);
                setSide("teamA");
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-slate-400 focus:outline-none"
            >
              {events.map((ev) => (
                <option key={ev.key} value={ev.key}>
                  {ev.label}
                </option>
              ))}
            </select>
          </div>

          {/* Side picker */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">You're backing</div>
            <div className="flex gap-2">
              {(["teamA", "teamB"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    side === s
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {sideLabels[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Stake (each side risks this)
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-slate-400">$</span>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-lg font-bold text-slate-900 focus:border-slate-400 focus:outline-none"
              />
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
      )}
    </Modal>
  );
}
