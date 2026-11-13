import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import AdminPage, { AdminNotFound } from "../../components/admin/AdminPage";
import AdminSection from "../../components/admin/AdminSection";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import DangerZone from "../../components/admin/DangerZone";
import NavRow from "../../components/admin/NavRow";
import SegmentedTabs, { type SegmentedTab } from "../../components/admin/SegmentedTabs";
import TournamentBadges from "../../components/admin/TournamentBadges";
import TournamentSettingsForm, { type SettingsTab } from "../../components/admin/TournamentSettingsForm";
import { Field } from "../../components/admin/fields";
import { inputClass } from "../../components/admin/inputStyles";
import { Button } from "../../components/ui/button";
import { useAdminTournament } from "../../contexts/AdminTournamentContext";
import { adminApi } from "../../api/admin";
import { betsApi } from "../../api/bets";
import { getErrorMessage } from "../../api/errors";
import { cn } from "../../lib/utils";
import type { PlayerDoc } from "../../types";
import type { TournamentUpdates } from "../../api/adminContracts";

type Tab = SettingsTab | "betting" | "danger";

const TABS: SegmentedTab<Tab>[] = [
  { id: "setup", label: "Setup" },
  { id: "rosters", label: "Rosters" },
  { id: "betting", label: "Betting" },
  { id: "danger", label: "Danger", danger: true },
];

const isTab = (value: string | null): value is Tab => TABS.some((t) => t.id === value);

/** Tournament settings, rosters, betting settlement, and the archive control. */
export default function TournamentSettings() {
  const navigate = useNavigate();
  const { tournamentId, tournament, loading } = useAdminTournament();

  // The tab lives in the URL (?tab=rosters) so other admin pages can link
  // straight to one, and a refresh or Back lands where you were.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = isTab(tabParam) ? tabParam : "setup";
  const setTab = (next: Tab) => setSearchParams(next === "setup" ? {} : { tab: next }, { replace: true });
  const [allPlayers, setAllPlayers] = useState<PlayerDoc[]>([]);
  const [playersLoading, setPlayersLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Betting settlement — operations, not settings, so they live outside the form.
  const [cupWinner, setCupWinner] = useState<"" | "teamA" | "teamB" | "push">("");
  const [confirmCup, setConfirmCup] = useState(false);
  const [confirmPlayerFutures, setConfirmPlayerFutures] = useState(false);
  const [settling, setSettling] = useState(false);

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

  const handleSubmit = async (updates: TournamentUpdates) => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await adminApi.updateTournament({ tournamentId, updates });
      setSuccess("Tournament updated.");
    } catch (err) {
      console.error("Error updating tournament:", err);
      setError(getErrorMessage(err, "Failed to update tournament"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchiveToggle = async () => {
    if (!tournament) return;
    setError(null);
    setSuccess(null);
    setArchiving(true);
    try {
      await adminApi.updateTournament({
        tournamentId,
        updates: { archived: !tournament.archived },
      });
      setConfirmArchive(false);
      if (!tournament.archived) {
        navigate("/admin");
      } else {
        setSuccess("Tournament unarchived.");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to archive tournament"));
    } finally {
      setArchiving(false);
    }
  };

  const handleSettleCupFutures = async () => {
    if (cupWinner === "") return;
    setConfirmCup(false);
    setError(null);
    setSuccess(null);
    setSettling(true);
    try {
      const res = await betsApi.settleCupFutures({ tournamentId, winningTeam: cupWinner });
      setSuccess(`Settled ${res.settledCount} Cup-winner bet${res.settledCount === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't settle Cup futures"));
    } finally {
      setSettling(false);
    }
  };

  const handleSettlePlayerFutures = async () => {
    setConfirmPlayerFutures(false);
    setError(null);
    setSuccess(null);
    setSettling(true);
    try {
      const res = await betsApi.settlePlayerFutures({ tournamentId });
      setSuccess(`Settled ${res.settledCount} player-prop bet${res.settledCount === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't settle player futures"));
    } finally {
      setSettling(false);
    }
  };

  const breadcrumbs = [
    { label: "Admin", to: "/admin" },
    { label: tournament?.name ?? "Tournament", to: `/admin/t/${tournamentId}` },
    { label: "Settings" },
  ];

  if (loading || playersLoading) {
    return (
      <AdminPage title="Settings" breadcrumbs={breadcrumbs} loading>
        {null}
      </AdminPage>
    );
  }

  if (!tournament) {
    return (
      <AdminNotFound
        title="Settings"
        message="Tournament not found"
        backTo="/admin"
        backLabel="Back to Admin"
        breadcrumbs={breadcrumbs}
      />
    );
  }

  const teamAName = tournament.teamA?.name || "Team A";
  const teamBName = tournament.teamB?.name || "Team B";
  const cupOutcome =
    cupWinner === "push"
      ? "refund every Cup-winner bet (tie)"
      : `pay out every Cup-winner bet to ${cupWinner === "teamA" ? teamAName : teamBName} backers`;

  return (
    <AdminPage
      headerTitle={`${tournament.year} ${tournament.name}`}
      breadcrumbs={breadcrumbs}
      title="Settings"
      badges={<TournamentBadges tournament={tournament} />}
      error={error}
      success={success}
    >
      <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} ariaLabel="Settings sections" />

      {/* The form stays mounted across tab switches so in-progress edits survive. */}
      <div className={cn(tab !== "setup" && tab !== "rosters" && "hidden")}>
        <TournamentSettingsForm
          key={tournament.id}
          tournament={tournament}
          allPlayers={allPlayers}
          submitting={submitting}
          tab={tab === "rosters" ? "rosters" : "setup"}
          onSubmit={handleSubmit}
        />
      </div>

      {tab === "betting" && (
        <>
          {!tournament.sportsbookEnabled && (
            <AdminSection title="Sportsbook is off" description="Turn it on under Setup to use these controls.">
              <Button type="button" variant="outline" onClick={() => setTab("setup")}>
                Go to Setup
              </Button>
            </AdminSection>
          )}

          <AdminSection
            title="Settle Cup-winner futures"
            description="Resolves active bets on who wins the Cup. These never settle automatically — pick the winner once the Cup is decided. A tie refunds every bet."
          >
            <div className="space-y-3">
              <Field label="Cup winner">
                <select
                  value={cupWinner}
                  onChange={(e) => setCupWinner(e.target.value as "" | "teamA" | "teamB" | "push")}
                  className={inputClass}
                >
                  <option value="">Select the Cup winner…</option>
                  <option value="teamA">{teamAName} won the Cup</option>
                  <option value="teamB">{teamBName} won the Cup</option>
                  <option value="push">Tie — refund all Cup bets</option>
                </select>
              </Field>
              <Button
                type="button"
                onClick={() => setConfirmCup(true)}
                disabled={settling || cupWinner === ""}
              >
                {settling ? "Settling…" : "Settle Cup futures"}
              </Button>
            </div>
          </AdminSection>

          <AdminSection
            title="Settle player futures"
            description="Resolves active player matchups and tournament-points over/unders from each player's total points. Run once every match is closed. Match and round bets settle automatically; Cup-winner bets need the control above."
          >
            <Button type="button" onClick={() => setConfirmPlayerFutures(true)} disabled={settling}>
              {settling ? "Settling…" : "Settle player futures"}
            </Button>
          </AdminSection>

          {tournament.hasCaptainsMatch && (
            <NavRow
              to={`/admin/t/${tournamentId}/captains-match`}
              title="Captains' match betting"
              subtitle="Opened and settled from the captains' match page"
            />
          )}
        </>
      )}

      {tab === "danger" &&
        (tournament.archived ? (
          <AdminSection
            title="Unarchive tournament"
            description="Bring this tournament back into the default admin list."
          >
            <Button type="button" variant="outline" onClick={handleArchiveToggle} disabled={archiving}>
              {archiving ? "Working…" : "Unarchive"}
            </Button>
          </AdminSection>
        ) : (
          <DangerZone
            title="Archive tournament"
            description="Archiving hides this tournament from the default admin list. Nothing is deleted — history and stats stay intact, and you can unarchive any time."
            actionLabel={archiving ? "Working…" : "Archive tournament"}
            onAction={() => setConfirmArchive(true)}
            disabled={archiving}
          />
        ))}

      <ConfirmDialog
        isOpen={confirmArchive}
        title="Archive tournament?"
        confirmLabel="Archive"
        danger
        busy={archiving}
        onConfirm={handleArchiveToggle}
        onCancel={() => setConfirmArchive(false)}
      >
        “{tournament.year} {tournament.name}” will be hidden from the default admin list.
        Nothing is deleted and this can be undone any time.
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={confirmCup}
        title="Settle Cup futures?"
        confirmLabel="Settle"
        danger
        busy={settling}
        onConfirm={handleSettleCupFutures}
        onCancel={() => setConfirmCup(false)}
      >
        This will {cupOutcome}. It can't be undone.
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={confirmPlayerFutures}
        title="Settle player futures?"
        confirmLabel="Settle"
        danger
        busy={settling}
        onConfirm={handleSettlePlayerFutures}
        onCancel={() => setConfirmPlayerFutures(false)}
      >
        Settles every active player-prop bet (matchups + player point over/unders) from final
        tournament points. Make sure every match is closed first — this can't be undone.
      </ConfirmDialog>
    </AdminPage>
  );
}
