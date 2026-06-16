import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import Layout from "../components/Layout";
import { Card } from "../components/ui/card";
import InlineBetCard from "../components/InlineBetCard";
import BetOfferRow from "../components/BetOfferRow";
import { useAuth } from "../contexts/AuthContext";
import { useTournamentContext } from "../contexts/TournamentContext";
import { useToast } from "../contexts/ToastContext";
import { useTournamentData } from "../hooks/useTournamentData";
import {
  useBets,
  useRosterPlayers,
  selectMyBets,
  needsMyConfirm,
  settledDelta,
  computeLedger,
  headToHead,
} from "../hooks/useBets";
import { betsApi } from "../api/bets";
import { toDateOrNull, formatTeeTime } from "../utils";
import CommentThread from "../components/CommentThread";
import ConfirmDialog from "../components/admin/ConfirmDialog";
import BetMatchup, { type MatchupSide } from "../components/BetMatchup";
import type { BetDoc, BetSide, MatchDoc, PlayerDoc } from "../types";

type Tab = "markets" | "mybets" | "chat";

const money = (n: number): string => (n < 0 ? `-$${Math.abs(n)}` : `$${n}`);
const oppositeSide = (s: BetSide): BetSide => (s === "teamA" ? "teamB" : "teamA");

export default function Sportsbook() {
  const { player } = useAuth();
  const { tournament } = useTournamentContext();
  const { showToast } = useToast();
  const { matchesByRound, loading: tdLoading } = useTournamentData({ prefetchedTournament: tournament });
  const { bets, loading: betsLoading } = useBets(tournament?.id);
  const betParticipantIds = useMemo(
    () => [...new Set(bets.flatMap((b) => [b.proposerId, b.acceptorId, b.targetId].filter(Boolean) as string[]))],
    [bets]
  );
  const { players, loading: playersLoading } = useRosterPlayers(tournament, betParticipantIds);

  // Back the active tab with a URL search param so it survives navigation: tap
  // into a match scorecard and the browser Back button returns to the same tab,
  // not a freshly-mounted default. `replace` keeps tab switches out of history.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab =
    tabParam === "mybets"
      ? "mybets"
      : tabParam === "chat" && tournament?.commentsEnabled
        ? "chat"
        : "markets";
  const setTab = (t: Tab) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === "markets") next.delete("tab");
        else next.set("tab", t);
        return next;
      },
      { replace: true }
    );
  // Wall-clock used to tell whether a match has teed off; refreshed periodically
  // (read via state to keep Date.now() out of the render path).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Never fall back to the raw player ID — show a neutral placeholder if a name
  // hasn't resolved (the loading gate below normally prevents this from showing).
  const playerName = (pid: string | undefined): string =>
    (pid && players[pid]?.displayName) || "Unknown";
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

  /** Mirror of the backend's matchStartedPlay: scored, closed, locked, or teed off. */
  const matchHasStarted = (m: MatchDoc | undefined): boolean => {
    if (!m) return true; // unknown match -> treat as locked, hide cancel
    if (m.locked === true || m.status?.closed === true) return true;
    if ((m.status?.thru ?? 0) > 0) return true;
    const tee = toDateOrNull(m.teeTime);
    return tee !== null && tee.getTime() <= nowMs;
  };
  /** A locked-in bet can still be called off until its market starts. */
  const canCancelLocked = (b: BetDoc): boolean =>
    b.market === "cupFuture" ? !tournamentStarted : !matchHasStarted(b.matchId ? matchesById[b.matchId] : undefined);

  const teamNames = {
    teamA: tournament?.teamA?.name || "Team A",
    teamB: tournament?.teamB?.name || "Team B",
  };
  const teamColors = {
    teamA: tournament?.teamA?.color || "var(--team-a-default, #1e40af)",
    teamB: tournament?.teamB?.color || "var(--team-b-default, #b91c1c)",
  };

  /** Labels for a bet's two sides — player names for matches, team names for futures. */
  const sideLabelsForBet = (b: BetDoc): { teamA: string; teamB: string } => {
    if (b.market === "cupFuture") return teamNames;
    const m = b.matchId ? matchesById[b.matchId] : undefined;
    return { teamA: sideNames(m?.teamAPlayers), teamB: sideNames(m?.teamBPlayers) };
  };
  /** The team `playerId` is betting on this bet. */
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

  // Cancel/withdraw actions confirm first — pulling a bet shouldn't be a stray tap.
  const [confirmState, setConfirmState] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    run: () => Promise<unknown>;
    success: string;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const confirmThen = (opts: {
    title: string;
    body: string;
    confirmLabel: string;
    run: () => Promise<unknown>;
    success: string;
  }) => setConfirmState(opts);

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

  // Hold the spinner until display names are ready so player IDs never flash in.
  // Only gate on the *initial* name fetch (no roster cached yet) — once we have
  // names, a later real-time bet update shouldn't blank the whole page.
  const namesPending = playersLoading && Object.keys(players).length === 0;
  const loading = tdLoading || betsLoading || namesPending;
  const myBets = selectMyBets(bets, player?.id);
  const openOffers = bets.filter((b) => b.status === "open" && b.kind === "offer");

  // Open match offers grouped by match, for the Markets marketplace.
  const matchOfferGroups = (() => {
    const groups = new Map<string, BetDoc[]>();
    for (const b of openOffers) {
      if (b.market !== "match" || !b.matchId) continue;
      if (!groups.has(b.matchId)) groups.set(b.matchId, []);
      groups.get(b.matchId)!.push(b);
    }
    return [...groups.entries()].map(([matchId, offers]) => ({ matchId, offers }));
  })();
  const ledger = computeLedger(bets);
  const h2h = headToHead(bets, player?.id);
  const activeCount =
    myBets.incomingChallenges.length + myBets.myOpenOffers.length + myBets.pending.length + myBets.active.length;

  // ---- shared render helpers ----
  /** Head-to-head tile data for a bet (Team A left / Team B right), filling `highlightSide`. */
  const matchupSides = (b: BetDoc, highlightSide: BetSide | null): { teamA: MatchupSide; teamB: MatchupSide } => {
    const labels = sideLabelsForBet(b);
    const nameOn = (key: BetSide): string | null => {
      if (b.proposerSide === key) return playerName(b.proposerId);
      if (b.acceptorId) return playerName(b.acceptorId);
      if (b.targetId) return playerName(b.targetId);
      return null; // unfilled side of an open offer
    };
    const side = (key: BetSide, color: string): MatchupSide => {
      const name = nameOn(key);
      return {
        label: labels[key],
        color,
        filled: highlightSide === key,
        content: name ? (
          <span className="block truncate">{name}</span>
        ) : (
          <span className="text-slate-400">Open</span>
        ),
      };
    };
    return { teamA: side("teamA", teamColors.teamA), teamB: side("teamB", teamColors.teamB) };
  };

  const opponentName = (b: BetDoc): string =>
    playerName(player && b.proposerId === player.id ? b.acceptorId : b.proposerId);

  /**
   * Live match tracking for a match bet: a scorecard link plus a status strip
   * (tee time → live score from the bettor's perspective → final result).
   * Returns `{}` for Cup futures or matches we haven't loaded yet.
   */
  const matchTrack = (b: BetDoc): { to?: string; status?: ReactNode } => {
    if (b.market !== "match" || !b.matchId) return {};
    const m = matchesById[b.matchId];
    if (!m) return {};
    const pick = player ? mySide(b, player.id) : null;
    return { to: `/match/${b.matchId}`, status: <MatchTrackLine match={m} pick={pick} /> };
  };

  return (
    <Layout title="Sportsbook" series={tournament.series} showBack tournamentLogo={tournament.tournamentLogo}>
      <div className="space-y-4 p-4">
        {/* Tabs */}
        <div className="flex gap-1.5">
          {(
            [
              { id: "markets", label: "Open Bets" },
              { id: "mybets", label: "My Bets" },
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
          // ========================== OPEN BETS ===========================
          // Each bettable event is a card you bet on in place: tap a team to
          // bet it, set the stake, post an open offer or challenge a player.
          // Existing open offers are listed on each card to take. The shared
          // ledger (everyone's standings) lives at the bottom.
          <div className="space-y-4">
            {/* Cup futures — bettable until the tournament starts */}
            {!tournamentStarted && (
              <InlineBetCard
                tournamentId={tournament.id}
                market="cupFuture"
                title="🏆 Cup Winner"
                sideLabels={teamNames}
                teamTags={teamNames}
                teamColors={teamColors}
                openOffers={openOffers.filter((b) => b.market === "cupFuture")}
                loggedIn={!!player}
                meId={player?.id}
                rosterOptions={rosterOptions}
                bettorName={playerName}
                onTake={(b) =>
                  runAction(() => betsApi.acceptBet({ betId: b.id }), "Taken — confirm it in My Bets.")
                }
                onPosted={() => undefined}
              />
            )}

            {/* Open match bets — take an offer someone posted. Match bets are
                created from the Rounds / scorecard pages ("Bet Me"). */}
            {matchOfferGroups.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🎲</div>
                <div className="empty-state-text">
                  No open match bets right now. Open a round and tap{" "}
                  <span className="font-semibold">Bet Me</span> under a match to start one.
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Open match bets
                </div>
                {matchOfferGroups.map((group) => {
                  const labels = sideLabelsForBet(group.offers[0]);
                  return (
                    <Card key={group.matchId} className="p-4">
                      <div className="mb-2 text-sm font-bold">
                        <span className="block" style={{ color: teamColors.teamA }}>
                          {labels.teamA} <span className="text-slate-400">vs</span>
                        </span>
                        <span className="block" style={{ color: teamColors.teamB }}>
                          {labels.teamB}
                        </span>
                      </div>
                      <ul className="space-y-1.5">
                        {group.offers.map((b) => (
                          <BetOfferRow
                            key={b.id}
                            teamALabel={labels.teamA}
                            teamBLabel={labels.teamB}
                            teamAColor={teamColors.teamA}
                            teamBColor={teamColors.teamB}
                            proposerSide={b.proposerSide}
                            proposerName={playerName(b.proposerId)}
                            amount={b.amount}
                            mine={player?.id === b.proposerId}
                            loggedIn={!!player}
                            onTake={() =>
                              runAction(() => betsApi.acceptBet({ betId: b.id }), "Taken — confirm it in My Bets.")
                            }
                          />
                        ))}
                      </ul>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Shared ledger — everyone's settled-bet standings */}
            <div className="space-y-2">
              <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Standings</div>
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
          </div>
        ) : tab === "mybets" ? (
          // ============== MY BETS (your tab + active/completed) ===============
          <div className="space-y-4">
            {/* Your tab: head-to-head balances with each opponent */}
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

            {/* Personal bets (login required) */}
            {!player ? (
              <div className="empty-state">
                <div className="empty-state-icon">🔒</div>
                <div className="empty-state-text">
                  <Link to="/login" className="font-semibold text-blue-600 underline">
                    Log in
                  </Link>{" "}
                  to place and track your bets.
                </div>
              </div>
            ) : (
              <>
                <Collapsible title="Active Bets" count={activeCount} defaultOpen>
                  <Section title="Incoming challenges" count={myBets.incomingChallenges.length}>
                    {myBets.incomingChallenges.map((b) => {
                      const sides = matchupSides(b, b.proposerSide);
                      return (
                        <BetCard key={b.id} {...matchTrack(b)} teamA={sides.teamA} teamB={sides.teamB} amount={b.amount}>
                          <div className="text-[0.7rem] font-semibold text-slate-500">
                            {playerName(b.proposerId)} challenges you
                          </div>
                          <div className="flex gap-2">
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
                        </BetCard>
                      );
                    })}
                  </Section>

                  <Section title="My open offers" count={myBets.myOpenOffers.length}>
                    {myBets.myOpenOffers.map((b) => {
                      const sides = matchupSides(b, b.proposerSide);
                      return (
                        <BetCard key={b.id} {...matchTrack(b)} teamA={sides.teamA} teamB={sides.teamB} amount={b.amount}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[0.7rem] font-semibold text-slate-500">
                              {b.kind === "challenge" ? `Challenge to ${playerName(b.targetId)}` : "Open to anyone"}
                            </span>
                            <SmallBtn
                              variant="muted"
                              onClick={() =>
                                confirmThen({
                                  title: "Cancel this offer?",
                                  body: `This removes your $${b.amount} offer from the marketplace. No one has taken it yet.`,
                                  confirmLabel: "Cancel offer",
                                  run: () => betsApi.cancelBet({ betId: b.id }),
                                  success: "Offer cancelled.",
                                })
                              }
                            >
                              Cancel
                            </SmallBtn>
                          </div>
                        </BetCard>
                      );
                    })}
                  </Section>

                  <Section title="Awaiting confirmation" count={myBets.pending.length}>
                    {myBets.pending.map((b) => {
                      const iConfirm = needsMyConfirm(b, player.id);
                      const iAmAcceptor = b.acceptorId === player.id;
                      const sides = matchupSides(b, mySide(b, player.id));
                      return (
                        <BetCard key={b.id} {...matchTrack(b)} teamA={sides.teamA} teamB={sides.teamB} amount={b.amount}>
                          <div className="text-[0.7rem] font-semibold text-amber-600">
                            {iConfirm ? "Waiting on you to confirm" : "Waiting on the other player"}
                          </div>
                          <div className="flex gap-2">
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
                                onClick={() =>
                                  confirmThen({
                                    title: "Withdraw from this bet?",
                                    body: `Withdraw from this $${b.amount} bet with ${opponentName(b)}? It isn't locked in yet.`,
                                    confirmLabel: "Withdraw",
                                    run: () => betsApi.withdrawAcceptance({ betId: b.id }),
                                    success: "Withdrawn.",
                                  })
                                }
                              >
                                Withdraw
                              </SmallBtn>
                            ) : (
                              <SmallBtn
                                variant="muted"
                                onClick={() =>
                                  confirmThen({
                                    title: "Cancel this bet?",
                                    body: `${opponentName(b)} has taken this $${b.amount} bet but it isn't locked in yet. Cancelling removes it.`,
                                    confirmLabel: "Cancel bet",
                                    run: () => betsApi.cancelBet({ betId: b.id }),
                                    success: "Cancelled.",
                                  })
                                }
                              >
                                Cancel
                              </SmallBtn>
                            )}
                          </div>
                        </BetCard>
                      );
                    })}
                  </Section>

                  <Section title="Locked in" count={myBets.active.length}>
                    {myBets.active.map((b) => {
                      const sides = matchupSides(b, mySide(b, player.id));
                      const cancellable = canCancelLocked(b);
                      return (
                        <BetCard key={b.id} {...matchTrack(b)} teamA={sides.teamA} teamB={sides.teamB} amount={b.amount}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[0.7rem] font-semibold text-emerald-600">Locked in</span>
                            {cancellable && (
                              <SmallBtn
                                variant="muted"
                                onClick={() =>
                                  confirmThen({
                                    title: "Cancel this bet?",
                                    body: `This calls off your locked-in $${b.amount} bet with ${opponentName(b)}. Neither of you wins or loses. This can't be undone once the match starts.`,
                                    confirmLabel: "Cancel bet",
                                    run: () => betsApi.cancelBet({ betId: b.id }),
                                    success: "Bet cancelled.",
                                  })
                                }
                              >
                                Cancel
                              </SmallBtn>
                            )}
                          </div>
                          {cancellable && (
                            <div className="text-[0.65rem] text-slate-400">
                              Either player can cancel until the match starts.
                            </div>
                          )}
                        </BetCard>
                      );
                    })}
                  </Section>

                  {activeCount === 0 && (
                    <div className="px-1 text-xs text-slate-400">No active bets — find some action in Markets.</div>
                  )}
                </Collapsible>

                <Collapsible
                  title="Completed Bets"
                  count={myBets.settled.length}
                  trailing={
                    myBets.settled.length > 0 ? (
                      <NetBadge net={myBets.settled.reduce((sum, b) => sum + settledDelta(b, player.id), 0)} />
                    ) : undefined
                  }
                >
                  {myBets.settled.length === 0 ? (
                    <div className="px-1 text-xs text-slate-400">No completed bets yet.</div>
                  ) : (
                    myBets.settled.map((b) => {
                      const delta = settledDelta(b, player.id);
                      const sides = matchupSides(b, mySide(b, player.id));
                      return (
                        <BetCard key={b.id} {...matchTrack(b)} teamA={sides.teamA} teamB={sides.teamB} amount={b.amount}>
                          <div className="flex items-center justify-between">
                            <span className="text-[0.7rem] font-semibold text-slate-500">
                              {delta > 0 ? "You won" : delta < 0 ? "You lost" : "Push — no money"}
                            </span>
                            <span
                              className={`text-sm font-bold ${
                                delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-slate-400"
                              }`}
                            >
                              {delta === 0 ? "Push" : money(delta)}
                            </span>
                          </div>
                        </BetCard>
                      );
                    })
                  )}
                </Collapsible>
              </>
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

      {confirmState && (
        <ConfirmDialog
          isOpen
          danger
          busy={confirmBusy}
          title={confirmState.title}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel="Keep it"
          onConfirm={async () => {
            setConfirmBusy(true);
            await runAction(confirmState.run, confirmState.success);
            setConfirmBusy(false);
            setConfirmState(null);
          }}
          onCancel={() => setConfirmState(null)}
        >
          {confirmState.body}
        </ConfirmDialog>
      )}
    </Layout>
  );
}

// ============================================================================
// SMALL PRESENTATIONAL HELPERS
// ============================================================================

/** A titled, collapsible group with a count and optional trailing node in the header. */
function Collapsible({
  title,
  count,
  defaultOpen = false,
  trailing,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg px-1 py-1.5"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`} />
          {title} ({count})
        </span>
        {trailing}
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="space-y-2">
      <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title} ({count})
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/**
 * A My-Bets entry: the head-to-head matchup tile, plus status/action children
 * below it. For match bets, `status` shows live scoring inside the tile and `to`
 * makes the whole tile tap to the match scorecard. Action buttons live in
 * `children`, outside the link, so they never trip navigation.
 */
function BetCard({
  teamA,
  teamB,
  amount,
  to,
  status,
  children,
}: {
  teamA: MatchupSide;
  teamB: MatchupSide;
  amount: number;
  to?: string;
  status?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="space-y-2 p-3">
      {to ? (
        <ViewTransitionLink to={to} className="block rounded-lg active:opacity-80">
          <BetMatchup teamA={teamA} teamB={teamB} amount={amount} footer={status} />
        </ViewTransitionLink>
      ) : (
        <BetMatchup teamA={teamA} teamB={teamB} amount={amount} footer={status} />
      )}
      {children}
    </Card>
  );
}

/**
 * The live-tracking strip inside a match bet's tile. Reads from the bettor's
 * perspective (`pick`): tee time before the off, "You're 2 up · Thru 5" while
 * live (green when ahead, red when behind), and the final result when closed.
 * A chevron signals the tile taps through to the scorecard.
 */
function MatchTrackLine({ match, pick }: { match: MatchDoc; pick: BetSide | null }) {
  const st = match.status;
  const thru = st?.thru ?? 0;
  const closed = st?.closed === true;
  const leader = st?.leader ?? null;
  const margin = st?.margin ?? 0;

  let dot: ReactNode = null;
  let text: string;
  let tone: "win" | "lose" | "neutral" = "neutral";

  if (closed) {
    const winner = match.result?.winner ?? leader ?? "AS";
    if (winner === "AS" || !leader) {
      text = "Halved · Final";
    } else {
      const marginText = thru >= 18 ? `${margin} UP` : `${margin}&${18 - thru}`;
      if (pick) {
        const won = winner === pick;
        text = `${won ? "Won" : "Lost"} ${marginText} · Final`;
        tone = won ? "win" : "lose";
      } else {
        text = `${marginText} · Final`;
      }
    }
  } else if (thru > 0) {
    // Live — a pulsing dot plus the score from the bettor's point of view.
    dot = <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />;
    if (!leader) {
      text = `All square · Thru ${thru}`;
    } else if (pick) {
      const up = leader === pick;
      text = `You're ${margin} ${up ? "up" : "down"} · Thru ${thru}`;
      tone = up ? "win" : "lose";
    } else {
      text = `${margin} up · Thru ${thru}`;
    }
  } else {
    const tee = formatTeeTime(match.teeTime);
    text = tee ? `Tees off ${tee}` : "Not started";
  }

  const toneClass =
    tone === "win" ? "text-emerald-600" : tone === "lose" ? "text-red-600" : "text-slate-500";

  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`flex min-w-0 items-center gap-1.5 ${toneClass}`}>
        {dot}
        <span className="truncate">{text}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-slate-400">
        <span className="text-[0.6rem] uppercase tracking-wide">Scorecard</span>
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </div>
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
    variant === "primary" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200";
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
