import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
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
import { toDateOrNull } from "../utils";
import CommentThread from "../components/CommentThread";
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
  const players = useRosterPlayers(tournament, betParticipantIds);

  const [tab, setTab] = useState<Tab>("markets");
  // Wall-clock used to tell whether a match has teed off; refreshed periodically
  // (read via state to keep Date.now() out of the render path).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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
  const sideBadge = (label: string) => (
    <span className="inline-block max-w-[11rem] truncate rounded bg-slate-100 px-1.5 py-0.5 align-bottom text-xs font-semibold text-slate-700">
      {label}
    </span>
  );

  const opponentName = (b: BetDoc): string =>
    playerName(player && b.proposerId === player.id ? b.acceptorId : b.proposerId);

  return (
    <Layout title="Sportsbook" series={tournament.series} showBack tournamentLogo={tournament.tournamentLogo}>
      <div className="space-y-4 p-4">
        {/* Tabs */}
        <div className="flex gap-1.5">
          {(
            [
              { id: "markets", label: "Markets" },
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
          // ============================ MARKETS ============================
          // Each bettable event is a card you bet on in place: tap a team to
          // back it, set the stake, post an open offer or challenge a player.
          // Existing open offers are listed on each card to take.
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
                      <div className="mb-2 text-sm font-bold text-slate-900">{contextForBet(group.offers[0])}</div>
                      <ul className="space-y-1.5">
                        {group.offers.map((b) => (
                          <BetOfferRow
                            key={b.id}
                            dotColor={teamColors[b.proposerSide]}
                            proposerName={playerName(b.proposerId)}
                            backsLabel={labels[b.proposerSide]}
                            takeLabel={labels[oppositeSide(b.proposerSide)]}
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
          </div>
        ) : tab === "mybets" ? (
          // ================== MY BETS (ledger + active/completed) ==================
          <div className="space-y-4">
            {/* Ledger: your tab (head-to-head), then everyone's standings */}
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
                    {myBets.incomingChallenges.map((b) => (
                      <BetLine key={b.id} context={contextForBet(b)} amount={b.amount}>
                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
                          <span className="font-semibold text-slate-700">{playerName(b.proposerId)}</span>
                          <span>challenges you · you'd back</span>
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
                      <BetLine key={b.id} context={contextForBet(b)} amount={b.amount}>
                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
                          <span>backing</span>
                          {sideBadge(sideLabelsForBet(b)[b.proposerSide])}
                          <span>· {b.kind === "challenge" ? `to ${playerName(b.targetId)}` : "open to anyone"}</span>
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
                        <BetLine key={b.id} context={contextForBet(b)} amount={b.amount}>
                          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
                            <span>you back</span>
                            {sideBadge(sideLabelsForBet(b)[side ?? "teamA"])}
                            <span>· vs {opponentName(b)}</span>
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

                  <Section title="Locked in" count={myBets.active.length}>
                    {myBets.active.map((b) => {
                      const side = mySide(b, player.id);
                      const cancellable = canCancelLocked(b);
                      return (
                        <BetLine key={b.id} context={contextForBet(b)} amount={b.amount}>
                          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
                            <span>you back</span>
                            {sideBadge(sideLabelsForBet(b)[side ?? "teamA"])}
                            <span>· vs {opponentName(b)}</span>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="text-[0.7rem] font-semibold text-emerald-600">Locked in</span>
                            {cancellable && (
                              <SmallBtn
                                variant="muted"
                                onClick={() => runAction(() => betsApi.cancelBet({ betId: b.id }), "Bet cancelled.")}
                              >
                                Cancel
                              </SmallBtn>
                            )}
                          </div>
                          {cancellable && (
                            <div className="mt-1 text-[0.65rem] text-slate-400">
                              Either player can cancel until the match starts.
                            </div>
                          )}
                        </BetLine>
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
                      return (
                        <BetLine key={b.id} context={contextForBet(b)}>
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-slate-500">vs {opponentName(b)}</div>
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

function BetLine({ context, amount, children }: { context: string; amount?: number; children: ReactNode }) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-semibold text-slate-900">{context}</div>
        {amount != null && (
          <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-sm font-bold tabular-nums text-slate-700">
            ${amount}
          </span>
        )}
      </div>
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
