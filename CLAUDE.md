# Rowdy Cup PWA — Claude Code Guide

A mobile-first PWA for a 12v12 Ryder-Cup–style golf tournament. Used in production for the December 2025 tournament; next event is in a few months. Players enter gross scores on phones; Cloud Functions compute net scores, hole winners, match status, and aggregated stats in real time. Public read; anonymous auth for score entry. The PWA (this app) is served at **app.rowdycup.com**; www.rowdycup.com is just the marketing website, not this app.

## Monorepo layout

- [rowdy-ui/](rowdy-ui/) — React 19 + Vite 7 + TypeScript + Tailwind 4 frontend (PWA)
- [functions/](functions/) — Firebase Cloud Functions Gen-2 (TypeScript, Node 20). Triggers + callables for scoring, stats, and admin ops
- [scripts/](scripts/) — Admin Node scripts: Firestore export, dev-DB seeding, player handicap seeding. Touches Firestore directly — use carefully
- Root — Firebase config ([firebase.json](firebase.json), [firestore.rules](firestore.rules), [firestore.indexes.json](firestore.indexes.json))

## Commands

```bash
# Frontend (rowdy-ui/)
cd rowdy-ui && npm run dev          # Vite dev server (PWA enabled in dev)
cd rowdy-ui && npm run build        # tsc -b && vite build
cd rowdy-ui && npm run lint         # eslint .
cd rowdy-ui && npm run test:run     # vitest single run

# Functions
cd functions && npm run build       # tsc
cd functions && npm run test:run    # vitest single run
cd functions && npm run serve       # build + emulators (local only)
```

The frontend `build` runs `tsc -b` first — type errors block the build. Treat that as the primary feedback loop after edits.

## Deployment posture

**There is effectively only one Firebase project: production (`rowdy-pwa`).** A `dev` alias (`dev-rowdy-pwa`) exists in [.firebaserc](.firebaserc) but is **not used** — there is no separate dev environment. Every deploy and every test run hits **prod**, against **production data**. There is no staging to catch mistakes, so before anything that writes to Firestore or deploys — `firebase deploy`, anything in [scripts/](scripts/) — confirm intent with the user. Reads, builds, lints, and tests are safe.

Deploy is manual. `firebase.json` defines **no `predeploy` build hooks**, so build first:
- `cd rowdy-ui && npm run build` then `firebase deploy --only hosting` — frontend
- `cd functions && npm run build` then `firebase deploy --only functions` — Cloud Functions
- `firebase deploy --only firestore:rules` — security rules

## Type safety conventions

- TypeScript **strict mode** is on across [rowdy-ui/tsconfig.app.json](rowdy-ui/tsconfig.app.json) and [functions/tsconfig.json](functions/tsconfig.json). Don't reach for `as any` — narrow with type guards instead.
- Match format logic uses the `RoundFormat` union and the type guards in [rowdy-ui/src/types.ts](rowdy-ui/src/types.ts) (`isSinglesFormat`, `isFourPlayerFormat`, `isDriveTrackingFormat`, etc.). Use these rather than string comparisons.
- Hole input shapes are format-specific (`SinglesHoleInput`, `BestBallHoleInput`, `ShambleHoleInput`, `ScrambleHoleInput`). The loose `HoleInputLoose` exists for backwards compatibility — narrow it when you know the format.
- Firestore timestamps use the `FirestoreTimestampLike` alias when fields may arrive as `Timestamp`, `Date`, or an ISO string. Use the `toDateOrNull()` helper in [rowdy-ui/src/utils.ts](rowdy-ui/src/utils.ts) to normalize before formatting.

## Key data flow

Players write only to `matches/{id}.holes.{N}.input` (the security rules enforce this). `computeMatchOnWrite` recalculates `status` + `result` on every match change; once a match closes, `updateMatchFacts` writes per-player `playerMatchFacts` records, and `aggregatePlayerStats` rolls those up into `playerStats/{playerId}/bySeries/{series}`. The frontend uses `onSnapshot` listeners (see [rowdy-ui/src/hooks/useMatchData.ts](rowdy-ui/src/hooks/useMatchData.ts) and siblings) so UI updates in real time.

Tournament context (active tournament + roster) is shared globally via [rowdy-ui/src/contexts/TournamentContext.tsx](rowdy-ui/src/contexts/TournamentContext.tsx) to avoid duplicate subscriptions. Auth flows through [rowdy-ui/src/contexts/AuthContext.tsx](rowdy-ui/src/contexts/AuthContext.tsx).

## Don't touch lightly

- **Scoring logic in [functions/src/scoring/](functions/src/scoring/) and [functions/src/helpers/](functions/src/helpers/)** — 4k+ lines of vitest tests cover edge cases (comebacks, dormie, vs-all simulations, ham-and-egg, jekyll-and-hyde). Any change must keep `cd functions && npm run test:run` green.
- **[firestore.rules](firestore.rules)** — controls who can write scores. Misconfiguration here either locks out players mid-tournament or opens the DB to the public. All app collections are public-read (granted per-collection — there is deliberately no `/{document=**}` wildcard, which would override the narrower rules). Client match writes are restricted to the `holes` map only; everything else is written by Cloud Functions via the Admin SDK (rules don't apply to them). Note: rules have no working `isAdmin()` (player docs are keyed by player id, not auth uid), so admin access is enforced server-side in callables, not in rules.
- **`computeMatchOnWrite` trigger** — runs on every match write. Performance regressions or infinite loops will rack up Cloud Functions charges fast.

## Where to look for more

- [.github/copilot-instructions.md](.github/copilot-instructions.md) — full data model, scoring contracts, stats reference. Read this when working on scoring, stats, or match-format logic.
- [README.md](README.md) — product spec, scoring rules, export/seed workflow.
- [SCORING-LEADERS-IMPLEMENTATION.md](SCORING-LEADERS-IMPLEMENTATION.md) — round recap / leaders feature notes.

## Known stubs (intentional)

- [rowdy-ui/src/routes/Player.tsx](rowdy-ui/src/routes/Player.tsx) is a "Coming Soon" page. The backend data (`playerStats`, `headToHead`) is computed and ready; the UI just isn't built yet. Don't auto-implement it unless asked.
