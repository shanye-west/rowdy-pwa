import { memo } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Lock, Trophy } from "lucide-react";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import { useAuth } from "../contexts/AuthContext";
import { useSideEvent } from "../hooks/useSideEvent";
import {
  formatMoney,
  formatPlace,
  formatToPar,
  nineLabel,
} from "../utils/sideEventScoring";
import {
  getPlayerShortName as getPlayerShortNameFromLookup,
  getPlayerFirstNameLastInitial as getPlayerPublicNameFromLookup,
} from "../utils/playerHelpers";
import Layout from "../components/Layout";
import LastUpdated from "../components/LastUpdated";
import SectionLabel from "../components/SectionLabel";
import { RoundPageSkeleton } from "../components/Skeleton";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { cn } from "../lib/utils";

/** Podium tints, best-first. Emerald/amber/blue literals are the app's canon. */
const PODIUM_STYLES = [
  "border-amber-300 bg-amber-50",
  "border-slate-300 bg-slate-50",
  "border-orange-300 bg-orange-50",
];

/**
 * A side event's leaderboard — the "round page" for the optional, for-fun
 * 9-hole game (the 3-man scramble).
 *
 * Where the Round page shows the Cup points each team earned, this shows the
 * top three teams and what they win, because a side event awards no tournament
 * points at all. Teams here are free-form: a player from either Cup roster can
 * be on any team, so nothing on this page is coloured or grouped by team A/B.
 */
function SideEventComponent() {
  const { sideEventId } = useParams();
  const { user, player } = useAuth();
  const {
    loading,
    error,
    event,
    tournament,
    course,
    players,
    leaderboard,
    payoutsByTeam,
  } = useSideEvent(sideEventId);

  // Logged-out viewers see "First L." wherever a full last name would show,
  // matching the Round page's treatment.
  const getName = (pid: string) =>
    user ? getPlayerShortNameFromLookup(pid, players) : getPlayerPublicNameFromLookup(pid, players);

  if (loading) return (
    <Layout title="Loading..." showBack>
      <RoundPageSkeleton />
    </Layout>
  );

  if (error || !event) {
    return (
      <Layout title="Side Event" showBack>
        <div className="px-4 py-10">
          <Card className="mx-auto max-w-md border-border/80 bg-card/90 text-center">
            <CardContent className="py-8">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="text-lg font-semibold text-foreground">
                {error ?? "Event not found"}
              </div>
              <Button asChild className="mt-4">
                <ViewTransitionLink to="/">Go Home</ViewTransitionLink>
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const tName = tournament?.name || "Rowdy Cup";
  const podium = leaderboard.filter((t) => t.thru > 0).slice(0, 3);
  const myPlayerId = player?.id;

  const teamNames = (playerIds: string[]) => playerIds.map(getName).join(" · ");

  return (
    <Layout
      title={tName}
      series={tournament?.series}
      showBack
      tournamentLogo={tournament?.tournamentLogo}
    >
      <div className="space-y-6 px-4 py-6">
        {/* Header. The Round page puts the two teams' Cup points here; a side
            event has none, so the podium takes that slot instead. */}
        <section>
          <Card className="relative overflow-hidden border-white/50 bg-card/85 shadow-xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.05),_transparent_65%)]" />
            <CardContent className="relative space-y-5 py-6">
              <div className="space-y-1 text-center">
                <div className="text-2xl font-semibold text-foreground">{event.name}</div>
                <div className="text-sm text-muted-foreground">
                  {nineLabel(event.nine)}
                  {course?.name ? ` · ${course.name}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  Just for fun — no Cup points
                </div>
                {event.locked && (
                  <div className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    <Lock className="h-3 w-3" /> Final
                  </div>
                )}
              </div>

              {podium.length === 0 ? (
                <div className="rounded-xl border border-border/70 bg-card/80 p-6 text-center text-sm text-muted-foreground">
                  No scores yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {podium.map((t, idx) => {
                    const payout = payoutsByTeam[t.teamId];
                    return (
                      <ViewTransitionLink
                        key={t.teamId}
                        to={`/side-event/${event.id}/team/${t.teamId}`}
                        className="card-link-hover block"
                      >
                        <div
                          className={cn(
                            "flex items-center gap-3 rounded-xl border p-3",
                            PODIUM_STYLES[idx] ?? "border-border/70 bg-card/80"
                          )}
                        >
                          <div className="flex w-10 shrink-0 flex-col items-center">
                            {idx === 0 && <Trophy className="mb-0.5 h-4 w-4 text-amber-600" />}
                            <span className="text-sm font-bold text-foreground">
                              {formatPlace(t.rank, t.tied)}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-foreground">
                              {teamNames(t.playerIds)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t.thru < 9 ? `thru ${t.thru}` : "F"}
                              {payout ? ` · ${formatMoney(payout.amount)}${payout.shared ? " (split)" : ""}` : ""}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-xl font-semibold tracking-tight text-foreground">
                              {t.total}
                            </div>
                            {t.toPar !== null && (
                              <div className="text-[0.65rem] font-semibold text-muted-foreground">
                                {formatToPar(t.toPar)}
                              </div>
                            )}
                          </div>
                        </div>
                      </ViewTransitionLink>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <SectionLabel
            trailing={
              (event.payouts?.length ?? 0) > 0 ? (
                <span className="text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  {event.payouts!.length} paid
                </span>
              ) : undefined
            }
          >
            Leaderboard
          </SectionLabel>

          {leaderboard.length === 0 ? (
            <Card className="border-border/80 bg-card/85">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No teams yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" role="list" aria-label="Teams">
              {leaderboard.map((t) => {
                const payout = payoutsByTeam[t.teamId];
                const isMine = !!myPlayerId && t.playerIds.includes(myPlayerId);
                return (
                  <div key={t.teamId} role="listitem">
                    <ViewTransitionLink
                      to={`/side-event/${event.id}/team/${t.teamId}`}
                      className="card-link-hover block"
                      aria-label={`Team ${t.teamNumber}: ${teamNames(t.playerIds)}`}
                    >
                      <Card className={cn("border-border/70", isMine && "ring-2 ring-primary/40")}>
                        <CardContent className="flex items-center gap-3 py-3">
                          <div className="w-10 shrink-0 text-center text-sm font-bold text-muted-foreground">
                            {t.thru > 0 ? formatPlace(t.rank, t.tied) : "—"}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-foreground">
                              {teamNames(t.playerIds) || `Team ${t.teamNumber}`}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t.thru === 0 ? "Not started" : t.thru < 9 ? `thru ${t.thru}` : "F"}
                              {payout ? ` · ${formatMoney(payout.amount)}${payout.shared ? " (split)" : ""}` : ""}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-lg font-semibold text-foreground">
                              {t.thru > 0 ? t.total : "—"}
                            </div>
                            {t.toPar !== null && (
                              <div className="text-[0.65rem] font-semibold text-muted-foreground">
                                {formatToPar(t.toPar)}
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </ViewTransitionLink>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {(event.payouts?.length ?? 0) > 0 && (
          <section className="space-y-3">
            <SectionLabel>Payouts</SectionLabel>
            <Card className="border-border/80 bg-card/85">
              <CardContent className="space-y-1 py-4">
                {event.payouts!.map((p) => (
                  <div key={p.place} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{formatPlace(p.place, false)}</span>
                    <span className="font-semibold text-foreground">{formatMoney(p.amount)}</span>
                  </div>
                ))}
                <div className="pt-2 text-xs text-muted-foreground">
                  Tied teams split the money for the places they cover.
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        <div>
          <LastUpdated />
        </div>
      </div>
    </Layout>
  );
}

export default memo(SideEventComponent);
