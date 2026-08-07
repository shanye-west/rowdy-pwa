import { memo, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import { AlertTriangle, Lock } from "lucide-react";
import { db } from "../firebase";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useSideEvent } from "../hooks/useSideEvent";
import { useDebouncedSave } from "../hooks/useDebouncedSave";
import { useVisibilityFlush } from "../hooks/useVisibilityFlush";
import { formatToPar, isValidSideEventGross, nineLabel } from "../utils/sideEventScoring";
import {
  getPlayerName as getPlayerNameFromLookup,
  getPlayerShortName,
} from "../utils/playerHelpers";
import Layout from "../components/Layout";
import PlayerAvatar from "../components/PlayerAvatar";
import { SaveStatusIndicator } from "../components/SaveStatusIndicator";
import SideEventScorecardTable from "../components/SideEventScorecardTable";
import { RoundPageSkeleton } from "../components/Skeleton";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";

/**
 * One team's scorecard for a side event — nine team gross scores, nothing else.
 *
 * A scramble records a single score for the team, so this is deliberately much
 * simpler than the match scorecard: no per-player rows, no handicap strokes, no
 * drive tracking, no match status. Scores are written straight to the team doc
 * (permitted by firestore.rules for the team's own players), which is what lets
 * Firestore's offline queue carry them off a course with no signal, exactly as
 * it does for match scores.
 */
function SideEventScorecardComponent() {
  const { sideEventId, teamId } = useParams();
  const { user, player } = useAuth();
  const { showToast } = useToast();
  const { loading, error, event, tournament, course, teams, players, holeNumbers, parByHole } =
    useSideEvent(sideEventId);

  const team = useMemo(() => teams.find((t) => t.id === teamId) ?? null, [teams, teamId]);
  const teamDocId = team?.id;

  const locked = event?.locked === true || team?.locked === true;
  // Score entry is limited to the team's own players — the same authorizedUids
  // check the security rule makes, mirrored here so the UI doesn't offer an
  // input that the server will reject.
  const canEdit =
    !locked && !!user && !!team?.authorizedUids?.includes(user.uid);

  // Immediate, throwing save primitive. Writes one leaf field path so two
  // people entering different holes never clobber each other.
  const saveHole = useCallback(
    async (holeKey: string, gross: number | null) => {
      if (!teamDocId || !canEdit) return;
      // Clearing writes `gross: null` rather than deleting the hole key. The
      // security rule forbids a client write from DROPPING an existing hole
      // (that guard is what stops one scorer wiping another's entries), and the
      // match scorecard clears the same way — everything downstream treats a
      // non-numeric gross as "not scored".
      await updateDoc(doc(db, "sideEventTeams", teamDocId), {
        [`holes.${holeKey}.gross`]: gross,
      });
    },
    [teamDocId, canEdit]
  );

  const { debouncedSave, flushAll, saveStatus, erroredKeys, retry } = useDebouncedSave<number | null>(
    saveHole,
    400
  );
  useVisibilityFlush(flushAll);

  const handleChange = useCallback(
    (holeKey: string, gross: number | null) => {
      if (!canEdit) return;
      if (gross !== null && !isValidSideEventGross(gross)) return;
      debouncedSave(holeKey, gross);
    },
    [canEdit, debouncedSave]
  );

  const handleRetry = useCallback(
    (holeKey: string) => {
      retry(holeKey);
      showToast({ variant: "info", message: `Retrying hole ${holeKey}…` });
    },
    [retry, showToast]
  );

  if (loading) return (
    <Layout title="Loading..." showBack>
      <RoundPageSkeleton />
    </Layout>
  );

  if (error || !event || !team) {
    return (
      <Layout title="Scorecard" showBack>
        <div className="px-4 py-10">
          <Card className="mx-auto max-w-md border-border/80 bg-card/90 text-center">
            <CardContent className="py-8">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="text-lg font-semibold text-foreground">
                {error ?? "Team not found"}
              </div>
              {event && (
                <Button asChild className="mt-4">
                  <ViewTransitionLink to={`/side-event/${event.id}`}>
                    Back to leaderboard
                  </ViewTransitionLink>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const scores = holeNumbers.map((h) => team.holes?.[String(h)]?.gross);
  const entered = scores.filter((s) => isValidSideEventGross(s)) as number[];
  const total = entered.reduce((sum, s) => sum + s, 0);
  const parPlayed = holeNumbers.reduce((sum, h, i) => {
    const par = parByHole[h];
    return isValidSideEventGross(scores[i]) && typeof par === "number" ? sum + par : sum;
  }, 0);
  const toPar = entered.length > 0 && parPlayed > 0 ? total - parPlayed : null;

  // Hole metadata for the card header, straight off the course doc.
  const holeByNumber = new Map(course?.holes?.map((h) => [h.number, h]) ?? []);
  const scorecardHoles = holeNumbers.map((num) => {
    const info = holeByNumber.get(num);
    return {
      k: String(num),
      num,
      par: info?.par ?? 0,
      hcpIndex: info?.hcpIndex,
      yards: info?.yards,
    };
  });

  const teamTotal = (t: typeof team) => {
    const vals = holeNumbers
      .map((h) => t.holes?.[String(h)]?.gross)
      .filter((g) => isValidSideEventGross(g)) as number[];
    return vals.length > 0 ? vals.reduce((sum, g) => sum + g, 0) : null;
  };
  const rowLabel = (t: typeof team) =>
    (t.playerIds ?? []).map((pid) => getPlayerShortName(pid, players)).join(", ") ||
    `Team ${t.teamNumber}`;

  // This team first (editable), then every other team read-only for context —
  // the same multi-row shape the round's scramble card has for A vs B.
  const scorecardRows = [
    {
      teamId: team.id,
      label: `Team ${team.teamNumber}`,
      subLabel: rowLabel(team),
      color: "var(--brand-primary)",
      editable: canEdit,
      getValue: (holeKey: string) => {
        const gross = team.holes?.[holeKey]?.gross;
        return isValidSideEventGross(gross) ? gross : ("" as const);
      },
      onChange: handleChange,
      erroredKeys,
      total: entered.length > 0 ? total : null,
    },
    ...teams
      .filter((t) => t.id !== team.id)
      .map((t) => ({
        teamId: t.id,
        label: `Team ${t.teamNumber}`,
        subLabel: rowLabel(t),
        // --muted-foreground holds raw HSL components, so it must be wrapped.
        color: "hsl(var(--muted-foreground))",
        editable: false,
        getValue: (holeKey: string) => {
          const gross = t.holes?.[holeKey]?.gross;
          return isValidSideEventGross(gross) ? gross : ("" as const);
        },
        total: teamTotal(t),
      })),
  ];

  return (
    <Layout
      title={event.name}
      series={tournament?.series}
      showBack
      tournamentLogo={tournament?.tournamentLogo}
    >
      <div className="space-y-5 px-4 py-6">
        <Card className="border-white/50 bg-card/85 shadow-lg">
          <CardContent className="space-y-4 py-5">
            <div className="flex flex-wrap items-center justify-center gap-3">
              {team.playerIds.map((pid) => (
                <div key={pid} className="flex items-center gap-1.5">
                  <PlayerAvatar
                    name={getPlayerNameFromLookup(pid, players)}
                    playerId={pid}
                    size={28}
                  />
                  <span className="text-sm font-semibold text-foreground">
                    {getPlayerNameFromLookup(pid, players)}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-6 rounded-xl border border-border/70 bg-card/80 p-3">
              <div className="text-center">
                <div className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Total
                </div>
                <div className="text-2xl font-semibold text-foreground">
                  {entered.length > 0 ? total : "—"}
                </div>
              </div>
              <div className="h-10 w-px bg-muted" />
              <div className="text-center">
                <div className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  To Par
                </div>
                <div className="text-2xl font-semibold text-foreground">
                  {toPar !== null ? formatToPar(toPar) : "—"}
                </div>
              </div>
              <div className="h-10 w-px bg-muted" />
              <div className="text-center">
                <div className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Thru
                </div>
                <div className="text-2xl font-semibold text-foreground">{entered.length}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
              <span>
                {nineLabel(event.nine)}
                {course?.name ? ` · ${course.name}` : ""}
              </span>
              <SaveStatusIndicator status={saveStatus} />
            </div>

            {locked ? (
              <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> Scoring is closed for this event.
              </div>
            ) : !canEdit ? (
              <div className="text-center text-xs text-muted-foreground">
                {player
                  ? "Only this team's players can enter its scores."
                  : "Sign in as one of this team's players to enter scores."}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* The real scorecard: horizontal, hole numbers / handicap / yards / par,
            then one row per team — same layout as the round's scramble card,
            narrowed to a single nine. This team's row is editable; the rest are
            read-only so a group can see where they stand hole by hole. */}
        <Card className="overflow-hidden border-border/70">
          <SideEventScorecardTable
            holes={scorecardHoles}
            totalLabel={event.nine === "back" ? "IN" : "OUT"}
            rows={scorecardRows}
            tSeries={tournament?.series}
            courseTees={course?.tees}
          />
        </Card>

        {erroredKeys.size > 0 && (
          <Card className="border-red-300 bg-red-50/60">
            <CardContent className="flex flex-wrap items-center gap-2 py-3 text-sm text-red-700">
              <span className="font-semibold">Some holes didn&apos;t save:</span>
              {[...erroredKeys].map((holeKey) => (
                <button
                  key={holeKey}
                  type="button"
                  onClick={() => handleRetry(holeKey)}
                  className="min-h-11 rounded-lg px-2 font-semibold underline"
                >
                  Retry {holeKey}
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        <Button asChild variant="outline" className="h-11 w-full rounded-xl">
          <ViewTransitionLink to={`/side-event/${event.id}`}>Back to leaderboard</ViewTransitionLink>
        </Button>
      </div>
    </Layout>
  );
}

export default memo(SideEventScorecardComponent);
