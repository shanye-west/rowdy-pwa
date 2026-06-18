/**
 * Over/under builder for a single match's "holes played" prop. Pick a line, then
 * tap Over or Under to set a stake and post an open offer or a challenge — the
 * same flow as the team bet builder, with a bet-slip review step. Existing open
 * O/U offers on this match are listed with a Take button for the other side.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Minus, Plus } from "lucide-react";
import { Card } from "./ui/card";
import BetSlipReview from "./BetSlipReview";
import { Modal } from "./Modal";
import { useToast } from "../contexts/ToastContext";
import { betsApi } from "../api/bets";
import type { BetDoc } from "../types";

const LINE_OPTIONS = [14.5, 15.5, 16.5, 17.5];
const QUICK_AMOUNTS = [5, 10, 20, 50];
const STEP = 5;
const OVER_COLOR = "#059669"; // emerald-600
const UNDER_COLOR = "#475569"; // slate-600

type OUSide = "over" | "under";

export interface OverUnderBetCardProps {
  tournamentId: string;
  matchId: string;
  /** Match label, e.g. "Alice & Bob vs Carol & Dan". */
  matchLabel: string;
  /** Existing open over/under offers on this match. */
  openOffers: BetDoc[];
  loggedIn: boolean;
  meId?: string;
  rosterOptions: { id: string; name: string }[];
  bettorName: (pid?: string) => string;
  onTake: (b: BetDoc) => void;
}

export default function OverUnderBetCard({
  tournamentId,
  matchId,
  matchLabel,
  openOffers,
  loggedIn,
  meId,
  rosterOptions,
  bettorName,
  onTake,
}: OverUnderBetCardProps) {
  const { showToast } = useToast();
  const [line, setLine] = useState(16.5);
  const [side, setSide] = useState<OUSide | null>(null); // null = collapsed
  const [amount, setAmount] = useState(10);
  const [directed, setDirected] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const sortedRoster = useMemo(
    () => [...rosterOptions].sort((a, b) => a.name.localeCompare(b.name)),
    [rosterOptions]
  );

  const reset = () => {
    setSide(null);
    setAmount(10);
    setDirected(false);
    setTargetId("");
    setSubmitting(false);
    setReviewing(false);
  };

  const tapSide = (s: OUSide) => {
    if (!loggedIn) return;
    setSide((cur) => (cur === s ? null : s));
    setDirected(false);
    setTargetId("");
  };

  const canSubmit = !!side && amount > 0 && (!directed || !!targetId) && !submitting;
  const targetName = rosterOptions.find((p) => p.id === targetId)?.name;
  const sideColor = side === "over" ? OVER_COLOR : UNDER_COLOR;
  const sideLabel = side ? `${side === "over" ? "Over" : "Under"} ${line}` : "";

  const handlePost = async () => {
    if (!canSubmit || !side) return;
    setSubmitting(true);
    try {
      const base = {
        tournamentId,
        market: "overUnder" as const,
        matchId,
        metric: "matchHolesPlayed" as const,
        line,
        side,
        amount,
      };
      if (directed) {
        await betsApi.createBetChallenge({ ...base, targetId });
        showToast({ variant: "success", message: "Challenge sent — both players confirm to lock it in." });
      } else {
        await betsApi.createBetOffer(base);
        showToast({ variant: "success", message: "Offer posted to the marketplace." });
      }
      reset();
    } catch (e) {
      showToast({ variant: "error", message: e instanceof Error ? e.message : "Couldn't post the bet" });
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="text-sm font-bold text-slate-900">{matchLabel}</div>
      <div className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
        Holes played · Over / Under
      </div>

      {/* Line selector */}
      <div className="mb-2 flex gap-2">
        {LINE_OPTIONS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLine(l)}
            className={`flex-1 rounded-full px-2 py-1 text-xs font-semibold transition-colors ${
              line === l ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Over / Under buttons */}
      <div className="flex items-stretch gap-2">
        {(["over", "under"] as const).map((s) => {
          const selected = side === s;
          const color = s === "over" ? OVER_COLOR : UNDER_COLOR;
          return (
            <button
              key={s}
              type="button"
              onClick={() => tapSide(s)}
              disabled={!loggedIn}
              aria-pressed={selected}
              style={selected ? { backgroundColor: color, borderColor: color } : { borderLeftColor: color, borderLeftWidth: 4 }}
              className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default ${
                selected ? "text-white" : "border-slate-200 bg-white hover:bg-slate-50 disabled:hover:bg-white"
              }`}
            >
              <span
                className={`block text-[0.6rem] font-bold uppercase tracking-wide ${selected ? "text-white/85" : ""}`}
                style={selected ? undefined : { color }}
              >
                {s}
              </span>
              <span className={`block text-sm font-semibold ${selected ? "text-white" : "text-slate-800"}`}>
                {s === "over" ? `Over ${line}` : `Under ${line}`}
              </span>
            </button>
          );
        })}
      </div>

      {!loggedIn && (
        <div className="mt-2 text-center text-xs text-slate-400">
          <Link to="/login" className="font-semibold text-blue-600 underline">
            Log in
          </Link>{" "}
          to bet on this.
        </div>
      )}

      {/* Inline builder (after a side is tapped) */}
      {loggedIn && side && (
        <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: sideColor }} />
            You're betting <span className="text-slate-900">{sideLabel} holes</span>
          </div>

          {/* Stake stepper + presets */}
          <div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAmount((a) => Math.max(STEP, a - STEP))}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-700 active:scale-95"
                aria-label="Decrease stake"
              >
                <Minus className="h-4 w-4" />
              </button>
              <div className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white py-1.5">
                <span className="text-base font-bold text-slate-400">$</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  className="w-16 bg-transparent text-center text-lg font-bold text-slate-900 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setAmount((a) => a + STEP)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-700 active:scale-95"
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
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={submitting}
              className="flex-1 rounded-lg bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 active:scale-95 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => canSubmit && setReviewing(true)}
              disabled={!canSubmit}
              className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
            >
              Review bet
            </button>
          </div>
        </div>
      )}

      {/* Existing open O/U offers on this match */}
      {openOffers.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {openOffers.map((b) => {
            const over = b.proposerSide === "over";
            return (
              <li
                key={b.id}
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200"
              >
                <span className="min-w-0 truncate">
                  <span className="font-semibold" style={{ color: over ? OVER_COLOR : UNDER_COLOR }}>
                    {over ? "Over" : "Under"} {b.line}
                  </span>{" "}
                  <span className="text-slate-400">·</span> {bettorName(b.proposerId)}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-bold tabular-nums text-slate-900">${b.amount}</span>
                  {loggedIn ? (
                    <button
                      type="button"
                      disabled={meId === b.proposerId}
                      onClick={() => onTake(b)}
                      className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white active:scale-95 disabled:bg-slate-200 disabled:text-slate-400"
                    >
                      {meId === b.proposerId ? "Yours" : "Take"}
                    </button>
                  ) : (
                    <Link to="/login" className="text-xs font-semibold text-blue-600">
                      Log in
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {side && (
        <Modal isOpen={reviewing} onClose={() => !submitting && setReviewing(false)} ariaLabel="Review your bet">
          <BetSlipReview
            contextLabel={`${matchLabel} · O/U ${line} holes`}
            sideLabel={`${sideLabel} holes`}
            sideColor={sideColor}
            amount={amount}
            directed={directed}
            targetName={targetName}
            submitting={submitting}
            onConfirm={handlePost}
            onBack={() => setReviewing(false)}
          />
        </Modal>
      )}
    </Card>
  );
}
