# AGENTS.md — Rowdy Cup PWA

Canonical, tool-agnostic guide for AI coding agents (Claude Code, Cursor, Copilot, Codex, Aider, …) working in this repo. **This is the source of truth**; `CLAUDE.md` and `.github/copilot-instructions.md` are thin pointers to this file. Human contributors: start with [README.md](README.md).

---

## What this is

A mobile-first Progressive Web App for a **12v12, Ryder-Cup–style golf tournament**. Players enter gross scores on their phones; Firebase Cloud Functions compute net scores, hole winners, match status, results, and aggregated stats in real time. Everything is **public read-only**; score entry uses anonymous auth linked to a player.

- The engine also powers a second **series**, the "Christmas Classic" (`tournament.series` = `"rowdyCup" | "christmasClassic"`, which also drives theming).
- Served at **app.rowdycup.com**. `www.rowdycup.com` is a separate marketing site, not this app.
- Used in production (Dec 2025 event; more events each year).

## Golden rules (read before doing anything)

1. **Production is the only environment.** There is effectively one Firebase project — prod (`rowdy-pwa`). The `dev` alias in `.firebaserc` is unused; there is no staging. Every deploy and every emulator-free run touches **prod data**. **Before anything that writes to Firestore or deploys** (`firebase deploy`, any script in `scripts/`), confirm intent with the user. Reads, builds, lints, and tests are safe.
2. **`tsc` is the feedback loop.** The frontend `build` runs `tsc -b` first, so type errors block the build. Run builds/typecheck after edits; treat that as primary validation.
3. **Keep scoring & rules green.** Scoring logic and `firestore.rules` are covered by extensive tests; never change them without `cd functions && npm run test:run` passing.
4. **Strict TypeScript, no `as any`.** Narrow with the type guards in `rowdy-ui/src/types.ts` instead of casting.

## Monorepo layout

- **`rowdy-ui/`** — React 19 + Vite 7 + TypeScript 5.9 + Tailwind 4 frontend (the PWA).
- **`functions/`** — Firebase Cloud Functions Gen-2 (TypeScript, Node 20). Firestore triggers + HTTPS callables for scoring, stats, betting, chat, notifications, drafts, admin ops, and a read-only MCP server.
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

# Deploy (manual, no predeploy build hooks — BUILD FIRST, then confirm with user)
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

Top-level (all **public-read**). Clients may write only three narrow things: a match's `holes` map, a player's own account-link fields (`authUid`/`email`), and their own notification read-state (`read`/`readAt`). Everything else is written by Cloud Functions via the Admin SDK, which bypasses rules.

| Collection | Purpose |
|---|---|
| `tournaments/{id}` | `active` (one at a time), `series`, `year`, `teamA`/`teamB` (`rosterByTier`, `handicapByPlayer`, captain ids, color, logo), `roundIds[]`, `draftPool`, feature flags (`openPublicEdits`, `hideDraftPool`, `commentsEnabled`, `sportsbookEnabled`, …) |
| `players/{id}` | `displayName`, `authUid`/`email` (account link), `isAdmin`, `scoutingNotes`. Docs are keyed by **player id** (e.g. `pShane`), not auth uid. |
| `rounds/{id}` | `tournamentId`, `day`, `format`, `courseId`, `pointsValue`, `trackDrives`, `locked`, skins pots, denormalized `pointTotals`, `matchIds[]` |
| `matches/{id}` | `teamAPlayers`/`teamBPlayers` (`{playerId, strokesReceived[18]}`), `holes.{1..18}.input` (format-specific), computed `status`/`result`, `completed`, cache fields (`_computeSig`, `_lastComputed`) |
| `courses/{id}` | `name`, `tees`, `par`, `holes[18]` (`number`, `par`, `hcpIndex`, `yards`) |
| `playerMatchFacts/{matchId}_{playerId}` | Immutable per-player, per-match stats (see reference below) |
| `playerStats/{playerId}` | Subcollections `bySeries/{series}`, `byTournament/{id}`, `byRound/{id}` — aggregated records |
| `roundRecaps/{roundId}` | Scoring leaders, per-hole averages, vs-all records (see `SCORING-LEADERS-IMPLEMENTATION.md`) |
| `bets`, `betSettlements` | Peer-to-peer sportsbook wagers + settle-up ledger |
| `comments/{id}` (+ `replies/`) | Match-thread & sportsbook trash-talk, emoji reactions, one-level replies |
| `pairingDrafts/{id}` | Live captains' snake-draft state |
| `notifications`, `pushTokens` | In-app notification feed + FCM web-push tokens |
| `matchNotifyState`, `tournamentNotifyState` | Idempotency guards for push notifications |
| `rounds/{id}/skinsResults/computed` | Computed skins pots/winners (subcollection) |

## Match formats & scoring

`RoundFormat` union with format-specific hole inputs in `matches/{id}.holes.{N}.input`:

| Format | Hole input | Hole winner |
|---|---|---|
| `singles` | `teamAPlayerGross`, `teamBPlayerGross` | net vs net (`gross − strokesReceived`) |
| `twoManBestBall` | `teamAPlayersGross[2]`, `teamBPlayersGross[2]` | best **net** per side |
| `twoManShamble` | `teamAPlayersGross[2]`, `teamBPlayersGross[2]` + `teamADrive`/`teamBDrive` | best **gross** per side (no strokes) |
| `twoManScramble` | `teamAGross`, `teamBGross` + `teamADrive`/`teamBDrive` | team gross vs team gross |

- **`fourManScramble` is historical-only.** It exists in the scoring/UI paths solely to render past-tournament data. **Do not** offer it for new rounds or add it to current-format docs/selection UI.
- **Handicaps**: `strokesReceived` is an 18-element array of 0/1 (course handicaps capped at 18 → never >1 stroke/hole). Applies to **singles** and **twoManBestBall** only.
- **Drive tracking**: shamble & scramble record which player's drive was used per hole (`trackDrives` on the round).
- **Match status/result**: win = full `pointsValue`, halve (AS) = half, loss = 0. Early closure when lead > holes remaining (`closed`); `dormie` when lead == holes remaining; tied through 18 → AS.
- Use the type guards in `rowdy-ui/src/types.ts` (`isSinglesFormat`, `isFourPlayerFormat`, `isDriveTrackingFormat`, …) rather than string comparisons. Hole shapes: `SinglesHoleInput`, `BestBallHoleInput`, `ShambleHoleInput`, `ScrambleHoleInput`; narrow the loose `HoleInputLoose` when the format is known. Normalize timestamps with `toDateOrNull()` and the `FirestoreTimestampLike` alias.

## Cloud Functions map (`functions/src/`)

- **Seed triggers** (`onCreate`): `seedMatchBoilerplate`, `seedRoundDefaults`, `seedTournamentDefaults`, `seedCourseDefaults`; `linkRoundToTournament` (`onWrite`).
- **Scoring/stats triggers** (`onWrite`): `computeMatchOnWrite`, `updateMatchFacts`, `aggregatePlayerStats`, `computeRoundTotals`, `computeRoundSkins`.
- **Betting settlement triggers**: `settleMatchBets` (+ `scoring/betSettlement.ts` for match/over-under/round bets).
- **Notification triggers**: `notifyMatchEvents`, `notifyTournamentEvents` (`messaging/`).
- **Callables** (`callables/`, each verifies `isAdmin` server-side where required):
  - `adminOps.ts` — tournament/round/player CRUD, locks, `setPlayerAdmin`, `adminOverrideHoleScore`, `linkAuthToPlayer`.
  - `matchOps.ts` — `editMatch`, `deleteMatch`, `setMatchLock`, `seedMatch`.
  - `betsOps.ts` / `settlementOps.ts` — `createBetOffer`, `createBetChallenge`, `acceptBet`, `declineBet`, `cancelBet`, `record/confirm/cancelSettlement`, `settlePlayerFutures`, `settleCupFutures`.
  - `commentOps.ts` — `postComment`, `deleteComment`, `toggleReaction`.
  - `draftOps.ts` — `createPairingDraft`, `submitDraftPick`, `undoDraftPick`, `resetPairingDraft`, `finalizePairingDraft`.
  - `pushOps.ts` — `registerPushToken`, `setNotificationPrefs`.
  - `statsOps.ts` — `computeRoundRecap`, `recalculateAllStats`, `recalculateMatchStrokes`.
  - `courseOps.ts` — course CRUD.
  - `contracts.ts` — shared zod request/response contracts.
- **MCP server** (`mcp/`): the `mcp` HTTPS function — a read-only Model Context Protocol endpoint (see `functions/src/mcp/README.md`). Uses the *unauthenticated* Firebase Web SDK (rules-enforced read-only), guarded by the `ROWDY_MCP_KEY` secret. Never uses the Admin SDK; physically cannot write.

## Frontend conventions (`rowdy-ui/src/`)

- **Routing**: `main.tsx` defines the router; routes are `lazyWithRecovery`-loaded (stale-chunk retry/reload after a deploy). Public routes + an admin subtree gated by `RequireAdmin`.
- **Global state via contexts**: `AuthContext`, `TournamentContext` (shared tournament + roster + player cache — reuse it, don't re-subscribe), `NotificationsContext`, `ToastContext`, `LayoutContext`.
- **Data hooks** (`hooks/`): `useMatchData`, `useRoundData`, `useTournamentData`, `usePlayerStats`, `useBets`, `useComments`, `useSkinsData`, `usePairingDraft`, `usePushNotifications`, plus offline/loading helpers (`useDebouncedSave`, `useSyncFlush`, `useResolvedLoading`, `useNetworkStatus`).
- **PWA**: `vite-plugin-pwa` with `registerType: autoUpdate`; SW registered app-wide in `main.tsx` (60s poll + on-visibility update, deferred while on a `/match/` scorecard). Offline scoring is queued and flushed on reconnect.
- **Styling**: Tailwind 4 via the Vite plugin. Theme CSS variables (`--team-a-default`, `--team-b-default`, `--brand-primary`); `theme-christmas` is the only alternate theme (there is **no dark theme** — emerald/amber/blue literals are canonical, per `components/ui/badge.tsx`). Use the shared `ui/` primitives (`Badge`, `Button`, `Card`, …).
- **Env** (`rowdy-ui/.env.local`, template in `.env.example`): the `VITE_*` Firebase web config (not secret — rules protect data) plus `VITE_FIREBASE_VAPID_KEY` for web push.

## Security rules (`firestore.rules`)

- All app collections are **public-read**, granted per-collection — there is deliberately **no `/{document=**}` wildcard** (a wildcard would override the narrower rules).
- Client **match writes** are restricted to the `holes` map only (`affectedKeys().hasOnly(['holes'])`), and only for a rostered player in `match.authorizedUids` — **or** anyone when the tournament has `openPublicEdits: true` (a temporary QA toggle; turn it back off). Locked matches reject writes.
- The `players` update rule is limited to account-linking fields (`authUid`/`email`) so a player can't self-grant `isAdmin`; a `notifications` doc's owner may update only `read`/`readAt`.
- **There is no working `isAdmin()` in rules** — player docs are keyed by player id, not auth uid, so `get(/players/$(uid))` never resolves. Admin authorization is enforced **server-side in the callables**; the `RequireAdmin` UI gate is UX only. Everything not client-writable is written by Cloud Functions via the Admin SDK (rules don't apply).

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
- `functions/src/mcp/README.md` — the read-only AI (MCP) endpoint.
- `scripts/README.md` — break-glass seeding / auth-linking scripts and the player onboarding workflow.
