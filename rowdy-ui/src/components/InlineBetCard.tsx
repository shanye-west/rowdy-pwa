/**
 * A single bettable event (a match, or the Cup) rendered as a card with inline
 * bet creation — no modal. Tapping a team selects the side you're backing and
 * expands a stake stepper + Open offer / Challenge controls right in the card.
 * Existing open offers on this event are listed with a Take button.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Minus, Plus } from "lucide-react";
import { Card } from "./ui/card";
import BetOfferRow from "./BetOfferRow";
import { useToast } from "../contexts/ToastContext";
import { betsApi } from "../api/bets";
import type { BetDoc, BetMarket, BetSide } from "../types";

const QUICK_AMOUNTS = [5, 10, 20, 50];
const STEP = 5;
const oppositeSide = (s: BetSide): BetSide => (s === "teamA" ? "teamB" : "teamA");

export interface InlineBetCardProps {
  tournamentId: string;
  market: BetMarket;
  /** Required for match markets. */
  matchId?: string;
  /** Heading shown above the team buttons (e.g. "🏆 Cup Winner"); omit for matches. */
  title?: string;
  /** Player names (matches) or team names (Cup) for each side. */
  sideLabels: { teamA: string; teamB: string };
  /** Team display names, always shown as a colored tag on each side. */
  teamTags: { teamA: string; teamB: string };
  /** Team brand colors (hex/CSS) for each side. */
  teamColors: { teamA: string; teamB: string };
  /** Existing open offers on this event. */
  openOffers: BetDoc[];
  loggedIn: boolean;
  meId?: string;
  /** Roster (excluding self) for the challenge target picker. */
  rosterOptions: { id: string; name: string }[];
  bettorName: (pid: string | undefined) => string;
  /** Take an existing open offer. */
  onTake: (b: BetDoc) => void;
  /** Called after a new bet is successfully posted. */
  onPosted: () => void;
}

export default function InlineBetCard({
  tournamentId,
  market,
  matchId,
  title,
  sideLabels,
  teamTags,
  teamColors,
  openOffers,
  loggedIn,
  meId,
  rosterOptions,
  bettorName,
  onTake,
  onPosted,
}: InlineBetCardProps) {
  const { showToast } = useToast();
  const [side, setSide] = useState<BetSide | null>(null); // null = collapsed
  const [amount, setAmount] = useState<number>(10);
  const [directed, setDirected] = useState(false);
  const [targetId, setTargetId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const sortedRoster = useMemo(
    () => [...rosterOptions].sort((a, b) => a.name.localeCompare(b.name)),
    [rosterOptions]
  );

  const resetBuilder = () => {
    setSide(null);
    setAmount(10);
    setDirected(false);
    setTargetId("");
    setSubmitting(false);
  };

  const tapTeam = (s: BetSide) => {
    if (!loggedIn) return;
    setSide((cur) => (cur === s ? null : s)); // tap again to collapse
    setDirected(false);
    setTargetId("");
  };

  const canSubmit = !!side && amount > 0 && (!directed || !!targetId) && !submitting;

  const handlePost = async () => {
    if (!canSubmit || !side) return;
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
      resetBuilder();
      onPosted();
    } catch (e) {
      showToast({ variant: "error", message: e instanceof Error ? e.message : "Couldn't post the bet" });
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-4">
      {title && <div className="mb-2 text-sm font-bold text-slate-900">{title}</div>}

      {/* Team buttons — tap one to back it. Colored by team identity. */}
      <div className="flex items-stretch gap-2">
        {(["teamA", "teamB"] as const).map((s) => {
          const selected = side === s;
          const color = teamColors[s];
          const showTag = teamTags[s] && teamTags[s] !== sideLabels[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => tapTeam(s)}
              disabled={!loggedIn}
              aria-pressed={selected}
              style={
                selected
                  ? { backgroundColor: color, borderColor: color }
                  : { borderLeftColor: color, borderLeftWidth: 4 }
              }
              className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default ${
                selected ? "text-white" : "border-slate-200 bg-white hover:bg-slate-50 disabled:hover:bg-white"
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

      {!loggedIn && (
        <div className="mt-2 text-center text-xs text-slate-400">
          <Link to="/login" className="font-semibold text-blue-600 underline">
            Log in
          </Link>{" "}
          to bet on this.
        </div>
      )}

      {/* Inline builder (after a team is tapped) */}
      {loggedIn && side && (
        <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: teamColors[side] }} />
            You're backing{" "}
            <span className="text-slate-900">
              {sideLabels[side]}
              {teamTags[side] && teamTags[side] !== sideLabels[side] ? ` (${teamTags[side]})` : ""}
            </span>
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
              onClick={resetBuilder}
              disabled={submitting}
              className="flex-1 rounded-lg bg-slate-200 py-2.5 px-4 text-sm font-semibold text-slate-700 active:scale-95 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePost}
              disabled={!canSubmit}
              className="flex-1 rounded-lg bg-green-600 py-2.5 px-4 text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
            >
              {submitting ? "Posting…" : "Post bet"}
            </button>
          </div>
        </div>
      )}

      {/* Existing open offers on this event */}
      {openOffers.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {openOffers.map((b) => (
            <BetOfferRow
              key={b.id}
              dotColor={teamColors[b.proposerSide]}
              proposerName={bettorName(b.proposerId)}
              backsLabel={sideLabels[b.proposerSide]}
              takeLabel={sideLabels[oppositeSide(b.proposerSide)]}
              amount={b.amount}
              mine={meId === b.proposerId}
              loggedIn={loggedIn}
              onTake={() => onTake(b)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
