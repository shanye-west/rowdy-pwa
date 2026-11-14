# AGENTS.md — Rowdy Cup PWA

Canonical, tool-agnostic guide for AI coding agents (Claude Code, Cursor, Copilot, Codex, Aider, …) working in this repo. **This is the source of truth**; `CLAUDE.md` and `.github/copilot-instructions.md` are thin pointers to this file. Human contributors: start with [README.md](README.md).

---

## What this is

A mobile-first Progressive Web App for a **12v12, Ryder-Cup–style golf tournament**. Players enter gross scores on their phones; Firebase Cloud Functions compute net scores, hole winners, match status, results, and aggregated stats in real time. Everything is **public read-only**; score entry uses anonymous auth linked to a player.

- The engine also powers a second **series**, the "Christmas Classic" (`tournament.series` = `"rowdyCup" | "christmasClassic"`, which also drives theming).
- Served at **app.rowdycup.com**. `www.rowdycup.com` is a separate marketing site, not this app.
- Used in production (Dec 2025 event; more events each year).

## Golden rules (read before doing anything)

1. **Production is the only environment.** There is effectively one Firebase project — prod (`rowdy-pwa`). The `dev` alias in `.firebaserc` is unused; there is no staging. Every deploy and every emulator-free run touches **prod data**. **Firebase writes and deployments are allowed without a separate confirmation when needed to complete the user's requested work**, including Firestore writes, `firebase deploy`, and scripts in `scripts/`. Keep changes within the requested scope, build and validate before deploying, and confirm the target project is `rowdy-pwa`. Ask before destructive or irreversible actions that the user has not already authorized. Reads, builds, lints, and tests are safe.
2. **`tsc` is the feedback loop.** The frontend `build` runs `tsc -b` first, so type errors block the build. Run builds/typecheck after edits; treat that as primary validation.
3. **Keep scoring & rules green.** Scoring logic and `firestore.rules` are covered by extensive tests; never change them without `cd functions && npm run test:run` passing.
4. **Strict TypeScript, no `as any`.** Narrow with the type guards in `rowdy-ui/src/types.ts` instead of casting.

## Monorepo layout

- **`rowdy-ui/`** — React 19 + Vite 7 + TypeScript 5.9 + Tailwind 4 frontend (the PWA).
- **`functions/`** — Firebase Cloud Functions Gen-2 (TypeScript, Node 22). Firestore triggers + HTTPS callables for scoring, stats, betting, chat, notifications, drafts, and admin ops.
- **`scripts/`** — Break-glass admin Node/TS scripts (seeding, exports, auth linking). Bypass callable auth/rate-limits and write straight to Firestore with a service account. See `scripts/README.md`.
- **Root** — Firebase config: `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `.firebaserc`.

## Commands

```bash
# Frontend (rowdy-ui/)
cd rowdy-ui && npm run dev        # Vite dev server (PWA enabled in dev)
cd rowdy-ui && npm run build      # tsc -b && vite build  ← primary check
cd rowdy-ui && npm run lint       # eslint .
cd rowdy-ui && npm run test:run   # vitest single run

# Functions (functions/)
cd functions && npm run build     # tsc
cd functions && npm run test:run  # vitest single run (scoring/stats suites)
cd functions && npm run serve     # build + Firebase emulators (local only)

# Deploy (manual, no predeploy build hooks — BUILD FIRST; verify target is rowdy-pwa)
cd rowdy-ui && npm run build && firebase deploy --only hosting
cd functions && npm run build && firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

When a change needs new indexes, **deploy indexes before** the functions/hosting that query them.

## Architecture & data flow

1. A player writes a gross score to `matches/{id}.holes.{N}.input` — the **only** field clients may write (enforced by security rules).
2. `computeMatchOnWrite` (Firestore trigger) recomputes `status` + `result` on every match write. It caches round context on the match doc (`_lastComputed`) and guards re-runs with `_computeSig` to avoid redundant work.
3. When a match closes (`status.closed === true`), `updateMatchFacts` writes one immutable `playerMatchFacts/{matchId}_{playerId}` doc per rostered player (outcome, hole-by-hole `holePerformance`, momentum/clutch/ball-usage stats, context).
4. `aggregatePlayerStats` rolls those facts up into `playerStats/{playerId}/bySeries/{series}` (and `byTournament`/`byRound`).
5. `computeRoundTotals` denormalizes per-round point totals onto the round doc; `computeRoundSkins` computes skins; betting-settlement triggers settle wagers on match/round completion.
6. The frontend uses Firestore `onSnapshot` listeners (see `rowdy-ui/src/hooks/`) so all UI updates live.

Editing an earlier hole can **reopen** a closed match if the math changes; facts are deleted/rewritten accordingly. Triggers are marked `retry: true` and are idempotent so requeued/out-of-order deliveries (e.g. a burst of offline writes replaying) are safe.

## Firestore collections

Most collections are **public-read**, but the group's private data is **signed-in-read**: `bets`, `betSettlements`, and `comments` (+ `comments/*/replies`) require `request.auth != null` (the /sportsbook and /chat pages are also gated client-side by `RequireAuth`). Clients may write only two narrow things: a match's `holes` map and their own notification read-state (`read`/`readAt`) — **the top-level `players` doc is server-only-write** (no client self-link). Everything else is written by Cloud Functions via the Admin SDK, which bypasses rules.

| Collection | Purpose |
|---|---|
| `tournaments/{id}` | `active` (one at a time), `series`, `year`, `teamA`/`teamB` (`rosterByTier`, `handicapByPlayer`, captain ids, color, logo), `roundIds[]`, `draftPool`, feature flags (`openPublicEdits`, `hideDraftPool`, `commentsEnabled`, `sportsbookEnabled`, …) |
| `players/{id}` | `displayName`, `authUid` (account link; query key), `isAdmin`. Docs are keyed by **player id** (e.g. `pShane`), not auth uid. **PII lives in the server-only subcollection `players/{id}/private/profile`** (`email`, `scoutingNotes`) — `allow read,write: if false`, reachable only by the Admin SDK (the `getPlayerPrivate` admin callable); it is **not** on the world-readable doc. |
| `rounds/{id}` | `tournamentId`, `day`, `format`, `courseId`, `pointsValue`, `trackDrives`, `locked`, skins pots, denormalized `pointTotals`, `matchIds[]` |
| `matches/{id}` | `teamAPlayers`/`teamBPlayers` (`{playerId, strokesReceived[18]}`), `holes.{1..18}.input` (format-specific), computed `status`/`result`, `completed`, cache fields (`_computeSig`, `_lastComputed`) |
| `courses/{id}` | `name`, `tees`, `par`, `holes[18]` (`number`, `par`, `hcpIndex`, `yards`) |
| `playerMatchFacts/{matchId}_{playerId}` | Immutable per-player, per-match stats (see reference below) |
| `playerStats/{playerId}` | Subcollections `bySeries/{series}`, `byTournament/{id}`, `byRound/{id}` — aggregated records |
| `roundRecaps/{roundId}` | Scoring leaders, per-hole averages, vs-all records (see `SCORING-LEADERS-IMPLEMENTATION.md`) |
| `bets`, `betSettlements` | Peer-to-peer sportsbook wagers + settle-up ledger |
| `comments/{id}` (+ `replies/`) | Match-thread & sportsbook trash-talk, emoji reactions, one-level replies |
| `pairingDrafts/{id}` | Live captains' snake-draft state (phases: `staging` → `drafting` → `review` → `finalized`). `visibility` (`live`\|`private`, admin-set) decides whether the whole field can watch or only the captains/admins in `authorizedUids` |
| `pairingPlans/{roundId}__{playerId}` | One PERSON's private pre-draft mock board (both teams' pairs + matchups) — owner-only |
| `notifications`, `pushTokens` | In-app notification feed + FCM web-push tokens |
| `matchNotifyState`, `tournamentNotifyState` | Idempotency guards for push notifications |
| `rounds/{id}/skinsResults/computed` | Computed skins pots/winners (subcollection) |
| `sideEvents/{id}` | An optional, for-fun game (the 3-man scramble): `name`, `courseId`, `nine` (`front`/`back`), `payouts[]`, `locked`, `hidden`. **Awards no Cup points and records no stats** |
| `sideEventTeams/{id}` | One free-form team in a side event: `sideEventId`, `teamNumber`, `playerIds[]` (any mix of rosters), `authorizedUids[]`, `locked`, `holes.{N}.gross` |
| `captainsMatches/{tournamentId}` | The pre-draft captains' match (running singles match play between the two captains): `name`, `subtitle`, `stakes`, `playerAId`/`playerBId`, `totalRounds`, `bettingOpen`, and every round's card embedded as `rounds.{n}` (`playedOn`, `courseId`/`courseName`/`tees`, `grossA`/`grossB[18]`, `strokesA`/`strokesB[18]`). Admin-entered; **awards no Cup points and records no stats**. `tournament.hasCaptainsMatch` gates the listener — see "Captains' match" below |

## Match formats & scoring

`RoundFormat` union with format-specific hole inputs in `matches/{id}.holes.{N}.input`:

| Format | Hole input | Hole winner |
|---|---|---|
| `singles` | `teamAPlayerGross`, `teamBPlayerGross` | net vs net (`gross − strokesReceived`) |
| `twoManBestBall` | `teamAPlayersGross[2]`, `teamBPlayersGross[2]` | best **net** per side |
| `twoManShamble` | `teamAPlayersGross[2]`, `teamBPlayersGross[2]` + `teamADrive`/`teamBDrive` | best **gross** per side (no strokes) |
| `twoManScramble` | `teamAGross`, `teamBGross` + `teamADrive`/`teamBDrive` | team gross vs team gross |

- **`fourManScramble` is historical-only.** It exists in the scoring/UI paths solely to render past-tournament data. **Do not** offer it for new rounds or add it to current-format docs/selection UI.
- **Side events are not a `RoundFormat`.** The optional 9-hole games (the 3-man scramble) are stroke play between free-form teams, award no points and record no stats, so they live in their own `sideEvents`/`sideEventTeams` collections — see "Side events" below. Don't add one as a round format.
- **Handicaps**: `strokesReceived` is an 18-element array of 0/1 (course handicaps capped at 18 → never >1 stroke/hole). Applies to **singles** and **twoManBestBall** only.
- **Drive tracking**: shamble & scramble record which player's drive was used per hole (`trackDrives` on the round).
- **Match status/result**: win = full `pointsValue`, halve (AS) = half, loss = 0. Early closure when lead > holes remaining (`closed`); `dormie` when lead == holes remaining; tied through 18 → AS.
- Use the type guards in `rowdy-ui/src/types.ts` (`isSinglesFormat`, `isFourPlayerFormat`, `isDriveTrackingFormat`, …) rather than string comparisons. Hole shapes: `SinglesHoleInput`, `BestBallHoleInput`, `ShambleHoleInput`, `ScrambleHoleInput`; narrow the loose `HoleInputLoose` when the format is known. Normalize timestamps with `toDateOrNull()` and the `FirestoreTimestampLike` alias.

## Side events (the optional 9-hole games)

A **side event** is a for-fun game played alongside the Cup — currently a 9-hole 3-man scramble one afternoon. It is *not* part of the tournament:

- **No Cup points, no stats.** This is structural, not a flag: every scoring, stats, skins, betting and notification trigger fires on `matches/{matchId}` or `playerMatchFacts/{factId}`, and a side event never writes those collections. Nothing in `functions/src/scoring/`, `computeMatchOnWrite`, `updateMatchFacts` or `computeRoundTotals` knows side events exist — **keep it that way**.
- **Teams are free-form.** A player from either roster can be on any team, which the `teamAPlayers`/`teamBPlayers` match document cannot express.
- **Not on the tournament home page.** `App.tsx`/`Tournament.tsx` list `rounds` only. The hamburger menu is the sole entry point, driven by the denormalized `tournament.sideEvents[]` (`{ id, name, hidden }`) that the callables maintain, so the link costs no extra reads. `hidden` drops the link while keeping the data.
- **Stroke play, gross, admin-configurable payouts.** The page shows a top-3 podium + full standings instead of a points total. `payouts[]` is a variable-length list of `{ place, amount }`, editable at any time from the admin form; tied teams pool the places they cover and split evenly.
- Ranking is by strokes-vs-par over holes played (`thru` is displayed), which is the honest live order and collapses to raw total once everyone finishes.

Where it lives: `functions/src/callables/sideEventOps.ts`; `rowdy-ui/src/utils/sideEventScoring.ts` (pure, unit-tested ranking + payout split), `hooks/useSideEvent.ts`, `routes/SideEvent.tsx` (`/side-event/:id`), `routes/SideEventScorecard.tsx` (`/side-event/:id/team/:teamId`), `routes/admin/SideEventAdmin.tsx` + `components/admin/SideEventForm.tsx`. The leaderboard is computed entirely client-side — there is no side-event Cloud Function trigger.

## Captains' match (the pre-draft running match)

A **captains' match** is a season-long singles match between the two captains, played before the draft to settle who picks first (2027: 20 rounds; the winner chooses to draft 1st overall or defer). Rounds are played off the app; an admin enters each round's card afterwards.

- **Running match play.** The hole-by-hole margin carries from round to round (4 UP after round 1 means round 2 starts 4 UP). Each hole is decided like a Cup singles hole — net, one stroke max — by the shared `decideHole`. The match is decided the moment a lead exceeds the holes remaining (every hole of every round, counting blank holes and rounds not yet entered, so a gap can't close it early); anything entered after that shows as post-match. All square after the last round is "halved" — a tiebreak, if any, happens off-app.
- **No Cup points, no stats — structurally.** Like side events it lives in its own collection and never writes `rounds`/`matches`, so no trigger sees it. There is no trigger of its own either: the season is computed client-side from the one doc.
- **One doc, one read.** `captainsMatches/{tournamentId}` holds the settings and every card (`rounds.{n}`), so the status, the season flow graph and the round list cost a single listener. `tournament.hasCaptainsMatch` (maintained by the callables) decides whether Home / `Tournament.tsx` open it at all.
- **Home gating.** A tournament with a captains' match and no rounds yet shows only the captains' match; once Cup rounds exist the Cup sections render above it. Tournaments without one are unchanged.
- **Betting.** The Sportsbook can run four markets on it: outright winner (`captainsMatch`), a single round's winner (`captainsRound` + `captainsRoundNumber`), and two over/unders (`captainsClinchRound`, `captainsRoundsWon` + `subjectId`). There are no tee times or matches to gate them, so the book is governed by `captainsMatches/{tid}.bettingOpen` — an admin switch — and a round's own market closes once that card has any score. Nothing settles automatically: `settleCaptainsMatchBets` (admin) resolves a round or the season on demand, so a mistyped card can be fixed before money moves. The season math it settles from (`summarizeCaptainsSeason` in `helpers/captainsMatch.ts`) is a deliberate port of the client's `summarizeCaptainsMatch`; both suites assert the same real-card expectations to catch drift.
- **Cards are saved whole.** `saveCaptainsMatchRound` validates a card and replaces `rounds.{n}` wholesale (a `FieldPath` update), copying the course's name and tees when it was played on an app course. Strokes are stored per hole (`strokesA`/`strokesB`, 0/1). **Both players get strokes off their own full course handicap** — unlike Cup singles, which spin down from the lowest handicap (`helpers/strokeCalculation.ts`) — so the admin page takes each player's course handicap for the day and places each set on the course's hardest holes, or they're ticked by hand. Players lock once any card exists.

Where it lives: `functions/src/callables/captainsMatchOps.ts` + `functions/src/helpers/captainsMatch.ts` (pure validation, unit-tested); `rowdy-ui/src/utils/captainsMatchScoring.ts` (pure season math, unit-tested), `hooks/useCaptainsMatch.ts`, `components/captains/` (`CaptainsMatchSection`, `SeasonFlowGraph`, `CaptainsMatchScorecard`), `routes/CaptainsMatchRound.tsx` (`/captains-match/:tournamentId/round/:roundNumber`), `routes/admin/CaptainsMatchAdmin.tsx` + `CaptainsMatchRoundAdmin.tsx` + `components/admin/CaptainsMatchForm.tsx`.

## Cloud Functions map (`functions/src/`)

- **Seed triggers** (`onCreate`): `seedMatchBoilerplate`, `seedRoundDefaults`, `seedTournamentDefaults`, `seedCourseDefaults`; `linkRoundToTournament` (`onWrite`).
- **Scoring/stats triggers** (`onWrite`): `computeMatchOnWrite`, `updateMatchFacts`, `aggregatePlayerStats`, `computeRoundTotals`, `computeRoundSkins`.
- **Betting settlement triggers**: `settleMatchBets` (+ `scoring/betSettlement.ts` for match/over-under/round bets).
- **Notification triggers**: `notifyMatchEvents`, `notifyTournamentEvents` (`messaging/`).
- **Callables** (`callables/`, each verifies `isAdmin` server-side where required):
  - `adminOps.ts` — tournament/round/player CRUD, locks, `setPlayerAdmin`, `adminOverrideHoleScore`, `linkAuthToPlayer`.
  - `matchOps.ts` — `editMatch`, `deleteMatch`, `setMatchLock`, `seedMatch`.
  - `betsOps.ts` / `settlementOps.ts` — `createBetOffer`, `createBetChallenge`, `acceptBet`, `declineBet`, `cancelBet`, `record/confirm/cancelSettlement`, `settlePlayerFutures`, `settleCupFutures`, `settleCaptainsMatchBets`.
  - `commentOps.ts` — `postComment`, `deleteComment`, `toggleReaction`.
  - `draftOps.ts` — `createPairingDraft`, `startPairingDraft`, `submitDraftPick`, `undoDraftPick`, `resetPairingDraft`, `finalizePairingDraft`, `setPairingDraftVisibility`. `createPairingDraft` without `firstPickTeam` opens the round in `staging` (availability locked in, no coin flip yet, captains can plan); `startPairingDraft` records the flip and begins picking. `setPairingDraftVisibility` flips a round's board between `live` (whole field watches) and `private` (captains/admins only) at any point, including after finalizing — that's the reveal.
  - `pairingPlanOps.ts` — `savePairingPlan`, gated by `requirePlanner`: any admin, any captain/co-captain, **or any player listed in `tournament.planAccessPlayerIds`** (the hand-picked list of extra planners, managed from the admin tournament-settings form). Saves the caller's OWN board only: the doc id is keyed by the player id derived from auth, and `authorizedUids` holds just that person's uid, so no one reads anyone else's plan — admins included.
  - `pushOps.ts` — `registerPushToken`, `setNotificationPrefs`.
  - `statsOps.ts` — `computeRoundRecap`, `recalculateAllStats`, `recalculateMatchStrokes`.
  - `sideEventOps.ts` — `createSideEvent`, `updateSideEvent`, `deleteSideEvent`, `saveSideEventTeam`, `deleteSideEventTeam` (see "Side events"). `updateSideEvent` fans `locked` out to the team docs (the rule checks the team's own copy, so no cross-doc `get()` per score save) and keeps `tournament.sideEvents[]` in sync. `saveSideEventTeam` also takes an optional `holes` map — the admin score-override path.
  - `captainsMatchOps.ts` — `saveCaptainsMatch` (create/update; creating sets `tournament.hasCaptainsMatch`, and the players lock once any card exists), `saveCaptainsMatchRound` (validated whole-card upsert into `rounds.{n}`), `deleteCaptainsMatchRound`, `deleteCaptainsMatch` (see "Captains' match").
  - `courseOps.ts` — course CRUD.
  - `contracts.ts` — shared TypeScript request/response contracts.

## Frontend conventions (`rowdy-ui/src/`)

- **Routing**: `main.tsx` defines the router; routes are `lazyWithRecovery`-loaded (stale-chunk retry/reload after a deploy). Public routes + an admin subtree gated by `RequireAdmin`.
- **Global state via contexts**: `AuthContext`, `TournamentContext` (shared tournament + roster + player cache — reuse it, don't re-subscribe), `NotificationsContext`, `ToastContext`, `LayoutContext`.
- **Data hooks** (`hooks/`): `useMatchData`, `useRoundData`, `useTournamentData`, `usePlayerStats`, `useBets`, `useComments`, `useSkinsData`, `usePairingDraft`, `usePushNotifications`, plus offline/loading helpers (`useDebouncedSave`, `useSyncFlush`, `useResolvedLoading`, `useNetworkStatus`).
- **PWA**: `vite-plugin-pwa` with `registerType: autoUpdate`; SW registered app-wide in `main.tsx` (60s poll + on-visibility update, deferred while on a `/match/` scorecard). Offline scoring is queued and flushed on reconnect.
- **Styling**: Tailwind 4 via the Vite plugin. Theme CSS variables (`--team-a-default`, `--team-b-default`, `--brand-primary`); `theme-christmas` is the only alternate theme (there is **no dark theme** — emerald/amber/blue literals are canonical, per `components/ui/badge.tsx`). Use the shared `ui/` primitives (`Badge`, `Button`, `Card`, …).
- **Env** (`rowdy-ui/.env.local`, template in `.env.example`): the `VITE_*` Firebase web config (not secret — rules protect data) plus `VITE_FIREBASE_VAPID_KEY` for web push.

## Security rules (`firestore.rules`)

- Most collections are **public-read**, granted per-collection — there is deliberately **no `/{document=**}` wildcard** (a wildcard would override the narrower rules). The exceptions are the group's private data — `bets`, `betSettlements`, `comments` (+ `comments/*/replies`), and `pairingDrafts` — which are **signed-in-read** (`request.auth != null`, plus a per-draft `visibility` check, below); and `players/{id}/private/**` (PII), which is **server-only** (`if false`). The `/sportsbook` and `/chat` pages are gated client-side by `RequireAuth`, and the match-page comment thread shows a login prompt when signed out.
- `pairingPlans/{planId}` is the one collection gated **per-document**: `request.auth.uid in resource.data.authorizedUids`, which the server stamps with the owner's uid alone. Note the rule reads `resource.data`, so a *missing* plan also returns `permission-denied` — for your own plan that just means "nothing saved yet" (see `usePairingPlan`).
- `pairingDrafts/{roundId}` is signed-in-read **only while `visibility` is `live`** (the default, including for the older drafts that predate the field). A `private` draft narrows to `authorizedUids` — the captains/co-captains/admins stamped at creation — so a round can be drafted out of sight and revealed later by an admin calling `setPairingDraftVisibility`. A denied listener is terminal in the SDK, so `useRoundDrafts` re-subscribes to hidden rounds on a timer; that's what makes a reveal light up an already-open `/pairings-tv` board. Finalizing a private draft still creates public `matches` — the board stays hidden, the pairings don't.
- Client **match writes** are restricted to the `holes` map only (`affectedKeys().hasOnly(['holes'])`), and only for a rostered player in `match.authorizedUids` — **or** anyone when the tournament has `openPublicEdits: true` (a temporary QA toggle; turn it back off). Locked matches reject writes.
- `sideEventTeams` is the **second (and only other) client-writable collection**, with the same shape: a member of that team (`authorizedUids`) may change `holes` and nothing else, and only while unlocked. It is a top-level collection rather than a `sideEvents` subcollection precisely because `rounds/{id}/{document=**}` is server-write-only and score entry needs a direct client write for the offline queue to carry it. Both rules also assert `holes.keys().hasAll(existing keys)` — a write may never *drop* a hole, which is what stops one scorer clobbering another's entries. **Consequently, clearing a score writes `gross: null`; it never deletes the key.** `sideEvents` itself is public-read/server-write.
- `captainsMatches/{tournamentId}` is **public-read, server-write**: every card goes through the `captainsMatchOps` admin callables, so unlike `matches` and `sideEventTeams` there is no client score-entry path to guard.
- The **top-level `players` doc is server-only-write** (`allow write: if false`) — there is no client self-link path. Account linking (writing `authUid` + the private `email`) is done only by the admin `linkAuthToPlayer` callable via the Admin SDK. (The former self-link rule let any signed-in user claim an unlinked player's `authUid` — including an unlinked admin's — which this closes.) A `notifications` doc's owner may still update only `read`/`readAt`.
- **There is no working `isAdmin()` in rules** — player docs are keyed by player id, not auth uid, so `get(/players/$(uid))` never resolves. Admin authorization is enforced **server-side in the callables**; the `RequireAdmin` UI gate is UX only. Everything not client-writable is written by Cloud Functions via the Admin SDK (rules don't apply).
- **No App Check** (removed Nov 2026). The client waited on a reCAPTCHA Enterprise token before Firestore's first request, adding ~1.5 s to app start, while Firestore enforcement was never on. The only paid endpoint, `askRulesOfficial`, is bounded by its roster-player gate (`requirePlayer`), rate limit and the xAI account's spend cap. Re-adding App Check means re-initialising it in `firebase.ts` *and* turning on enforcement, or it costs startup time for no protection.
- **Rules Official**: the in-app Grok chat (`/rules-official`, `askRulesOfficial` callable) is gated to **admins only** for now — server-side (`requireAdmin`), plus a `RequireAdmin` route wrap and an admin-only menu link. Non-admins keep the free NotebookLM link even when `tournament.rulesOfficialUseGrok` is on. To open it to all players later: revert the callable to `requirePlayer` and drop the `&& player?.isAdmin` in Layout + the route's `RequireAdmin`.
- **Storage**: the app doesn't use Firebase Storage; `storage.rules` is a deny-all placeholder (defense in depth) wired via `firebase.json`.

## Don't touch lightly

- **Scoring logic** (`functions/src/scoring/`, `functions/src/helpers/`) — thousands of lines of vitest coverage for edge cases (comebacks, dormie, vs-all, ham-and-egg, jekyll-and-hyde, clutch/18th-hole). Keep `cd functions && npm run test:run` green.
- **`computeMatchOnWrite`** — runs on every match write. Perf regressions or write-back loops rack up Cloud Functions charges fast. Preserve the `_computeSig`/`_lastComputed` guards.
- **`firestore.rules`** — misconfiguration either locks players out mid-tournament or exposes the DB. Re-read the security section above before editing.

## Stats reference

**`playerMatchFacts` (per player per closed match)** — references (`playerId`, `matchId`, `roundId`, `tournamentId`, `team`, `format`); outcome (`outcome`, `pointsEarned`); holes (`holesWon/Lost/Halved`, `finalMargin`, `finalThru`, `winningHole`, `holesPlayed`, `hasPostMatchData`, `holePerformance[]`); momentum (`comebackWin`, `blownLead`, `wasNeverBehind`, `leadChanges`); clutch (`decidedOn18`, `won18thHole`); ball/drive usage (`ballsUsed`, `ballsUsedSolo/Shared/SoloWonHole/SoloPush`, `ballUsedOn18`, `drivesUsed`); scoring (`totalGross`, `totalNet`, `strokesVsParGross/Net`, `teamTotalGross`, `teamStrokesVsParGross`, `coursePar`); team-quality (`hamAndEggCount`, `jekyllAndHyde`); context (`playerTier`, `playerHandicap`, `partner*`/`opponent*` ids/tiers/handicaps, `courseId`, `day`, `tournamentYear/Name/Series`); captain flags (`isCaptain`, `isCoCaptain`, `captainVsCaptain`).

**`playerStats/{playerId}/bySeries/{series}` (aggregated)** — `series`; core record (`wins`, `losses`, `halves`, `points`, `matchesPlayed`); `formatBreakdown`; cumulative scoring (`totalGross`, `totalNet`, `holesPlayed`, `strokesVsParGross/Net`, `birdies`, `eagles`, `holesWon/Lost/Halved`); badges (`comebackWins`, `blownLeads`, `neverBehindWins`, `jekyllAndHydes`, `clutchWins`, `hamAndEggs`); team-format (`drivesUsed`, `ballsUsed`, `ballsUsedSolo`); captain (`captainWins/Losses/Halves`, `captainVsCaptainWins/Losses/Halves`); `lastUpdated`.

## Where to look for more

- [README.md](README.md) — product overview + human/dev onboarding.
- [SCORING-LEADERS-IMPLEMENTATION.md](SCORING-LEADERS-IMPLEMENTATION.md) — round-recap scoring-leaders feature.
- `scripts/README.md` — break-glass seeding / auth-linking scripts and the player onboarding workflow.
