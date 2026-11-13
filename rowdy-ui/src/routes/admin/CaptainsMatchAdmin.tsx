import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, doc, getDocs, onSnapshot } from "firebase/firestore";
import { ExternalLink } from "lucide-react";
import { db } from "../../firebase";
import AdminPage, { AdminNotFound } from "../../components/admin/AdminPage";
import AdminSection from "../../components/admin/AdminSection";
import CaptainsMatchForm from "../../components/admin/CaptainsMatchForm";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import DangerZone from "../../components/admin/DangerZone";
import IndexTile from "../../components/admin/IndexTile";
import NavRow from "../../components/admin/NavRow";
import { InfoNote, ToggleRow } from "../../components/admin/fields";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useAdminTournament } from "../../contexts/AdminTournamentContext";
import { adminApi } from "../../api/admin";
import { betsApi } from "../../api/bets";
import { getErrorMessage } from "../../api/errors";
import {
  formatCaptainsMatchStatus,
  formatPlayedOn,
  formatRoundRanges,
  missingRoundNumbers,
  summarizeCaptainsMatch,
  type CaptainsRoundSummary,
} from "../../utils/captainsMatchScoring";
import type { CaptainsMatchSettings } from "../../api/adminContracts";
import type { CaptainsMatchDoc, PlayerDoc } from "../../types";

/**
 * Admin page for a tournament's captains' match — the pre-draft running singles
 * match between the captains: its settings, a row per round that opens that
 * round's card, and deletion. Creating it is the same form, empty.
 */
export default function CaptainsMatchAdmin() {
  const navigate = useNavigate();
  const { tournamentId, tournament, loading: ctxLoading } = useAdminTournament();

  const [match, setMatch] = useState<CaptainsMatchDoc | null>(null);
  const [matchLoaded, setMatchLoaded] = useState(false);
  const [allPlayers, setAllPlayers] = useState<PlayerDoc[]>([]);
  const [playersLoading, setPlayersLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bettingBusy, setBettingBusy] = useState(false);
  const [settling, setSettling] = useState(false);
  const [confirmSettleSeason, setConfirmSettleSeason] = useState(false);
  const [settleRound, setSettleRound] = useState<number | null>(null);

  // The players usually aren't on a roster yet (the captains are known before
  // the draft), so the pickers list everyone.
  useEffect(() => {
    getDocs(collection(db, "players"))
      .then((snap) =>
        setAllPlayers(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as PlayerDoc))
            .sort((a, b) => (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id))
        )
      )
      .catch((err) => setError(getErrorMessage(err, "Failed to load players")))
      .finally(() => setPlayersLoading(false));
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "captainsMatches", tournamentId),
      (snap) => {
        setMatch(snap.exists() ? ({ id: snap.id, ...snap.data() } as CaptainsMatchDoc) : null);
        setMatchLoaded(true);
      },
      (err) => {
        setError(getErrorMessage(err, "Failed to load the captains' match"));
        setMatchLoaded(true);
      }
    );
    return unsub;
  }, [tournamentId]);

  const summary = useMemo(() => (match ? summarizeCaptainsMatch(match) : null), [match]);
  const nameById = useMemo(
    () => Object.fromEntries(allPlayers.map((p) => [p.id, p.displayName ?? p.id])),
    [allPlayers]
  );

  const handleSubmit = async (settings: CaptainsMatchSettings) => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await adminApi.saveCaptainsMatch({ tournamentId, ...settings });
      setSuccess(res.created ? "Captains' match created." : "Settings saved.");
    } catch (err) {
      console.error("Error saving captains' match:", err);
      setError(getErrorMessage(err, "Failed to save the captains' match"));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBetting = async (open: boolean) => {
    setError(null);
    setSuccess(null);
    setBettingBusy(true);
    try {
      await adminApi.saveCaptainsMatch({ tournamentId, bettingOpen: open });
      setSuccess(open ? "Betting is open." : "Betting is closed.");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to change the betting switch"));
    } finally {
      setBettingBusy(false);
    }
  };

  const settleBets = async (scope: "round" | "season", roundNumber?: number) => {
    setError(null);
    setSuccess(null);
    setSettling(true);
    try {
      const res = await betsApi.settleCaptainsMatchBets({ tournamentId, scope, roundNumber });
      const what = scope === "round" ? `round ${roundNumber}` : "season";
      setSuccess(`Settled ${res.settledCount} ${what} bet${res.settledCount === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't settle those bets"));
    } finally {
      setSettling(false);
      setConfirmSettleSeason(false);
      setSettleRound(null);
    }
  };

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    try {
      await adminApi.deleteCaptainsMatch({ tournamentId });
      navigate(`/admin/t/${tournamentId}`, { replace: true });
    } catch (err) {
      console.error("Delete captains' match failed:", err);
      setError(getErrorMessage(err, "Failed to delete the captains' match"));
      setConfirmDelete(false);
      setDeleting(false);
    }
  };

  const breadcrumbs = [
    { label: "Admin", to: "/admin" },
    { label: tournament?.name ?? "Tournament", to: `/admin/t/${tournamentId}` },
    { label: "Captains' match" },
  ];

  if (ctxLoading || playersLoading || !matchLoaded) {
    return (
      <AdminPage title="Captains' match" breadcrumbs={breadcrumbs} loading>
        {null}
      </AdminPage>
    );
  }

  if (!tournament) {
    return (
      <AdminNotFound
        title="Captains' match"
        message="Tournament not found"
        backTo="/admin"
        backLabel="Back to Admin"
        breadcrumbs={breadcrumbs}
      />
    );
  }

  const firstName = (pid: string) => (nameById[pid] ?? pid).trim().split(/\s+/)[0];
  const missing = summary ? missingRoundNumbers(summary) : [];
  const highestRound = summary?.rounds.reduce((max, r) => Math.max(max, r.roundNumber), 0) ?? 0;

  const roundTitle = (m: CaptainsMatchDoc, r: CaptainsRoundSummary) => {
    if (r.thru === 0) return "No scores yet";
    if (r.holesWonA === r.holesWonB) return `Halved ${r.holesWonA}–${r.holesWonB}`;
    const aWon = r.holesWonA > r.holesWonB;
    const winnerName = firstName(aWon ? m.playerAId : m.playerBId);
    return `${winnerName} won ${Math.max(r.holesWonA, r.holesWonB)}–${Math.min(r.holesWonA, r.holesWonB)}`;
  };

  const settingsSection = (
      <AdminSection
        title={match ? "Settings" : "New captains' match"}
        description="Who's playing, how many rounds, and what it decides."
      >
        <CaptainsMatchForm
          key={match ? `edit-${highestRound > 0}` : "new"}
          initial={match ?? undefined}
          defaultPlayerAId={tournament.teamA?.captainId}
          defaultPlayerBId={tournament.teamB?.captainId}
          players={allPlayers}
          playersLocked={highestRound > 0}
          minRounds={highestRound}
          submitting={submitting}
          submitLabel={match ? "Save settings" : "Create captains' match"}
          onSubmit={handleSubmit}
        />
      </AdminSection>
  );

  return (
    <AdminPage
      headerTitle={`${tournament.year} ${tournament.name}`}
      breadcrumbs={breadcrumbs}
      eyebrow="Captains' match"
      title={match?.name ?? "Set up the captains' match"}
      description="The pre-draft running singles match between the captains: the margin carries from round to round. Rounds are played off the app — enter each card here. It awards no Cup points and records no player stats."
      badges={summary ? <Badge variant="outline">{summary.roundsPlayed}/{summary.totalRounds} rounds</Badge> : null}
      error={error}
      success={success}
      actions={
        match ? (
          <Button asChild variant="outline" size="sm">
            <Link to={tournament.active ? "/" : `/tournament/${tournamentId}`}>
              <ExternalLink className="h-4 w-4" />
              View
            </Link>
          </Button>
        ) : null
      }
    >
      {!match && settingsSection}

      {match && summary && (
        <>
          <AdminSection
            title="Rounds"
            description="Open a round to enter or correct its card. Rounds count in order, so enter them in the order they were played."
          >
            <InfoNote className="mb-3">
              Match:{" "}
              <span className="font-semibold text-foreground">
                {formatCaptainsMatchStatus(summary.state, firstName(match.playerAId), firstName(match.playerBId))}
              </span>
            </InfoNote>
            <div className="space-y-2">
              {Array.from({ length: summary.totalRounds }, (_, i) => i + 1).map((n) => {
                const r = summary.rounds.find((round) => round.roundNumber === n);
                return (
                  <NavRow
                    key={n}
                    to={`/admin/t/${tournamentId}/captains-match/round/${n}`}
                    leading={<IndexTile label="Rd" value={n} />}
                    title={r ? roundTitle(match, r) : <span className="text-muted-foreground">Add scorecard</span>}
                    subtitle={
                      r
                        ? [formatPlayedOn(r.round.playedOn), r.round.courseName].filter(Boolean).join(" · ") ||
                          "No date or course"
                        : undefined
                    }
                    badges={
                      r && r.thru > 0 && !r.complete ? (
                        <Badge variant="warning">thru {r.thru}</Badge>
                      ) : r?.postMatch ? (
                        <Badge variant="muted">after final</Badge>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          </AdminSection>

          <AdminSection
            title="Betting"
            description="Opens the captains'-match markets in the Sportsbook and settles them. Bets never settle on their own — enter a card, check it, then settle, so a typo can't pay out."
          >
            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 px-3">
                <ToggleRow
                  label="Betting open"
                  description="Season markets (outright winner, decided-by-round, rounds won) are bettable only while this is on. Each round's own market closes by itself once that card is entered."
                  checked={!!match.bettingOpen}
                  onChange={(next) => void toggleBetting(next)}
                  disabled={bettingBusy}
                />
              </div>

              {!tournament.sportsbookEnabled && (
                <InfoNote>
                  The Sportsbook is switched off for this tournament, so nobody can see these markets yet. Turn it on
                  under Settings → Setup.
                </InfoNote>
              )}

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Settle a round
                </div>
                {summary.rounds.filter((r) => r.thru > 0).length === 0 ? (
                  <InfoNote>No cards entered yet — there's nothing to settle.</InfoNote>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {summary.rounds
                      .filter((r) => r.thru > 0)
                      .map((r) => (
                        <Button
                          key={r.roundNumber}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={settling}
                          onClick={() => setSettleRound(r.roundNumber)}
                        >
                          Settle round {r.roundNumber}
                        </Button>
                      ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Settle the season
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={settling}
                  onClick={() => setConfirmSettleSeason(true)}
                >
                  {settling ? "Settling…" : "Settle season bets"}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Resolves the outright winner plus the decided-by-round and rounds-won over/unders.
                </p>
              </div>
            </div>
          </AdminSection>

          {settingsSection}

          <DangerZone
            title="Delete captains' match"
            description="Removes the match and every round's card. Nothing else is affected — it never touches Cup points or stats."
            actionLabel="Delete captains' match"
            onAction={() => setConfirmDelete(true)}
            disabled={deleting}
          />

          <ConfirmDialog
            isOpen={settleRound !== null}
            title={`Settle round ${settleRound} bets?`}
            confirmLabel="Settle"
            busy={settling}
            onConfirm={() => void settleBets("round", settleRound ?? undefined)}
            onCancel={() => setSettleRound(null)}
          >
            Pays out every locked-in bet on round {settleRound} from that card's result. Check the scorecard first —
            settling can't be undone.
          </ConfirmDialog>

          <ConfirmDialog
            isOpen={confirmSettleSeason}
            title="Settle season bets?"
            confirmLabel="Settle"
            busy={settling}
            onConfirm={() => void settleBets("season")}
            onCancel={() => setConfirmSettleSeason(false)}
          >
            {summary.state.kind !== "won" && summary.state.kind !== "halved" ? (
              <>
                <strong>The match isn't decided yet.</strong> Outright-winner bets will be skipped, and the
                decided-by-round and rounds-won lines will settle against the season <em>so far</em> — which is
                almost certainly not what you want. Wait until the season is over.
              </>
            ) : missing.length > 0 ? (
              <>
                <strong>
                  Round{missing.length === 1 ? "" : "s"} {formatRoundRanges(missing)} still {missing.length === 1 ? "has" : "have"} no card.
                </strong>{" "}
                The rounds-won line counts only the rounds entered, so settle once you're sure nothing else is coming.
              </>
            ) : (
              <>Pays out the outright winner plus both season over/unders. This can't be undone.</>
            )}
          </ConfirmDialog>

          <ConfirmDialog
            isOpen={confirmDelete}
            title="Delete captains' match?"
            confirmLabel="Delete"
            danger
            busy={deleting}
            onConfirm={handleDelete}
            onCancel={() => setConfirmDelete(false)}
          >
            This permanently deletes <strong>{match.name}</strong> and its{" "}
            <strong>
              {summary.rounds.length} round card{summary.rounds.length === 1 ? "" : "s"}
            </strong>
            .
          </ConfirmDialog>
        </>
      )}
    </AdminPage>
  );
}
