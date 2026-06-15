import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import { Card } from "../components/ui/card";
import BetOfferModal, { type BetOfferModalProps } from "../components/BetOfferModal";
import { useAuth } from "../contexts/AuthContext";
import { useTournamentContext } from "../contexts/TournamentContext";
import { useToast } from "../contexts/ToastContext";
import { useTournamentData } from "../hooks/useTournamentData";
import {
  useBets,
  useRosterPlayers,
  isMatchBettable,
  selectMyBets,
  needsMyConfirm,
  settledDelta,
  computeLedger,
  headToHead,
} from "../hooks/useBets";
import { betsApi } from "../api/bets";
import CommentThread from "../components/CommentThread";
import type { BetDoc, BetSide, MatchDoc, PlayerDoc } from "../types";

type Tab = "markets" | "mybets" | "ledger" | "chat";

const money = (n: number): string => (n < 0 ? `-$${Math.abs(n)}` : `$${n}`);
const oppositeSide = (s: BetSide): BetSide => (s === "teamA" ? "teamB" : "teamA");

// Modal config minus the always-present wiring props.
type ModalConfig = Pick<BetOfferModalProps, "market" | "matchId" | "contextLabel" | "sideLabels">;

export default function Sportsbook() {
  const { player } = useAuth();
  const { tournament } = useTournamentContext();
  const { showToast } = useToast();
  const { rounds, matchesByRound, loading: tdLoading } = useTournamentData({ prefetchedTournament: tournament });
  const { bets, loading: betsLoading } = useBets(tournament?.id);
  const players = useRosterPlayers(tournament);

  const [tab, setTab] = useState<Tab>("markets");
  const [modal, setModal] = useState<ModalConfig | null>(null);

  const playerName = (pid: string | undefined): string =>
    (pid && (players[pid]?.displayName || pid)) || "Unknown";
  const sideNames = (side?: { playerId: string }[]): string =>
    (side ?? []).map((p) => playerName(p.playerId)).join(" & ") || "TBD";

  const allMatches = useMemo(() => Object.values(matchesByRound).flat(), [matchesByRound]);
  const matchesById = useMemo(() => {
    const map: Record<string, MatchDoc> = {};
    allMatches.forEach((m) => (map[m.id] = m));
    return map;
  }, [allMatches]);
  const tournamentStarted = useMemo(
    () => allMatches.some((m) => (m.status?.thru ?? 0) > 0 || m.status?.closed === true),
    [allMatches]
  );

  const teamNames = {
    teamA: tournament?.teamA?.name || "Team A",
    teamB: tournament?.teamB?.name || "Team B",
  };

  /** Labels for a bet's two sides — player names for matches, team names for futures. */
  const sideLabelsForBet = (b: BetDoc): { teamA: string; teamB: string } => {
    if (b.market === "cupFuture") return teamNames;
    const m = b.matchId ? matchesById[b.matchId] : undefined;
    return { teamA: sideNames(m?.teamAPlayers), teamB: sideNames(m?.teamBPlayers) };
  };
  const contextForBet = (b: BetDoc): string => {
    if (b.market === "cupFuture") return "Cup Winner";
    const labels = sideLabelsForBet(b);
    return `${labels.teamA} vs ${labels.teamB}`;
  };
  /** The team `playerId` is backing on this bet. */
  const mySide = (b: BetDoc, playerId: string): BetSide | null => {
    if (b.proposerId === playerId) return b.proposerSide;
    if (b.acceptorId === playerId) return b.acceptorSide ?? oppositeSide(b.proposerSide);
    if (b.targetId === playerId) return oppositeSide(b.proposerSide); // incoming challenge: I'd take the other side
    return null;
  };

  const rosterOptions = useMemo(
    () =>
      Object.values(players)
        .filter((p: PlayerDoc) => p.id !== player?.id)
        .map((p) => ({ id: p.id, name: p.displayName || p.id })),
    [players, player?.id]
  );

  async function runAction(fn: () => Promise<unknown>, successMsg: string) {
    try {
      await fn();
      showToast({ variant: "success", message: successMsg });
    } catch (e) {
      showToast({ variant: "error", message: e instanceof Error ? e.message : "Something went wrong" });
    }
  }

  // ---- gating ----
  if (!tournament) {
    return (
      <Layout title="Sportsbook" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">🎲</div>
          <div className="empty-state-text">No active tournament.</div>
        </div>
      </Layout>
    );
  }
  if (!tournament.sportsbookEnabled) {
    return (
      <Layout title="Sportsbook" series={tournament.series} showBack tournamentLogo={tournament.tournamentLogo}>
        <div className="empty-state">
          <div className="empty-state-icon">🎲</div>
          <div className="empty-state-text">The sportsbook isn't open for this tournament yet.</div>
        </div>
      </Layout>
    );
  }

  const loading = tdLoading || betsLoading;
  const myBets = selectMyBets(bets, player?.id);
  const openOffers = bets.filter((b) => b.status === "open" && b.kind === "offer");
  const ledger = computeLedger(bets);
  const h2h = headToHead(bets, player?.id);

  // ---- shared render helpers ----
  const sideBadge = (label: string) => (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">{label}</span>
  );

  const openModalForMatch = (m: MatchDoc) =>
    setModal({
      market: "match",
      matchId: m.id,
      contextLabel: `${sideNames(m.teamAPlayers)} vs ${sideNames(m.teamBPlayers)}`,
      sideLabels: { teamA: sideNames(m.teamAPlayers), teamB: sideNames(m.teamBPlayers) },
    });

  const openModalForFutures = () =>
    setModal({ market: "cupFuture", contextLabel: "Who wins the Cup?", sideLabels: teamNames });

  return (
    <Layout title="Sportsbook" series={tournament.series} showBack tournamentLogo={tournament.tournamentLogo}>
      <div className="space-y-4 p-4">
        {/* Tabs */}
        <div className="flex gap-1.5">
          {(
            [
              { id: "markets", label: "Markets" },
              { id: "mybets", label: "My Bets" },
              { id: "ledger", label: "Ledger" },
              ...(tournament.commentsEnabled ? [{ id: "chat", label: "Chat" }] : []),
            ] as { id: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === t.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="spinner-lg" />
          </div>
        ) : tab === "markets" ? (
          // ============================ MARKETS ============================
          <div className="space-y-4">
            {/* Cup futures */}
            {!tournamentStarted && (
              <Card className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-slate-900">🏆 Cup Winner</div>
                    <div className="text-xs text-slate-500">
                      {teamNames.teamA} vs {teamNames.teamB}
                    </div>
                  </div>
                  <PostButton player={player} onClick={openModalForFutures} />
                </div>
                <OfferList
                  offers={openOffers.filter((b) => b.market === "cupFuture")}
                  bettorName={playerName}
                  labelFor={(b) => sideLabelsForBet(b)}
                  meId={player?.id}
                  onTake={(b) =>
                    runAction(() => betsApi.acceptBet({ betId: b.id }), "Taken — confirm it in My Bets.")
                  }
                />
              </Card>
            )}

            {/* Match markets, grouped by round */}
            {rounds.map((r) => {
              const bettable = (matchesByRound[r.id] ?? []).filter((m) => isMatchBettable(m));
              if (bettable.length === 0) return null;
              return (
                <div key={r.id} className="space-y-2">
                  <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {r.day ? `Round ${r.day}` : "Round"}
                  </div>
                  {bettable.map((m) => (
                    <Card key={m.id} className="p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {sideNames(m.teamAPlayers)}
                          </div>
                          <div className="text-[0.65rem] font-semibold uppercase text-slate-400">vs</div>
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {sideNames(m.teamBPlayers)}
                          </div>
                        </div>
                        <PostButton player={player} onClick={() => openModalForMatch(m)} />
                      </div>
                      <OfferList
                        offers={openOffers.filter((b) => b.market === "match" && b.matchId === m.id)}
                        bettorName={playerName}
                        labelFor={(b) => sideLabelsForBet(b)}
                        meId={player?.id}
                        onTake={(b) =>
                          runAction(() => betsApi.acceptBet({ betId: b.id }), "Taken — confirm it in My Bets.")
                        }
                      />
                    </Card>
                  ))}
                </div>
              );
            })}

            {openOffers.length === 0 && rounds.every((r) => (matchesByRound[r.id] ?? []).every((m) => !isMatchBettable(m))) && tournamentStarted && (
              <div className="empty-state">
                <div className="empty-state-icon">⛳</div>
                <div className="empty-state-text">No open markets — every match has started.</div>
              </div>
            )}
          </div>
        ) : tab === "mybets" ? (
          // ============================ MY BETS ============================
          !player ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔒</div>
              <div className="empty-state-text">
                <Link to="/login" className="font-semibold text-blue-600 underline">
                  Log in
                </Link>{" "}
                to place and track bets.
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <Section title="Incoming challenges" count={myBets.incomingChallenges.length}>
                {myBets.incomingChallenges.map((b) => (
                  <BetLine key={b.id} context={contextForBet(b)}>
                    <div className="text-xs text-slate-500">
                      {playerName(b.proposerId)} bets you {money(b.amount)} · you'd back{" "}
                      {sideBadge(sideLabelsForBet(b)[mySide(b, player.id) ?? "teamB"])}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <SmallBtn
                        variant="primary"
                        onClick={() => runAction(() => betsApi.acceptBet({ betId: b.id }), "Accepted — now confirm to lock it in.")}
                      >
                        Accept
                      </SmallBtn>
                      <SmallBtn
                        variant="muted"
                        onClick={() => runAction(() => betsApi.declineBet({ betId: b.id }), "Challenge declined.")}
                      >
                        Decline
                      </SmallBtn>
                    </div>
                  </BetLine>
                ))}
              </Section>

              <Section title="My open offers" count={myBets.myOpenOffers.length}>
                {myBets.myOpenOffers.map((b) => (
                  <BetLine key={b.id} context={contextForBet(b)}>
                    <div className="text-xs text-slate-500">
                      {money(b.amount)} · backing {sideBadge(sideLabelsForBet(b)[b.proposerSide])} ·{" "}
                      {b.kind === "challenge" ? `to ${playerName(b.targetId)}` : "open to anyone"}
                    </div>
                    <div className="mt-2">
                      <SmallBtn
                        variant="muted"
                        onClick={() => runAction(() => betsApi.cancelBet({ betId: b.id }), "Offer cancelled.")}
                      >
                        Cancel
                      </SmallBtn>
                    </div>
                  </BetLine>
                ))}
              </Section>

              <Section title="Awaiting confirmation" count={myBets.pending.length}>
                {myBets.pending.map((b) => {
                  const iConfirm = needsMyConfirm(b, player.id);
                  const iAmAcceptor = b.acceptorId === player.id;
                  const side = mySide(b, player.id);
                  return (
                    <BetLine key={b.id} context={contextForBet(b)}>
                      <div className="text-xs text-slate-500">
                        {money(b.amount)} · you back {sideBadge(sideLabelsForBet(b)[side ?? "teamA"])} ·{" "}
                        vs {playerName(b.proposerId === player.id ? b.acceptorId : b.proposerId)}
                      </div>
                      <div className="mt-1 text-[0.7rem] font-semibold text-amber-600">
                        {iConfirm ? "Waiting on you to confirm" : "Waiting on the other player"}
                      </div>
                      <div className="mt-2 flex gap-2">
                        {iConfirm && (
                          <SmallBtn
                            variant="primary"
                            onClick={() => runAction(() => betsApi.confirmBet({ betId: b.id }), "Confirmed.")}
                          >
                            Confirm
                          </SmallBtn>
                        )}
                        {iAmAcceptor ? (
                          <SmallBtn
                            variant="muted"
                            onClick={() => runAction(() => betsApi.withdrawAcceptance({ betId: b.id }), "Withdrawn.")}
                          >
                            Withdraw
                          </SmallBtn>
                        ) : (
                          <SmallBtn
                            variant="muted"
                            onClick={() => runAction(() => betsApi.cancelBet({ betId: b.id }), "Cancelled.")}
                          >
                            Cancel
                          </SmallBtn>
                        )}
                      </div>
                    </BetLine>
                  );
                })}
              </Section>

              <Section title="Active bets" count={myBets.active.length}>
                {myBets.active.map((b) => {
                  const side = mySide(b, player.id);
                  return (
                    <BetLine key={b.id} context={contextForBet(b)}>
                      <div className="text-xs text-slate-500">
                        {money(b.amount)} · you back {sideBadge(sideLabelsForBet(b)[side ?? "teamA"])} · vs{" "}
                        {playerName(b.proposerId === player.id ? b.acceptorId : b.proposerId)}
                      </div>
                      <div className="mt-1 text-[0.7rem] font-semibold text-emerald-600">Locked in</div>
                    </BetLine>
                  );
                })}
              </Section>

              {myBets.settled.length > 0 && (
                <Section
                  title="Settled"
                  count={myBets.settled.length}
                  trailing={
                    <NetBadge net={myBets.settled.reduce((sum, b) => sum + settledDelta(b, player.id), 0)} />
                  }
                >
                  {myBets.settled.map((b) => {
                    const delta = settledDelta(b, player.id);
                    return (
                      <BetLine key={b.id} context={contextForBet(b)}>
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-slate-500">
                            vs {playerName(b.proposerId === player.id ? b.acceptorId : b.proposerId)}
                          </div>
                          <div
                            className={`text-sm font-bold ${
                              delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-slate-400"
                            }`}
                          >
                            {delta === 0 ? "Push" : money(delta)}
                          </div>
                        </div>
                      </BetLine>
                    );
                  })}
                </Section>
              )}

              {myBets.incomingChallenges.length === 0 &&
                myBets.myOpenOffers.length === 0 &&
                myBets.pending.length === 0 &&
                myBets.active.length === 0 &&
                myBets.settled.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-state-icon">🎟️</div>
                    <div className="empty-state-text">No bets yet — find some action in Markets.</div>
                  </div>
                )}
            </div>
          )
        ) : tab === "ledger" ? (
          // ============================ LEDGER ============================
          <div className="space-y-4">
            {player && h2h.length > 0 && (
              <Card className="p-4">
                <div className="mb-2 text-sm font-bold text-slate-900">Your tab</div>
                <ul className="space-y-1.5">
                  {h2h.map((row) => (
                    <li key={row.otherId} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">
                        {row.net > 0 ? `${playerName(row.otherId)} owes you` : `You owe ${playerName(row.otherId)}`}
                      </span>
                      <span className={`font-bold ${row.net > 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {money(Math.abs(row.net))}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {ledger.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">💸</div>
                <div className="empty-state-text">No settled bets yet — the ledger fills in as matches finish.</div>
              </div>
            ) : (
              <Card className="overflow-hidden p-0">
                <ul className="divide-y divide-slate-100">
                  {ledger.map((row, i) => (
                    <li key={row.playerId} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-900">{playerName(row.playerId)}</div>
                        <div className="text-xs text-slate-500">
                          {row.wins}W · {row.losses}L{row.pushes > 0 ? ` · ${row.pushes}P` : ""}
                        </div>
                      </div>
                      <div className={`text-lg font-bold ${row.net > 0 ? "text-emerald-600" : row.net < 0 ? "text-red-600" : "text-slate-400"}`}>
                        {money(row.net)}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        ) : (
          // ============================ CHAT ============================
          <CommentThread
            threadType="sportsbook"
            threadId={`sb_${tournament.id}`}
            tournamentId={tournament.id}
            title="Trash talk"
          />
        )}
      </div>

      {modal && tournament && (
        <BetOfferModal
          isOpen={!!modal}
          onClose={() => setModal(null)}
          tournamentId={tournament.id}
          market={modal.market}
          matchId={modal.matchId}
          contextLabel={modal.contextLabel}
          sideLabels={modal.sideLabels}
          rosterOptions={rosterOptions}
          onPosted={() => setModal(null)}
        />
      )}
    </Layout>
  );
}

// ============================================================================
// SMALL PRESENTATIONAL HELPERS
// ============================================================================

function PostButton({ player, onClick }: { player: PlayerDoc | null; onClick: () => void }) {
  if (!player) {
    return (
      <Link to="/login" className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
        Log in to bet
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-transform active:scale-95"
    >
      Post bet
    </button>
  );
}

function OfferList({
  offers,
  bettorName,
  labelFor,
  meId,
  onTake,
}: {
  offers: BetDoc[];
  bettorName: (pid: string | undefined) => string;
  labelFor: (b: BetDoc) => { teamA: string; teamB: string };
  meId: string | undefined;
  onTake: (b: BetDoc) => void;
}) {
  if (offers.length === 0) {
    return <div className="text-xs text-slate-400">No open offers yet.</div>;
  }
  return (
    <ul className="space-y-1.5">
      {offers.map((b) => {
        const labels = labelFor(b);
        const takeSide: BetSide = b.proposerSide === "teamA" ? "teamB" : "teamA";
        const mine = meId === b.proposerId;
        return (
          <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <div className="min-w-0 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">{bettorName(b.proposerId)}</span> backs{" "}
              <span className="font-semibold">{labels[b.proposerSide]}</span> · {`$${b.amount}`}
            </div>
            {meId ? (
              <button
                type="button"
                disabled={mine}
                onClick={() => onTake(b)}
                className="shrink-0 rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white transition-transform active:scale-95 disabled:bg-slate-200 disabled:text-slate-400"
              >
                {mine ? "Yours" : `Take ${labels[takeSide]}`}
              </button>
            ) : (
              <Link to="/login" className="shrink-0 text-xs font-semibold text-blue-600">
                Log in
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Section({
  title,
  count,
  trailing,
  children,
}: {
  title: string;
  count: number;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title} ({count})
        </div>
        {trailing}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function BetLine({ context, children }: { context: string; children: ReactNode }) {
  return (
    <Card className="p-3">
      <div className="text-sm font-semibold text-slate-900">{context}</div>
      {children}
    </Card>
  );
}

function NetBadge({ net }: { net: number }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
        net > 0 ? "bg-emerald-100 text-emerald-700" : net < 0 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      {net < 0 ? `-$${Math.abs(net)}` : `$${net}`}
    </span>
  );
}

function SmallBtn({
  variant,
  onClick,
  children,
}: {
  variant: "primary" | "muted";
  onClick: () => void;
  children: ReactNode;
}) {
  const cls =
    variant === "primary"
      ? "bg-slate-900 text-white"
      : "bg-slate-100 text-slate-600 hover:bg-slate-200";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-transform active:scale-95 ${cls}`}
    >
      {children}
    </button>
  );
}
