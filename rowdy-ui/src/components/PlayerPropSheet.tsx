/**
 * Bet sheet for tournament-long player props — the two markets that aren't tied
 * to a single match or round:
 *   - Matchup: which of two players scores more tournament points (sides teamA/teamB,
 *     backing subjectAId / subjectBId).
 *   - Total points O/U: over/under on one player's total tournament points.
 *
 * Mirrors BetSheet's builder (stake stepper, open-offer vs challenge, bet-slip
 * review) but with player pickers instead of an event's fixed two sides. Posts
 * via the same betsOps callables; open player-prop offers for the tournament are
 * listed here with a Take button.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Minus, Plus } from "lucide-react";
import { Modal } from "./Modal";
import BetSlipReview from "./BetSlipReview";
import { useToast } from "../contexts/ToastContext";
import { betsApi } from "../api/bets";
import type { CreateBetOfferRequest } from "../api/adminContracts";
import type { BetDoc } from "../types";

const POINT_LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
const QUICK_AMOUNTS = [10, 20, 50, 100];
const STEP = 5;
const OVER_COLOR = "#059669"; // emerald-600
const UNDER_COLOR = "#475569"; // slate-600
const A_COLOR = "#2563eb"; // blue-600
const B_COLOR = "#d97706"; // amber-600

type PropType = "matchup" | "ou";

export interface PlayerPropSheetProps {
  isOpen: boolean;
  onClose: () => void;
  tournamentId: string;
  /** Open player-prop offers for this tournament — listed with Take. */
  openOffers: BetDoc[];
  loggedIn: boolean;
  meId?: string;
  rosterOptions: { id: string; name: string }[];
  bettorName: (pid?: string) => string;
  onTake: (b: BetDoc) => void;
}

export default function PlayerPropSheet({
  isOpen,
  onClose,
  tournamentId,
  openOffers,
  loggedIn,
  meId,
  rosterOptions,
  bettorName,
  onTake,
}: PlayerPropSheetProps) {
  const { showToast } = useToast();

  const [propType, setPropType] = useState<PropType>("matchup");
  // Matchup
  const [subjectAId, setSubjectAId] = useState("");
  const [subjectBId, setSubjectBId] = useState("");
  const [teamSide, setTeamSide] = useState<"teamA" | "teamB" | null>(null);
  // Over/under
  const [subjectId, setSubjectId] = useState("");
  const [ouSide, setOuSide] = useState<"over" | "under" | null>(null);
  const [line, setLine] = useState(2.5);
  // Shared
  const [amount, setAmount] = useState(10);
  const [directed, setDirected] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const sortedRoster = useMemo(
    () => [...rosterOptions].sort((a, b) => a.name.localeCompare(b.name)),
    [rosterOptions]
  );
  const nameOf = (id: string) => rosterOptions.find((p) => p.id === id)?.name ?? "—";

  const isMatchup = propType === "matchup";
  const market: CreateBetOfferRequest["market"] = isMatchup ? "playerMatchup" : "overUnder";
  const relevantOffers = openOffers.filter((b) =>
    isMatchup ? b.market === "playerMatchup" : b.market === "overUnder" && b.metric === "playerTournamentPoints"
  );

  const matchupReady = !!subjectAId && !!subjectBId && subjectAId !== subjectBId && !!teamSide;
  const ouReady = !!subjectId && !!ouSide;
  const canSubmit =
    (isMatchup ? matchupReady : ouReady) && amount > 0 && (!directed || !!targetId) && !submitting;
  const targetName = rosterOptions.find((p) => p.id === targetId)?.name;

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handlePost = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const base: CreateBetOfferRequest = {
        tournamentId,
        market,
        side: isMatchup ? teamSide! : ouSide!,
        amount,
      };
      if (isMatchup) {
        base.subjectAId = subjectAId;
        base.subjectBId = subjectBId;
      } else {
        base.metric = "playerTournamentPoints";
        base.subjectId = subjectId;
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
    if (isMatchup && teamSide) {
      const backed = teamSide === "teamA" ? subjectAId : subjectBId;
      const other = teamSide === "teamA" ? subjectBId : subjectAId;
      return {
        contextLabel: `${nameOf(subjectAId)} vs ${nameOf(subjectBId)} · most tournament points`,
        sideLabel: `${nameOf(backed)} over ${nameOf(other)}`,
        sideColor: teamSide === "teamA" ? A_COLOR : B_COLOR,
      };
    }
    if (!isMatchup && ouSide) {
      return {
        contextLabel: `${nameOf(subjectId)} · tournament points`,
        sideLabel: `${ouSide === "over" ? "Over" : "Under"} ${line} pts`,
        sideColor: ouSide === "over" ? OVER_COLOR : UNDER_COLOR,
      };
    }
    return { contextLabel: "", sideLabel: "", sideColor: "#000" };
  })();

  const playerSelect = (value: string, onChange: (v: string) => void, exclude?: string) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-slate-400 focus:outline-none"
    >
      <option value="">Select a player…</option>
      {sortedRoster
        .filter((p) => p.id !== exclude)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
    </select>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Player props" ariaLabel="Place a player prop bet">
      {reviewing ? (
        <BetSlipReview
          contextLabel={review.contextLabel}
          sideLabel={review.sideLabel}
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
          {/* Prop-type toggle */}
          <div className="flex gap-1 rounded-full bg-muted p-0.5">
            {(
              [
                { id: "matchup", label: "Player matchup" },
                { id: "ou", label: "Points O/U" },
              ] as { id: PropType; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPropType(t.id)}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  propType === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {isMatchup ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-[0.6rem] font-bold uppercase tracking-wide" style={{ color: A_COLOR }}>
                    Player A
                  </div>
                  {playerSelect(subjectAId, setSubjectAId, subjectBId)}
                </div>
                <div>
                  <div className="mb-1 text-[0.6rem] font-bold uppercase tracking-wide" style={{ color: B_COLOR }}>
                    Player B
                  </div>
                  {playerSelect(subjectBId, setSubjectBId, subjectAId)}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Who scores more?
                </div>
                <div className="flex items-stretch gap-2">
                  {(["teamA", "teamB"] as const).map((s) => {
                    const selected = teamSide === s;
                    const color = s === "teamA" ? A_COLOR : B_COLOR;
                    const id = s === "teamA" ? subjectAId : subjectBId;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setTeamSide(s)}
                        aria-pressed={selected}
                        style={
                          selected
                            ? { backgroundColor: color, borderColor: color }
                            : { borderLeftColor: color, borderLeftWidth: 4 }
                        }
                        className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                          selected ? "text-white" : "border-border bg-card hover:bg-muted"
                        }`}
                      >
                        <span className={`block text-sm font-semibold ${selected ? "text-white" : "text-foreground"}`}>
                          {id ? nameOf(id) : s === "teamA" ? "Player A" : "Player B"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Player</div>
                {playerSelect(subjectId, setSubjectId)}
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Points line</div>
                <div className="mb-2 grid grid-cols-4 gap-2">
                  {POINT_LINES.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLine(l)}
                      className={`rounded-full px-2 py-1 text-xs font-semibold transition-colors ${
                        line === l ? "bg-slate-900 text-white" : "bg-muted text-muted-foreground hover:bg-muted"
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
                        style={
                          selected
                            ? { backgroundColor: color, borderColor: color }
                            : { borderLeftColor: color, borderLeftWidth: 4 }
                        }
                        className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                          selected ? "text-white" : "border-border bg-card hover:bg-muted"
                        }`}
                      >
                        <span
                          className={`block text-[0.6rem] font-bold uppercase tracking-wide ${selected ? "text-white/85" : ""}`}
                          style={selected ? undefined : { color }}
                        >
                          {s}
                        </span>
                        <span className={`block text-sm font-semibold ${selected ? "text-white" : "text-foreground"}`}>
                          {s === "over" ? `Over ${line}` : `Under ${line}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Stake stepper + presets */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Stake (each side risks this)
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAmount((a) => Math.max(STEP, a - STEP))}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground active:scale-95"
                aria-label="Decrease stake"
              >
                <Minus className="h-4 w-4" />
              </button>
              <div className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border bg-card py-2">
                <span className="text-lg font-bold text-muted-foreground">$</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  className="w-20 bg-transparent text-center text-lg font-bold text-foreground focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setAmount((a) => a + STEP)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground active:scale-95"
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
                    amount === a ? "bg-slate-900 text-white" : "bg-muted text-muted-foreground hover:bg-muted"
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
                  !directed ? "border-slate-900 bg-slate-900 text-white" : "border-border bg-card text-foreground"
                }`}
              >
                Open offer
              </button>
              <button
                type="button"
                onClick={() => setDirected(true)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                  directed ? "border-slate-900 bg-slate-900 text-white" : "border-border bg-card text-foreground"
                }`}
              >
                Challenge a player
              </button>
            </div>
            {directed && (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-slate-400 focus:outline-none"
              >
                <option value="">Select a player…</option>
                {sortedRoster
                  .filter((p) => p.id !== meId)
                  .map((p) => (
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
              className="flex-1 rounded-lg bg-muted px-4 py-3 text-base font-semibold text-foreground transition-transform active:scale-95 hover:bg-muted disabled:opacity-60"
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

          {/* Existing open player-prop offers — take the other side */}
          {relevantOffers.length > 0 && (
            <div className="space-y-1.5 border-t border-border pt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open offers</div>
              <ul className="space-y-1.5">
                {relevantOffers.map((b) => {
                  const desc = isMatchup
                    ? `${bettorName(b.proposerId)} backs ${
                        b.proposerSide === "teamA" ? nameOf(b.subjectAId ?? "") : nameOf(b.subjectBId ?? "")
                      }`
                    : `${b.proposerSide === "over" ? "Over" : "Under"} ${b.line} · ${nameOf(b.subjectId ?? "")}`;
                  return (
                    <li
                      key={b.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200"
                    >
                      <span className="min-w-0 truncate">
                        {isMatchup ? (
                          <>
                            <span className="font-semibold text-foreground">
                              {nameOf(b.subjectAId ?? "")} vs {nameOf(b.subjectBId ?? "")}
                            </span>{" "}
                            <span className="text-muted-foreground">·</span> {desc}
                          </>
                        ) : (
                          <>
                            <span className="font-semibold text-foreground">{desc}</span>{" "}
                            <span className="text-muted-foreground">·</span> {bettorName(b.proposerId)}
                          </>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-bold tabular-nums text-foreground">${b.amount}</span>
                        {loggedIn ? (
                          <button
                            type="button"
                            disabled={meId === b.proposerId}
                            onClick={() => onTake(b)}
                            className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white active:scale-95 disabled:bg-muted disabled:text-muted-foreground"
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
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
