import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import Layout from "../components/Layout";
import { Card } from "../components/ui/card";
import BetSheet, { type BetEvent } from "../components/BetSheet";
import PlayerPropSheet from "../components/PlayerPropSheet";
import BetEventRow from "../components/BetEventRow";
import BetSummaryCard from "../components/BetSummaryCard";
import PlayerAvatar from "../components/PlayerAvatar";
import { useAuth } from "../contexts/AuthContext";
import { useTournamentContext } from "../contexts/TournamentContext";
import { useToast } from "../contexts/ToastContext";
import { useTournamentData } from "../hooks/useTournamentData";
import {
  useBets,
  useBetSettlements,
  useRosterPlayers,
  selectMyBets,
  needsMyConfirm,
  settledDelta,
  computeLedger,
  headToHead,
  selectPendingSettlements,
} from "../hooks/useBets";
import { betsApi } from "../api/bets";
import { toDateOrNull, formatTeeTime, formatRoundType } from "../utils";
import CommentThread from "../components/CommentThread";
import ConfirmDialog from "../components/admin/ConfirmDialog";
import BetMatchup, { type MatchupSide } from "../components/BetMatchup";
import type { BetDoc, BetSide, MatchDoc, PlayerDoc, RoundDoc } from "../types";

type Tab = "markets" | "mybets" | "chat";

const money = (n: number): string => (n < 0 ? `-$${Math.abs(n)}` : `$${n}`);
const oppositeSide = (s: BetSide): BetSide =>
  s === "teamA" ? "teamB" : s === "teamB" ? "teamA" : s === "over" ? "under" : "over";

// Over/under tile colors (mirrors OverUnderBetCard): over = emerald, under = slate.
const OVER_COLOR = "#059669";
const UNDER_COLOR = "#475569";
// Player-matchup tile colors (mirror PlayerPropSheet): subject A = blue, B = amber.
const SUBJECT_A_COLOR = "#2563eb";
const SUBJECT_B_COLOR = "#d97706";

export default function Sportsbook() {
  const { player } = useAuth();
  const { tournament } = useTournamentContext();
  const { showToast } = useToast();
  const { matchesByRound, rounds, loading: tdLoading } = useTournamentData({ prefetchedTournament: tournament });
  const { bets, loading: betsLoading } = useBets(tournament?.id);
  const settlements = useBetSettlements(tournament?.id);
  const betParticipantIds = useMemo(
    () => [
      ...new Set([
        ...bets.flatMap((b) => [b.proposerId, b.acceptorId, b.targetId].filter(Boolean) as string[]),
        ...settlements.flatMap((s) => [s.payerId, s.payeeId]),
      ]),
    ],
    [bets, settlements]
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
  // The event whose focused bet sheet is open (null = closed).
  const [selectedEvent, setSelectedEvent] = useState<BetEvent | null>(null);
  // The tournament-long player-props sheet (matchups + player point O/Us).
  const [propSheetOpen, setPropSheetOpen] = useState(false);

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
  // Last name only — keeps the compact Open Bets rows from cutting off (no two
  // players share a last name, so it stays unambiguous).
  const lastName = (full: string): string => {
    const parts = full.trim().split(/\s+/);
    return parts[parts.length - 1] || full;
  };
  const sideLastNames = (side?: { playerId: string }[]): string =>
    (side ?? []).map((p) => lastName(playerName(p.playerId))).join(" & ") || "TBD";

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
  const canCancelLocked = (b: BetDoc): boolean => {
    // Tournament-long futures (Cup, player matchups, player point O/Us) stay
    // callable until any match starts.
    if (b.market === "cupFuture" || b.market === "playerMatchup") return !tournamentStarted;
    if (b.market === "overUnder" && b.metric === "playerTournamentPoints") return !tournamentStarted;
    if (b.market === "round") {
      const ms = b.roundId ? (matchesByRound[b.roundId] ?? []) : [];
      return ms.length > 0 && ms.every((m) => !matchHasStarted(m));
    }
    // match + match-scoped over/under
    return !matchHasStarted(b.matchId ? matchesById[b.matchId] : undefined);
  };
  /** True while the bet's underlying match is in progress (drives the live pulse). */
  const isBetLive = (b: BetDoc): boolean => {
    if (b.market !== "match" || !b.matchId) return false;
    const m = matchesById[b.matchId];
    return !!m && (m.status?.thru ?? 0) > 0 && m.status?.closed !== true;
  };

  const teamNames = {
    teamA: tournament?.teamA?.name || "Team A",
    teamB: tournament?.teamB?.name || "Team B",
  };
  const teamColors = {
    teamA: tournament?.teamA?.color || "var(--team-a-default, #1e40af)",
    teamB: tournament?.teamB?.color || "var(--team-b-default, #b91c1c)",
  };

  /** Labels for a team bet's two sides — player names for matches, team names otherwise. */
  const sideLabelsForBet = (b: BetDoc): { teamA: string; teamB: string } => {
    if (b.market === "cupFuture" || b.market === "round") return teamNames;
    if (b.market === "playerMatchup") {
      return { teamA: playerName(b.subjectAId), teamB: playerName(b.subjectBId) };
    }
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
  // Player-prop subjects can be anyone in the field, including yourself.
  const propSubjectOptions = useMemo(
    () => Object.values(players).map((p: PlayerDoc) => ({ id: p.id, name: p.displayName || p.id })),
    [players]
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

  // Bettable events for the Open Bets list. A round/match is bettable until it
  // tees off; the Cup until the tournament starts.
  const roundsById: Record<string, RoundDoc> = Object.fromEntries(rounds.map((r) => [r.id, r]));
  const bettableRounds = rounds.filter((r) => {
    const ms = matchesByRound[r.id] ?? [];
    return ms.length > 0 && ms.every((m) => !matchHasStarted(m));
  });
  const bettableMatches = allMatches.filter((m) => !matchHasStarted(m));

  /** How many open offers sit on an event — drives the row's hint chip. */
  const cupOfferCount = openOffers.filter((b) => b.market === "cupFuture").length;
  const playerPropOffers = openOffers.filter(
    (b) => b.market === "playerMatchup" || (b.market === "overUnder" && b.metric === "playerTournamentPoints")
  );
  const roundOfferCount = (roundId: string) =>
    openOffers.filter((b) => b.market === "round" && b.roundId === roundId).length;
  const matchOfferCount = (matchId: string) => openOffers.filter((b) => b.matchId === matchId).length;
  const hintFor = (count: number) => (count > 0 ? `${count} open` : "Tap to bet");

  const ledger = computeLedger(bets);
  const h2h = headToHead(bets, settlements, player?.id);
  const pendingSettlements = selectPendingSettlements(settlements, player?.id);
  const outgoingPendingTo = new Set(pendingSettlements.outgoing.map((s) => s.payeeId));
  const activeCount =
    myBets.incomingChallenges.length + myBets.myOpenOffers.length + myBets.pending.length + myBets.active.length;

  // My Bets summary hero: settled P&L + record, plus outstanding tab totals.
  const summary = (() => {
    const acc = { net: 0, wins: 0, losses: 0, pushes: 0 };
    if (player) {
      for (const b of myBets.settled) {
        const d = settledDelta(b, player.id);
        acc.net += d;
        if (d > 0) acc.wins++;
        else if (d < 0) acc.losses++;
        else acc.pushes++;
      }
    }
    const owedToYou = h2h.reduce((s, r) => (r.net > 0 ? s + r.net : s), 0);
    const youOwe = h2h.reduce((s, r) => (r.net < 0 ? s + Math.abs(r.net) : s), 0);
    return { ...acc, owedToYou, youOwe };
  })();

  // ---- shared render helpers ----
  /**
   * Head-to-head tile data for a bet, filling `highlightSide`. Team markets put
   * teamA on the left / teamB on the right; over/under markets put Over on the
   * left / Under on the right. The bettor on each side fills in by name.
   */
  const matchupSides = (b: BetDoc, highlightSide: BetSide | null): { teamA: MatchupSide; teamB: MatchupSide } => {
    // The proposer sits on proposerSide; the counterparty (acceptor/target) on the other.
    const counterpartyId = b.acceptorId ?? b.targetId ?? null;
    const contentOn = (key: BetSide): ReactNode => {
      const name = b.proposerSide === key ? playerName(b.proposerId) : counterpartyId ? playerName(counterpartyId) : null;
      return name ? <span className="block truncate">{name}</span> : <span className="text-slate-400">Open</span>;
    };
    const tile = (key: BetSide, label: string, color: string): MatchupSide => ({
      label,
      color,
      filled: highlightSide === key,
      content: contentOn(key),
    });

    if (b.market === "overUnder") {
      const line = b.line ?? 0;
      // Player point props carry the player's name + a "pts" unit; match-scoped
      // over/unders (holes, margin) read as a bare number.
      const isPlayerPts = b.metric === "playerTournamentPoints";
      const prefix = isPlayerPts && b.subjectId ? `${lastName(playerName(b.subjectId))} ` : "";
      const unit = isPlayerPts ? " pts" : "";
      return {
        teamA: tile("over", `${prefix}Over ${line}${unit}`, OVER_COLOR),
        teamB: tile("under", `${prefix}Under ${line}${unit}`, UNDER_COLOR),
      };
    }
    const labels = sideLabelsForBet(b);
    // Player matchups aren't team-affiliated — use neutral subject colors.
    const colors =
      b.market === "playerMatchup"
        ? { teamA: SUBJECT_A_COLOR, teamB: SUBJECT_B_COLOR }
        : { teamA: teamColors.teamA, teamB: teamColors.teamB };
    return {
      teamA: tile("teamA", labels.teamA, colors.teamA),
      teamB: tile("teamB", labels.teamB, colors.teamB),
    };
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

  /** Header label, team-side labels, and open offers for a tapped event's bet sheet. */
  const eventSheetData = (ev: BetEvent): { label: string; sideLabels: { teamA: string; teamB: string }; offers: BetDoc[] } => {
    if (ev.kind === "cup") {
      return { label: "🏆 Cup Winner", sideLabels: teamNames, offers: openOffers.filter((b) => b.market === "cupFuture") };
    }
    if (ev.kind === "round") {
      const r = roundsById[ev.roundId];
      const label = r ? `${r.day ? `Round ${r.day}` : "Round"} · ${formatRoundType(r.format)}` : "Session";
      return {
        label,
        sideLabels: teamNames,
        offers: openOffers.filter((b) => b.market === "round" && b.roundId === ev.roundId),
      };
    }
    const m = matchesById[ev.matchId];
    const sideLabels = { teamA: sideNames(m?.teamAPlayers), teamB: sideNames(m?.teamBPlayers) };
    return {
      label: `${sideLabels.teamA} vs ${sideLabels.teamB}`,
      sideLabels,
      offers: openOffers.filter((b) => b.matchId === ev.matchId),
    };
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
            {/* Bettable events — a calm, tappable list. Tap a row to open its bet sheet. */}
            {!tournamentStarted && bettableRounds.length === 0 && bettableMatches.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🎲</div>
                <div className="empty-state-text">
                  No open markets right now — check back before the next round tees off.
                </div>
              </div>
            ) : (
              <>
                {!tournamentStarted && (
                  <div className="space-y-2">
                    <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">🏆 Cup</div>
                    <Card className="overflow-hidden p-0">
                      <BetEventRow
                        label={<span className="block truncate">Cup Winner</span>}
                        subtitle={`${teamNames.teamA} v ${teamNames.teamB}`}
                        accent={teamColors}
                        hint={hintFor(cupOfferCount)}
                        hintActive={cupOfferCount > 0}
                        onClick={() => setSelectedEvent({ kind: "cup" })}
                      />
                    </Card>
                  </div>
                )}

                {!tournamentStarted && (
                  <div className="space-y-2">
                    <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">👤 Player Props</div>
                    <Card className="overflow-hidden p-0">
                      <BetEventRow
                        label={<span className="block truncate">Player Props</span>}
                        subtitle="Matchups · tournament points O/U"
                        accent={{ teamA: SUBJECT_A_COLOR, teamB: SUBJECT_B_COLOR }}
                        hint={hintFor(playerPropOffers.length)}
                        hintActive={playerPropOffers.length > 0}
                        onClick={() => setPropSheetOpen(true)}
                      />
                    </Card>
                  </div>
                )}

                {bettableRounds.length > 0 && (
                  <div className="space-y-2">
                    <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">🗓️ Sessions</div>
                    <Card className="overflow-hidden p-0">
                      <ul className="divide-y divide-slate-100">
                        {bettableRounds.map((r) => {
                          const c = roundOfferCount(r.id);
                          return (
                            <li key={r.id}>
                              <BetEventRow
                                label={
                                  <span className="block truncate">
                                    {`${r.day ? `Round ${r.day}` : "Round"} winner`}
                                  </span>
                                }
                                subtitle={formatRoundType(r.format)}
                                accent={teamColors}
                                hint={hintFor(c)}
                                hintActive={c > 0}
                                onClick={() => setSelectedEvent({ kind: "round", roundId: r.id })}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  </div>
                )}

                {bettableMatches.length > 0 && (
                  <div className="space-y-2">
                    <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">⛳ Matches</div>
                    <Card className="overflow-hidden p-0">
                      <ul className="divide-y divide-slate-100">
                        {bettableMatches.map((m) => {
                          const c = matchOfferCount(m.id);
                          const r = m.roundId ? roundsById[m.roundId] : undefined;
                          return (
                            <li key={m.id}>
                              <BetEventRow
                                label={
                                  <>
                                    <span className="block truncate">
                                      {sideLastNames(m.teamAPlayers)} <span className="font-normal text-slate-400">vs</span>
                                    </span>
                                    <span className="block truncate">{sideLastNames(m.teamBPlayers)}</span>
                                  </>
                                }
                                subtitle={r ? `${r.day ? `Round ${r.day}` : "Round"} · ${formatRoundType(r.format)}` : undefined}
                                accent={teamColors}
                                hint={hintFor(c)}
                                hintActive={c > 0}
                                onClick={() => setSelectedEvent({ kind: "match", matchId: m.id })}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  </div>
                )}
              </>
            )}

            {/* Shared ledger — everyone's settled-bet standings ("Money Leaders") */}
            <div className="space-y-2">
              <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">💰 Money Leaders</div>
              {ledger.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">💸</div>
                  <div className="empty-state-text">No settled bets yet — the ledger fills in as matches finish.</div>
                </div>
              ) : (
                <Card className="overflow-hidden p-0">
                  <ul className="divide-y divide-slate-100">
                    {ledger.map((row, i) => {
                      const isMe = !!player && row.playerId === player.id;
                      return (
                        <li
                          key={row.playerId}
                          className={`flex items-center gap-3 px-4 py-3 ${isMe ? "bg-slate-900/[0.04]" : ""}`}
                        >
                          <RankBadge rank={i + 1} />
                          <PlayerAvatar name={playerName(row.playerId)} size={32} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-semibold text-slate-900">{playerName(row.playerId)}</span>
                              {isMe && (
                                <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-slate-600">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.wins}W · {row.losses}L{row.pushes > 0 ? ` · ${row.pushes}P` : ""}
                            </div>
                          </div>
                          <div className={`text-lg font-bold tabular-nums ${row.net > 0 ? "text-emerald-600" : row.net < 0 ? "text-red-600" : "text-slate-400"}`}>
                            {money(row.net)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              )}
            </div>
          </div>
        ) : tab === "mybets" ? (
          // ============== MY BETS (your tab + active/completed) ===============
          <div className="space-y-4">
            {/* Summary hero: settled net + record + outstanding tab totals */}
            {player && (myBets.settled.length > 0 || h2h.length > 0) && (
              <BetSummaryCard
                net={summary.net}
                wins={summary.wins}
                losses={summary.losses}
                pushes={summary.pushes}
                owedToYou={summary.owedToYou}
                youOwe={summary.youOwe}
              />
            )}

            {/* Your tab: head-to-head balances + settle-up */}
            {player &&
              (h2h.length > 0 ||
                pendingSettlements.incoming.length > 0 ||
                pendingSettlements.outgoing.length > 0) && (
                <Card className="space-y-3 p-4">
                  <div className="text-sm font-bold text-slate-900">Your tab</div>

                  {h2h.length > 0 && (
                    <ul className="space-y-2">
                      {h2h.map((row) => {
                        const owe = row.net < 0;
                        return (
                          <li key={row.otherId} className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate text-slate-700">
                              {row.net > 0 ? `${playerName(row.otherId)} owes you` : `You owe ${playerName(row.otherId)}`}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className={`font-bold tabular-nums ${row.net > 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {money(Math.abs(row.net))}
                              </span>
                              {owe && !outgoingPendingTo.has(row.otherId) && (
                                <SmallBtn
                                  variant="primary"
                                  onClick={() =>
                                    confirmThen({
                                      title: "Settle up?",
                                      body: `Mark $${Math.abs(row.net)} as paid to ${playerName(row.otherId)}? They'll confirm they received it, then it clears from your tab.`,
                                      confirmLabel: "Mark paid",
                                      run: () =>
                                        betsApi.recordSettlement({
                                          tournamentId: tournament.id,
                                          payeeId: row.otherId,
                                          amount: Math.abs(row.net),
                                        }),
                                      success: "Marked paid — waiting on them to confirm.",
                                    })
                                  }
                                >
                                  Settle up
                                </SmallBtn>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* Incoming: someone says they paid you — confirm or dispute */}
                  {pendingSettlements.incoming.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-amber-800">
                        {playerName(s.payerId)} paid you <span className="font-bold">${s.amount}</span>
                      </span>
                      <span className="flex shrink-0 gap-2">
                        <SmallBtn
                          variant="primary"
                          onClick={() =>
                            runAction(() => betsApi.confirmSettlement({ settlementId: s.id }), "Confirmed — tab updated.")
                          }
                        >
                          Confirm
                        </SmallBtn>
                        <SmallBtn
                          variant="muted"
                          onClick={() =>
                            confirmThen({
                              title: "Dispute this payment?",
                              body: `Reject ${playerName(s.payerId)}'s record of paying you $${s.amount}? Use this if you didn't receive it.`,
                              confirmLabel: "Dispute",
                              run: () => betsApi.cancelSettlement({ settlementId: s.id }),
                              success: "Payment record removed.",
                            })
                          }
                        >
                          Dispute
                        </SmallBtn>
                      </span>
                    </div>
                  ))}

                  {/* Outgoing: you recorded a payment — awaiting their confirm */}
                  {pendingSettlements.outgoing.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-slate-600">
                        You paid {playerName(s.payeeId)} <span className="font-bold">${s.amount}</span> · awaiting confirm
                      </span>
                      <SmallBtn
                        variant="muted"
                        onClick={() =>
                          confirmThen({
                            title: "Cancel this record?",
                            body: `Remove your record of paying ${playerName(s.payeeId)} $${s.amount}?`,
                            confirmLabel: "Remove",
                            run: () => betsApi.cancelSettlement({ settlementId: s.id }),
                            success: "Payment record removed.",
                          })
                        }
                      >
                        Cancel
                      </SmallBtn>
                    </div>
                  ))}
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
                          <div>
                            <StatusPill tone="amber">
                              {iConfirm ? "Confirm to lock in" : "Waiting on them"}
                            </StatusPill>
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
                        <BetCard key={b.id} {...matchTrack(b)} live={isBetLive(b)} teamA={sides.teamA} teamB={sides.teamB} amount={b.amount}>
                          <div className="flex items-center justify-between gap-2">
                            <StatusPill tone="emerald">Locked in</StatusPill>
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
                            <StatusPill tone={delta > 0 ? "emerald" : delta < 0 ? "red" : "slate"}>
                              {delta > 0 ? "Won" : delta < 0 ? "Lost" : "Push"}
                            </StatusPill>
                            <span
                              className={`text-sm font-bold tabular-nums ${
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

      {/* Focused bet sheet for the tapped event (match winner / holes O/U, session, or cup). */}
      {selectedEvent &&
        (() => {
          const d = eventSheetData(selectedEvent);
          const key =
            selectedEvent.kind === "match"
              ? `m-${selectedEvent.matchId}`
              : selectedEvent.kind === "round"
                ? `r-${selectedEvent.roundId}`
                : "cup";
          return (
            <BetSheet
              key={key}
              isOpen
              onClose={() => setSelectedEvent(null)}
              tournamentId={tournament.id}
              event={selectedEvent}
              label={d.label}
              sideLabels={d.sideLabels}
              teamTags={teamNames}
              teamColors={teamColors}
              openOffers={d.offers}
              loggedIn={!!player}
              meId={player?.id}
              rosterOptions={rosterOptions}
              bettorName={playerName}
              onTake={(b) => runAction(() => betsApi.acceptBet({ betId: b.id }), "Taken — confirm it in My Bets.")}
            />
          );
        })()}

      {/* Tournament-long player props sheet (matchups + player point O/Us). */}
      {propSheetOpen && (
        <PlayerPropSheet
          isOpen
          onClose={() => setPropSheetOpen(false)}
          tournamentId={tournament.id}
          openOffers={playerPropOffers}
          loggedIn={!!player}
          meId={player?.id}
          rosterOptions={propSubjectOptions}
          bettorName={playerName}
          onTake={(b) => runAction(() => betsApi.acceptBet({ betId: b.id }), "Taken — confirm it in My Bets.")}
        />
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
  live,
  children,
}: {
  teamA: MatchupSide;
  teamB: MatchupSide;
  amount: number;
  to?: string;
  status?: ReactNode;
  /** When the underlying match is in progress, give the card a soft pulse. */
  live?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card className={`space-y-2 p-3 ${live ? "animate-soft-pulse" : ""}`}>
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

/** Leaderboard rank chip — medal colors for the top 3, neutral circle otherwise. */
function RankBadge({ rank }: { rank: number }) {
  const medal: Record<number, string> = {
    1: "bg-amber-100 text-amber-700 ring-1 ring-amber-300",
    2: "bg-slate-200 text-slate-600 ring-1 ring-slate-300",
    3: "bg-orange-100 text-orange-700 ring-1 ring-orange-300",
  };
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
        medal[rank] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {rank}
    </span>
  );
}

/** A small status pill with a semantic tone, for a bet's lifecycle state. */
function StatusPill({ tone, children }: { tone: "amber" | "emerald" | "red" | "slate"; children: ReactNode }) {
  const cls = {
    amber: "bg-amber-100 text-amber-700",
    emerald: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
    slate: "bg-slate-100 text-slate-600",
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide ${cls}`}>
      {children}
    </span>
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
