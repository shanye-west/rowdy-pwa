import { useState } from "react";
import { Link } from "react-router-dom";
import { CircleAlert, CircleDollarSign, ExternalLink, Flag, Plus, Settings2, SlidersHorizontal, Swords, Users } from "lucide-react";
import AdminPage, { AdminNotFound } from "../../components/admin/AdminPage";
import AdminSection from "../../components/admin/AdminSection";
import NavRow, { EmptyRow } from "../../components/admin/NavRow";
import RoundRow from "../../components/admin/RoundRow";
import StatTiles from "../../components/admin/StatTiles";
import TournamentBadges from "../../components/admin/TournamentBadges";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { useAdminTournament } from "../../contexts/AdminTournamentContext";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
import { tierPlayerIds } from "../../utils/roster";
import type { RoundDoc, TournamentDoc } from "../../types";

/**
 * Tournament admin home, top to bottom in the order it gets used: the numbers
 * at a glance, any setup still outstanding, the Cup rounds (with day-of lock
 * toggles), the settings areas, then the games that sit off the scoreboard.
 * Match work happens inside each round.
 */
export default function TournamentHome() {
  const { tournamentId, tournament, rounds, loading, error: ctxError, refreshRounds } = useAdminTournament();
  // Denormalized on the tournament doc by the sideEventOps callables, so this
  // needs no extra query (the tournament subscription already has it).
  const sideEvents = tournament?.sideEvents ?? [];
  const [busyRoundId, setBusyRoundId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const toggleRoundLock = async (roundId: string, locked: boolean) => {
    setError(null);
    setSuccess(null);
    setBusyRoundId(roundId);
    try {
      await adminApi.updateRound({ roundId, updates: { locked } });
      await refreshRounds();
      setSuccess(locked ? "Round locked — score entry is frozen." : "Round unlocked — players can enter scores.");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update round lock"));
    } finally {
      setBusyRoundId(null);
    }
  };

  const breadcrumbs = [{ label: "Admin", to: "/admin" }, { label: tournament?.name ?? "Tournament" }];

  if (loading) {
    return (
      <AdminPage title="Tournament" breadcrumbs={breadcrumbs} loading>
        {null}
      </AdminPage>
    );
  }

  if (!tournament) {
    return (
      <AdminNotFound
        title="Tournament"
        message={ctxError ?? "Tournament not found"}
        backTo="/admin"
        backLabel="Back to Admin"
        breadcrumbs={breadcrumbs}
      />
    );
  }

  const todo = setupTodos(tournament, rounds, tournamentId);
  const base = `/admin/t/${tournamentId}`;
  const teamAName = tournament.teamA?.name || "Team A";
  const teamBName = tournament.teamB?.name || "Team B";
  const teamACount = tierPlayerIds(tournament.teamA?.rosterByTier).length;
  const teamBCount = tierPlayerIds(tournament.teamB?.rosterByTier).length;
  const matchCount = rounds.reduce((sum, r) => sum + (r.matchIds?.length ?? 0), 0);
  const lockedCount = rounds.filter((r) => r.locked).length;
  // Offered on a tournament that already has one, or one still being set up
  // (no rounds yet) — not on every past Cup.
  const showCaptainsMatch = !!tournament.hasCaptainsMatch || rounds.length === 0;
  // Before any Cup round exists the captains' match IS the tournament, so the
  // extras lead instead of trailing.
  const extrasFirst = !!tournament.hasCaptainsMatch && rounds.length === 0;

  const roundsSection = (
    <AdminSection
      key="rounds"
      title="Rounds"
      description="The switch locks score entry for the whole round. Open a round for its matches, pairings draft, and recap."
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to={`${base}/round/new`}>
            <Plus className="h-4 w-4" />
            Round
          </Link>
        </Button>
      }
    >
      <div className="space-y-2">
        {rounds.map((r) => (
          <RoundRow
            key={r.id}
            tournamentId={tournamentId}
            round={r}
            trailing={
              <Switch
                checked={!!r.locked}
                disabled={busyRoundId === r.id}
                onCheckedChange={(next) => toggleRoundLock(r.id, next)}
                aria-label={r.locked ? `Unlock day ${r.day}` : `Lock day ${r.day}`}
              />
            }
          />
        ))}
        {rounds.length === 0 && <EmptyRow>No rounds yet.</EmptyRow>}
      </div>
    </AdminSection>
  );

  const extrasSection = (
    <AdminSection
      key="extras"
      title="Extras"
      description="Games played alongside the Cup. They award no Cup points and record no stats."
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to={`${base}/side-event/new`}>
            <Plus className="h-4 w-4" />
            Side event
          </Link>
        </Button>
      }
    >
      <div className="space-y-2">
        {showCaptainsMatch && (
          <NavRow
            to={`${base}/captains-match`}
            leading={<Swords className="h-5 w-5 text-muted-foreground" />}
            title="Captains' match"
            subtitle={
              tournament.hasCaptainsMatch
                ? "Players, round cards, and betting"
                : "Pre-draft running match between the captains"
            }
            badges={tournament.hasCaptainsMatch ? null : <Badge variant="muted">not set up</Badge>}
          />
        )}
        {sideEvents.map((e) => (
          <NavRow
            key={e.id}
            to={`${base}/side-event/${e.id}`}
            leading={<Flag className="h-5 w-5 text-muted-foreground" />}
            title={e.name}
            subtitle="Side event · teams, scores, and payouts"
            badges={e.hidden ? <Badge variant="muted">hidden</Badge> : null}
          />
        ))}
        {!showCaptainsMatch && sideEvents.length === 0 && <EmptyRow>No side events yet.</EmptyRow>}
      </div>
    </AdminSection>
  );

  return (
    <AdminPage
      headerTitle={`${tournament.year} ${tournament.name}`}
      breadcrumbs={breadcrumbs}
      eyebrow={tournament.series}
      title={`${tournament.year} ${tournament.name}`}
      badges={<TournamentBadges tournament={tournament} />}
      error={error ?? ctxError}
      success={success}
      actions={
        <>
          <Button asChild variant="ghost" size="sm">
            <Link to={`/tournament/${tournamentId}`}>
              <ExternalLink className="h-4 w-4" />
              View
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`${base}/settings`}>
              <Settings2 className="h-4 w-4" />
              Settings
            </Link>
          </Button>
        </>
      }
    >
      <StatTiles
        tiles={[
          {
            label: "Rosters",
            value: `${teamACount} v ${teamBCount}`,
            detail: `${teamAName} v ${teamBName}`,
            tone: teamACount === 0 || teamBCount === 0 ? "warning" : "default",
          },
          {
            label: "Rounds",
            value: rounds.length,
            detail: rounds.length === 0 ? "none yet" : `${lockedCount} locked`,
          },
          { label: "Matches", value: matchCount, detail: "across all rounds" },
        ]}
      />

      {todo.length > 0 && (
        <AdminSection
          title="Next steps"
          description="What still needs doing before this tournament can be played."
          actions={<Badge variant="warning">{todo.length} to do</Badge>}
        >
          <ul className="-mx-2 space-y-0.5">
            {todo.map((item) => (
              <li key={item.label}>
                <Link to={item.to} className="flex items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>
                    <span className="font-semibold text-foreground">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </AdminSection>
      )}

      {extrasFirst ? [extrasSection, roundsSection] : roundsSection}

      <AdminSection title="Manage" description="Everything set at the tournament level.">
        <div className="space-y-2">
          <NavRow
            to={`${base}/settings?tab=rosters`}
            leading={<Users className="h-5 w-5 text-muted-foreground" />}
            title="Rosters & handicaps"
            subtitle="Teams, tiers, captains, and handicap indexes"
          />
          <NavRow
            to={`${base}/settings`}
            leading={<SlidersHorizontal className="h-5 w-5 text-muted-foreground" />}
            title="Setup & features"
            subtitle="Name, active flag, sportsbook, comments, tiebreaker"
          />
          <NavRow
            to={`${base}/settings?tab=betting`}
            leading={<CircleDollarSign className="h-5 w-5 text-muted-foreground" />}
            title="Betting"
            subtitle="Settle Cup-winner and player futures"
            badges={tournament.sportsbookEnabled ? null : <Badge variant="muted">off</Badge>}
          />
        </div>
      </AdminSection>

      {!extrasFirst && extrasSection}
    </AdminPage>
  );
}

interface TodoItem {
  label: string;
  detail: string;
  to: string;
}

/**
 * The setup steps still outstanding, in the order they have to happen. Computed
 * from data the page already has — no extra reads — and hidden entirely once a
 * tournament is ready to play.
 */
function setupTodos(tournament: TournamentDoc, rounds: RoundDoc[], tournamentId: string): TodoItem[] {
  const items: TodoItem[] = [];
  const settings = `/admin/t/${tournamentId}/settings`;

  const teamACount = tierPlayerIds(tournament.teamA?.rosterByTier).length;
  const teamBCount = tierPlayerIds(tournament.teamB?.rosterByTier).length;
  if (teamACount === 0 || teamBCount === 0) {
    items.push({
      label: "Set the rosters",
      detail: `${tournament.teamA?.name || "Team A"}: ${teamACount} · ${tournament.teamB?.name || "Team B"}: ${teamBCount}`,
      to: `${settings}?tab=rosters`,
    });
  } else if (!tournament.teamA?.captainId || !tournament.teamB?.captainId) {
    items.push({
      label: "Pick captains",
      detail: "Captains run the pairings draft and get a planning board.",
      to: `${settings}?tab=rosters`,
    });
  }

  if (rounds.length === 0) {
    items.push({ label: "Create the rounds", detail: "One round per day of play.", to: `/admin/t/${tournamentId}/round/new` });
  } else {
    const noFormat = rounds.filter((r) => !r.format);
    if (noFormat.length > 0) {
      items.push({
        label: `Set the format on ${noFormat.length} round${noFormat.length === 1 ? "" : "s"}`,
        detail: `Day ${noFormat.map((r) => r.day ?? "?").join(", ")} still shows "Format TBD".`,
        to: `/admin/t/${tournamentId}/round/${noFormat[0].id}`,
      });
    }
    const noCourse = rounds.filter((r) => !r.courseId);
    if (noCourse.length > 0) {
      items.push({
        label: `Assign a course to ${noCourse.length} round${noCourse.length === 1 ? "" : "s"}`,
        detail: "Strokes and skins need the course's pars and handicap indexes.",
        to: `/admin/t/${tournamentId}/round/${noCourse[0].id}`,
      });
    }
    const noMatches = rounds.filter((r) => (r.matchIds?.length ?? 0) === 0);
    if (noMatches.length > 0) {
      items.push({
        label: `Build matches for ${noMatches.length} round${noMatches.length === 1 ? "" : "s"}`,
        detail: "Run the captains' pairings draft, or add matches by hand.",
        to: `/admin/t/${tournamentId}/round/${noMatches[0].id}`,
      });
    }
  }

  if (!tournament.active && !tournament.archived) {
    items.push({
      label: "Make it active",
      detail: "Until then it stays off the app's home page.",
      to: settings,
    });
  }

  return items;
}
