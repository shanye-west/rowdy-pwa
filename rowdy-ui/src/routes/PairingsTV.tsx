/**
 * PairingsTV — a full-screen, view-only "broadcast" board for the captains'
 * pairings draft, meant to be shared on a Zoom call while pairings are picked.
 *
 * This page is intentionally NOT linked anywhere in the app UI. It lives at a
 * memorable URL (`/pairings-tv`, or `/pairings-tv/2` to pin a round) you type
 * into the browser. It reads the live draft but never writes — no picking, no
 * setup, no admin controls.
 *
 * It auto-detects the round currently being drafted for the active tournament
 * (preferring an in-progress draft, then one awaiting confirmation, then the
 * most recently finalized), so there's no round id to remember. Reads of the
 * draft doc are gated by the security rules to captains/admins, so whoever is
 * screen-sharing must be signed in as one (admins always are authorized).
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, query, where, type FirestoreError } from "firebase/firestore";
import { db } from "../firebase";
import { cn } from "../lib/utils";
import { useAuth } from "../contexts/AuthContext";
import { useTournamentContext } from "../contexts/TournamentContext";
import PlayerAvatar from "../components/PlayerAvatar";
import OfflineImage from "../components/OfflineImage";
import { tierStyle } from "../utils/tierColors";
import { calculateCourseHandicap } from "../utils/ghin";
import { remainingPlayerIds } from "../utils/pairingDraft";
import { formatRoundType } from "../utils";
import { isScrambleFormat, isShambleFormat } from "../types";
import type { CourseDoc, DraftTeamKey, PairingDraftDoc, RoundDoc } from "../types";

const TEAM_FALLBACK: Record<DraftTeamKey, string> = { teamA: "Team A", teamB: "Team B" };
const TEAM_DEFAULT_COLOR: Record<DraftTeamKey, string> = {
  teamA: "var(--team-a-default)",
  teamB: "var(--team-b-default)",
};

/** Priority for auto-picking which round's draft to show (lower = more relevant). */
const PHASE_PRIORITY: Record<PairingDraftDoc["phase"], number> = {
  drafting: 0,
  review: 1,
  finalized: 2,
};

// ---------------------------------------------------------------------------
// Live subscriptions
// ---------------------------------------------------------------------------

/** Live list of rounds for a tournament, sorted by day. */
function useRounds(tournamentId: string | undefined): RoundDoc[] {
  const [rounds, setRounds] = useState<RoundDoc[]>([]);
  useEffect(() => {
    if (!tournamentId) {
      setRounds([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, "rounds"), where("tournamentId", "==", tournamentId)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RoundDoc));
        list.sort((a, b) => (a.day ?? 0) - (b.day ?? 0));
        setRounds(list);
      },
      (err) => console.error("PairingsTV rounds subscription error:", err)
    );
    return () => unsub();
  }, [tournamentId]);
  return rounds;
}

/** Live map of roundId → pairing draft for the given round ids. `denied` flips
 *  true if the viewer isn't authorized to read drafts (not a captain/admin). */
function useRoundDrafts(roundIds: string[]): {
  drafts: Record<string, PairingDraftDoc>;
  denied: boolean;
} {
  const [drafts, setDrafts] = useState<Record<string, PairingDraftDoc>>({});
  const [denied, setDenied] = useState(false);
  const key = roundIds.join(",");

  useEffect(() => {
    if (!key) {
      setDrafts({});
      return;
    }
    const ids = key.split(",");
    const unsubs = ids.map((rid) =>
      onSnapshot(
        doc(db, "pairingDrafts", rid),
        (snap) => {
          setDrafts((prev) => {
            const next = { ...prev };
            if (snap.exists()) next[rid] = { ...snap.data() } as PairingDraftDoc;
            else delete next[rid];
            return next;
          });
        },
        (err: FirestoreError) => {
          if (err.code === "permission-denied") setDenied(true);
          else console.error("PairingsTV draft subscription error:", err);
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);

  return { drafts, denied };
}

// ---------------------------------------------------------------------------
// View-model + presentational pieces
// ---------------------------------------------------------------------------

interface Meta {
  nameOf: (pid: string) => string;
  chOf: (pid: string) => number | null;
  tierOf: (pid: string) => string | undefined;
  teamName: (t: DraftTeamKey) => string;
  teamColor: (t: DraftTeamKey) => string;
  grossOnly: boolean;
}

/**
 * A single player line: avatar, name (in the team color), tier chip + course
 * handicap. Never truncates — long names wrap. `alignRight` mirrors the layout
 * so team B hugs the right edge of a match card.
 */
function PlayerRow({
  pid,
  team,
  meta,
  size = 42,
  alignRight,
}: {
  pid: string;
  team: DraftTeamKey;
  meta: Meta;
  size?: number;
  alignRight?: boolean;
}) {
  const color = meta.teamColor(team);
  const tier = meta.tierOf(pid);
  const ch = meta.chOf(pid);
  return (
    <div className={cn("flex items-center gap-2.5 min-w-0", alignRight && "flex-row-reverse")}>
      <PlayerAvatar name={meta.nameOf(pid)} playerId={pid} color={color} size={size} />
      <div className={cn("min-w-0", alignRight && "text-right")}>
        <div className="text-[1.05rem] font-semibold leading-tight" style={{ color }}>
          {meta.nameOf(pid)}
        </div>
        <div className={cn("mt-1 flex items-center gap-1.5", alignRight && "justify-end")}>
          {tier && (
            <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold", tierStyle(tier).chip)}>{tier}</span>
          )}
          {ch != null && <span className="text-[11px] font-medium text-slate-400">CH {ch}</span>}
        </div>
      </div>
    </div>
  );
}

/** A small status chip for a match (Set / On the clock / who nominates). */
function MatchStatus({ match, meta, isCurrent }: { match: PairingDraftDoc["matches"][number]; meta: Meta; isCurrent: boolean }) {
  const bothSet = !!(match.teamAPlayers?.length && match.teamBPlayers?.length);
  if (bothSet) {
    return (
      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
        Set
      </span>
    );
  }
  if (isCurrent) {
    return (
      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
        On the clock
      </span>
    );
  }
  return (
    <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
      Nom. {meta.teamName(match.nominatedBy)}
    </span>
  );
}

/** One matchup: Team A side vs Team B side, with a status chip. */
function MatchCard({
  match,
  meta,
  isCurrent,
  currentColor,
}: {
  match: PairingDraftDoc["matches"][number];
  meta: Meta;
  isCurrent: boolean;
  currentColor: string;
}) {
  const bothSet = !!(match.teamAPlayers?.length && match.teamBPlayers?.length);
  const side = (ids: string[] | null, team: DraftTeamKey, alignRight?: boolean) => {
    if (ids && ids.length) {
      return (
        <div className={cn("flex flex-col gap-2.5", alignRight ? "items-end" : "items-start")}>
          {ids.map((pid) => (
            <PlayerRow key={pid} pid={pid} team={team} meta={meta} size={40} alignRight={alignRight} />
          ))}
        </div>
      );
    }
    return (
      <div className={cn("text-sm font-medium text-slate-300", alignRight ? "text-right" : "text-left")}>— to pick —</div>
    );
  };

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white p-4 transition-all",
        isCurrent
          ? "border-transparent shadow-md ring-2"
          : bothSet
            ? "border-slate-200 shadow-sm"
            : "border-dashed border-slate-200"
      )}
      style={isCurrent ? ({ "--tw-ring-color": currentColor } as CSSProperties) : undefined}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Match {match.matchNumber}</span>
        <MatchStatus match={match} meta={meta} isCurrent={isCurrent} />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {side(match.teamAPlayers, "teamA")}
        <span className="text-[11px] font-bold uppercase text-slate-300">vs</span>
        {side(match.teamBPlayers, "teamB", true)}
      </div>
    </div>
  );
}

/** A team's "still available" pool (players not yet placed in a matchup). */
function AvailablePool({ team, ids, meta }: { team: DraftTeamKey; ids: string[]; meta: Meta }) {
  const color = meta.teamColor(team);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div
        className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"
        style={{ background: `color-mix(in srgb, ${color} 8%, #ffffff)` }}
      >
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide" style={{ color }}>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          {meta.teamName(team)}
        </div>
        <span className="text-xs font-semibold text-slate-400">{ids.length} left</span>
      </div>
      {ids.length === 0 ? (
        <div className="px-4 py-3 text-sm text-slate-400">All players placed</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {ids.map((pid) => (
            <div key={pid} className="px-4 py-2.5">
              <PlayerRow pid={pid} team={team} meta={meta} size={38} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A row of round pills for jumping between rounds' boards (`/pairings-tv/{n}`),
 * with a status dot per round: amber = drafting, sky = awaiting confirm, green
 * = finalized, dim = no draft yet. Hidden when there's only one round.
 */
function RoundSwitcher({
  rounds,
  drafts,
  currentRoundId,
}: {
  rounds: RoundDoc[];
  drafts: Record<string, PairingDraftDoc>;
  currentRoundId: string | null;
}) {
  if (rounds.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {rounds.map((r, i) => {
        const d = drafts[r.id];
        const isActive = r.id === currentRoundId;
        const dot = !d
          ? "bg-slate-300"
          : d.phase === "drafting"
            ? "bg-amber-500"
            : d.phase === "review"
              ? "bg-sky-500"
              : "bg-emerald-500";
        return (
          <Link
            key={r.id}
            to={`/pairings-tv/${i + 1}`}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
              isActive
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", dot)} />
            Round {i + 1}
          </Link>
        );
      })}
    </div>
  );
}

/** Full-screen centered message (loading / waiting / access states). */
function FullScreenNote({
  title,
  children,
  footer,
}: {
  title: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white p-8 text-center">
      <div className="max-w-lg">
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        {children && <p className="mt-4 text-lg text-slate-500">{children}</p>}
      </div>
      {footer && <div className="mt-8">{footer}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// Pin the light palette regardless of the viewer's device theme, so team colors
// and avatar tints render consistently on the shared screen.
const LIGHT_VARS = { "--card-bg": "#ffffff" } as CSSProperties;

export default function PairingsTV() {
  // Optional 1-based round number in the URL (`/pairings-tv/2` = the 2nd round,
  // matching the "Round N" label). Absent → auto-detect the round to show.
  const { roundNum } = useParams<{ roundNum?: string }>();
  const explicitIdx = roundNum && /^\d+$/.test(roundNum) ? parseInt(roundNum, 10) - 1 : null;

  const { player, loading: authLoading } = useAuth();
  const { tournament, loading: tournamentLoading, players, ensurePlayers } = useTournamentContext();

  const rounds = useRounds(tournament?.id);
  const roundIds = useMemo(() => rounds.map((r) => r.id), [rounds]);
  const { drafts, denied } = useRoundDrafts(roundIds);

  // Pick which round to broadcast: an explicit URL round wins; otherwise
  // auto-detect — prefer an in-progress draft (drafting > review > finalized),
  // and on ties pick the LATEST round (so once a round wraps up the board leans
  // toward the next one you've opened).
  const round = useMemo<RoundDoc | null>(() => {
    if (explicitIdx != null) return rounds[explicitIdx] ?? null;
    let bestIdx = -1;
    rounds.forEach((r, idx) => {
      const d = drafts[r.id];
      if (!d) return;
      if (bestIdx === -1) {
        bestIdx = idx;
        return;
      }
      const bd = drafts[rounds[bestIdx].id];
      if (
        !bd ||
        PHASE_PRIORITY[d.phase] < PHASE_PRIORITY[bd.phase] ||
        (PHASE_PRIORITY[d.phase] === PHASE_PRIORITY[bd.phase] && idx > bestIdx)
      ) {
        bestIdx = idx;
      }
    });
    return bestIdx >= 0 ? rounds[bestIdx] : null;
  }, [explicitIdx, rounds, drafts]);

  const draft = round ? drafts[round.id] ?? null : null;

  // Load the active round's course (for course-handicap display).
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const courseId = round?.courseId;
  useEffect(() => {
    if (!courseId) {
      setCourse(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, "courses", courseId))
      .then((snap) => {
        if (!cancelled) setCourse(snap.exists() ? ({ id: snap.id, ...snap.data() } as CourseDoc) : null);
      })
      .catch((e) => console.error("PairingsTV course load error:", e));
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // Make sure every player referenced by the draft is in the shared cache.
  const draftPlayerIds = useMemo(() => {
    if (!draft) return "";
    return [...draft.available.teamA, ...draft.available.teamB].join(",");
  }, [draft]);
  useEffect(() => {
    if (draftPlayerIds) ensurePlayers(draftPlayerIds.split(","));
  }, [draftPlayerIds, ensurePlayers]);

  // ---- View-model ----
  const handicapByPlayer = useMemo(
    () => ({ ...(tournament?.teamA?.handicapByPlayer || {}), ...(tournament?.teamB?.handicapByPlayer || {}) }),
    [tournament]
  );
  const courseParams = useMemo(() => {
    if (!course) return null;
    return {
      slope: course.slope ?? 113,
      rating: typeof course.rating === "number" ? course.rating : course.par ?? 72,
      par: course.par ?? 72,
    };
  }, [course]);

  const meta: Meta = useMemo(() => {
    const nameOf = (pid: string) => players[pid]?.displayName || pid;
    return {
      nameOf,
      chOf: (pid) => {
        if (!courseParams) return null;
        const hi = handicapByPlayer[pid];
        if (typeof hi !== "number") return null;
        return Math.round(calculateCourseHandicap(hi, courseParams.slope, courseParams.rating, courseParams.par));
      },
      tierOf: (pid) => draft?.tierByPlayer?.[pid],
      teamName: (t) => tournament?.[t]?.name || TEAM_FALLBACK[t],
      teamColor: (t) => tournament?.[t]?.color || TEAM_DEFAULT_COLOR[t],
      grossOnly: isScrambleFormat(round?.format) || isShambleFormat(round?.format),
    };
  }, [players, courseParams, handicapByPlayer, draft, tournament, round]);

  // ===========================================================================
  // States
  // ===========================================================================
  if (authLoading || tournamentLoading) {
    return <FullScreenNote title="Loading…" />;
  }
  if (!tournament) {
    return <FullScreenNote title="No active tournament">There's no active tournament to draft pairings for.</FullScreenNote>;
  }
  if (denied || !player?.isAdmin) {
    // Reads of the draft are captain/admin-only; make the fix obvious.
    return (
      <FullScreenNote title="Sign in to broadcast">
        The pairings board is visible to team captains and admins. Sign in on this device as a captain or admin, then
        reload this page.
      </FullScreenNote>
    );
  }

  const switcher = <RoundSwitcher rounds={rounds} drafts={drafts} currentRoundId={round?.id ?? null} />;

  // An explicit round number that doesn't exist (e.g. /pairings-tv/9).
  if (explicitIdx != null && !round && rounds.length > 0) {
    return (
      <FullScreenNote title={`Round ${explicitIdx + 1} not found`} footer={switcher}>
        This tournament has {rounds.length} round{rounds.length === 1 ? "" : "s"}. Pick one below.
      </FullScreenNote>
    );
  }
  if (!draft || !round) {
    const label = round ? `Round ${rounds.findIndex((r) => r.id === round.id) + 1} pairings` : "The pairings draft";
    return (
      <FullScreenNote title="Waiting for the draft" footer={switcher}>
        {label} for {tournament.name} {round ? "haven't" : "hasn't"} opened yet. This board updates automatically the
        moment {round ? "they do" : "it does"}.
      </FullScreenNote>
    );
  }

  // ---- Broadcast board ----
  const roundIdx = rounds.findIndex((r) => r.id === round.id);
  const setCount = draft.matches.filter((m) => m.teamAPlayers?.length && m.teamBPlayers?.length).length;
  const remainingA = remainingPlayerIds(draft, "teamA");
  const remainingB = remainingPlayerIds(draft, "teamB");
  const pct = draft.totalMatches ? (setCount / draft.totalMatches) * 100 : 0;

  // Whose move it is, in plain language.
  let statusTeam: DraftTeamKey | null = null;
  let statusText = "";
  if (draft.phase === "finalized") {
    statusText = "Pairings locked in";
  } else if (draft.phase === "review") {
    statusText = "Draft complete — awaiting confirmation";
  } else if (draft.turn) {
    statusTeam = draft.turn.team;
    const verb = draft.turn.awaiting === "nomination" ? "to send out a match" : "to answer";
    statusText = `${meta.teamName(statusTeam)} ${verb}`;
  }
  const statusColor = statusTeam ? meta.teamColor(statusTeam) : "#0f172a";
  const currentIndex = draft.turn?.matchIndex ?? -1;

  return (
    <div className="min-h-screen bg-white text-slate-900" style={LIGHT_VARS}>
      {/* Desktop-only hint on narrow screens */}
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-700 lg:hidden">
        This pairings board is designed for a desktop screen share.
      </div>

      <div className="mx-auto max-w-[1600px] px-8 py-7">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="flex items-center gap-4">
            {tournament.tournamentLogo && (
              <OfflineImage
                src={tournament.tournamentLogo}
                alt={tournament.name}
                fallbackIcon="🏌️"
                style={{ width: 52, height: 52, objectFit: "contain" }}
              />
            )}
            <div>
              <div className="text-2xl font-bold leading-tight text-slate-900">{tournament.name}</div>
              <div className="mt-0.5 text-sm font-medium text-slate-500">
                {`Round ${roundIdx >= 0 ? roundIdx + 1 : round.day ?? ""}`.trim()}
                {round.format ? ` • ${formatRoundType(round.format)}` : ""}
                {course?.name ? ` • ${course.name}` : ""}
              </div>
            </div>
          </div>

          <div
            className="flex items-center gap-2.5 rounded-full px-5 py-2.5 text-lg font-bold"
            style={{ background: `color-mix(in srgb, ${statusColor} 12%, #ffffff)`, color: statusColor }}
          >
            {draft.phase === "drafting" && (
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: "currentColor" }} />
            )}
            {statusText}
          </div>
        </header>

        {/* Round switcher + progress */}
        <div className="flex flex-wrap items-center justify-between gap-4 py-5">
          {switcher}
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-48 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-slate-800 transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="whitespace-nowrap text-sm font-bold text-slate-700">
              {setCount} <span className="font-medium text-slate-400">of</span> {draft.totalMatches} set
            </div>
          </div>
        </div>

        {/* Body: matchups + available pools */}
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_380px]">
          <div>
            <div className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Matchups</div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {draft.matches.map((m, i) => (
                <MatchCard key={m.matchNumber} match={m} meta={meta} isCurrent={i === currentIndex} currentColor={statusColor} />
              ))}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Still available</div>
            <AvailablePool team="teamA" ids={remainingA} meta={meta} />
            <AvailablePool team="teamB" ids={remainingB} meta={meta} />
          </aside>
        </div>
      </div>
    </div>
  );
}
