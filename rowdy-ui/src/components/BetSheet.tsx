/**
 * The single focused bet sheet for one event (a match, a session/round, or the
 * Cup). Opened by tapping an event row in the Open Bets list — replacing the old
 * wall of inline builders. For matches it offers both bet types behind one
 * toggle: Match winner and Holes Over/Under. The shared builder (stake stepper,
 * open-offer vs challenge, bet-slip review) and the list of takeable open offers
 * for the event live in here too.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Minus, Plus } from "lucide-react";
import { Modal } from "./Modal";
import BetSlipReview from "./BetSlipReview";
import BetOfferRow from "./BetOfferRow";
import { useToast } from "../contexts/ToastContext";
import { betsApi } from "../api/bets";
import type { CreateBetOfferRequest } from "../api/adminContracts";
import type { BetDoc, BetTeamSide } from "../types";

const LINE_OPTIONS = [14.5, 15.5, 16.5, 17.5];
const QUICK_AMOUNTS = [5, 10, 20, 50];
const STEP = 5;
const OVER_COLOR = "#059669"; // emerald-600
const UNDER_COLOR = "#475569"; // slate-600

/** The event a sheet is opened for. */
export type BetEvent =
  | { kind: "cup" }
  | { kind: "round"; roundId: string }
  | { kind: "match"; matchId: string };

type BetType = "winner" | "ou";

export interface BetSheetProps {
  isOpen: boolean;
  onClose: () => void;
  tournamentId: string;
  event: BetEvent;
  /** Heading describing the event (matchup, round, or "Cup Winner"). */
  label: string;
  /** Player pairings (matches) or team names (round/cup) for each team side. */
  sideLabels: { teamA: string; teamB: string };
  /** Team display names, shown as a colored tag on each team side. */
  teamTags: { teamA: string; teamB: string };
  teamColors: { teamA: string; teamB: string };
  /** Open offers on this event (any market) — listed in the sheet with Take. */
  openOffers: BetDoc[];
  loggedIn: boolean;
  meId?: string;
  rosterOptions: { id: string; name: string }[];
  bettorName: (pid?: string) => string;
  /** Take an existing open offer. */
  onTake: (b: BetDoc) => void;
}

export default function BetSheet({
  isOpen,
  onClose,
  tournamentId,
  event,
  label,
  sideLabels,
  teamTags,
  teamColors,
  openOffers,
  loggedIn,
  meId,
  rosterOptions,
  bettorName,
  onTake,
}: BetSheetProps) {
  const { showToast } = useToast();
  const isMatch = event.kind === "match";

  // The parent keys this component by event, so it mounts fresh per event — these
  // initial values double as the per-event reset (no reset effect needed).
  const [betType, setBetType] = useState<BetType>("winner");
  const [teamSide, setTeamSide] = useState<BetTeamSide | null>(null);
  const [ouSide, setOuSide] = useState<"over" | "under" | null>(null);
  const [line, setLine] = useState(16.5);
  const [amount, setAmount] = useState(10);
  const [directed, setDirected] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const sortedRoster = useMemo(
    () => [...rosterOptions].sort((a, b) => a.name.localeCompare(b.name)),
    [rosterOptions]
  );

  const ouMode = isMatch && betType === "ou";
  const effectiveSide = ouMode ? ouSide : teamSide;
  const canSubmit = !!effectiveSide && amount > 0 && (!directed || !!targetId) && !submitting;
  const targetName = rosterOptions.find((p) => p.id === targetId)?.name;

  // The market the current selection posts to — also what the offer list shows.
  const market: CreateBetOfferRequest["market"] =
    event.kind === "round" ? "round" : event.kind === "cup" ? "cupFuture" : ouMode ? "overUnder" : "match";
  const relevantOffers = openOffers.filter((b) => b.market === market);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handlePost = async () => {
    if (!canSubmit || !effectiveSide) return;
    setSubmitting(true);
    try {
      const base: CreateBetOfferRequest = { tournamentId, market, side: effectiveSide, amount };
      if (event.kind === "match") base.matchId = event.matchId;
      if (event.kind === "round") base.roundId = event.roundId;
      if (market === "overUnder") {
        base.metric = "matchHolesPlayed";
        base.line = line;
      }
      if (directed) {
        await betsApi.createBetChallenge({ ...base, targetId });
        showToast({ variant: "success", message: "Challenge sent — both players confirm to lock it in." });
      } else {
        await betsApi.createBetOffer(base);
        showToast({ variant: "success", message: "Offer posted to the marketplace." });
      }
      onClose();
    } catch (e) {
      showToast({ variant: "error", message: e instanceof Error ? e.message : "Couldn't post the bet" });
      setSubmitting(false);
    }
  };

  // Bet-slip review details derived from the current selection.
  const review = (() => {
    if (ouMode && ouSide) {
      return {
        sideLabel: `${ouSide === "over" ? "Over" : "Under"} ${line} holes`,
        sideTag: undefined as string | undefined,
        sideColor: ouSide === "over" ? OVER_COLOR : UNDER_COLOR,
      };
    }
    if (teamSide) {
      return { sideLabel: sideLabels[teamSide], sideTag: teamTags[teamSide], sideColor: teamColors[teamSide] };
    }
    return { sideLabel: "", sideTag: undefined, sideColor: "#000" };
  })();

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Place a bet" ariaLabel="Place a bet">
      {reviewing ? (
        <BetSlipReview
          contextLabel={label}
          sideLabel={review.sideLabel}
          sideTag={review.sideTag}
          sideColor={review.sideColor}
          amount={amount}
          directed={directed}
          targetName={targetName}
          submitting={submitting}
          onConfirm={handlePost}
          onBack={() => setReviewing(false)}
        />
      ) : (
        <div className="space-y-4">
          <div className="text-center text-sm text-slate-500">{label}</div>

          {/* Match bet-type toggle (matches only) */}
          {isMatch && (
            <div className="flex gap-1 rounded-full bg-slate-100 p-0.5">
              {(
                [
                  { id: "winner", label: "Match winner" },
                  { id: "ou", label: "Holes O/U" },
                ] as { id: BetType; label: string }[]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setBetType(t.id)}
                  className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    betType === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Side picker */}
          {ouMode ? (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Holes played line
              </div>
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
              <div className="flex items-stretch gap-2">
                {(["over", "under"] as const).map((s) => {
                  const selected = ouSide === s;
                  const color = s === "over" ? OVER_COLOR : UNDER_COLOR;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setOuSide(s)}
                      aria-pressed={selected}
                      style={selected ? { backgroundColor: color, borderColor: color } : { borderLeftColor: color, borderLeftWidth: 4 }}
                      className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected ? "text-white" : "border-slate-200 bg-white hover:bg-slate-50"
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
            </div>
          ) : (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">You're betting</div>
              <div className="flex items-stretch gap-2">
                {(["teamA", "teamB"] as const).map((s) => {
                  const selected = teamSide === s;
                  const color = teamColors[s];
                  const showTag = teamTags[s] && teamTags[s] !== sideLabels[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setTeamSide(s)}
                      aria-pressed={selected}
                      style={selected ? { backgroundColor: color, borderColor: color } : { borderLeftColor: color, borderLeftWidth: 4 }}
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
          )}

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
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="flex-1 rounded-lg bg-slate-200 px-4 py-3 text-base font-semibold text-slate-700 transition-transform active:scale-95 hover:bg-slate-300 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => canSubmit && setReviewing(true)}
              disabled={!canSubmit}
              className="flex-1 rounded-lg bg-green-600 px-4 py-3 text-base font-semibold text-white transition-transform active:scale-95 hover:bg-green-700 disabled:opacity-60"
            >
              Review bet
            </button>
          </div>

          {/* Existing open offers on this event — take the other side */}
          {relevantOffers.length > 0 && (
            <div className="space-y-1.5 border-t border-slate-100 pt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open offers</div>
              {market === "overUnder" ? (
                <ul className="space-y-1.5">
                  {relevantOffers.map((b) => {
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
              ) : (
                <ul className="space-y-1.5">
                  {relevantOffers.map((b) => (
                    <BetOfferRow
                      key={b.id}
                      teamALabel={sideLabels.teamA}
                      teamBLabel={sideLabels.teamB}
                      teamAColor={teamColors.teamA}
                      teamBColor={teamColors.teamB}
                      proposerSide={b.proposerSide === "teamB" ? "teamB" : "teamA"}
                      proposerName={bettorName(b.proposerId)}
                      amount={b.amount}
                      mine={meId === b.proposerId}
                      loggedIn={loggedIn}
                      onTake={() => onTake(b)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
