# Rowdy Cup PWA 🏌️

A mobile-first Progressive Web App for a **12v12, Ryder-Cup–style golf tournament**. Players enter gross scores on their phones; the app computes net scores, hole winners, live match status, and full historical stats in real time. Everyone else watches live, read-only.

- **Live app:** [app.rowdycup.com](https://app.rowdycup.com) &nbsp;·&nbsp; Marketing site: [www.rowdycup.com](https://www.rowdycup.com) *(separate)*
- **In production** for the annual Rowdy Cup. The same engine also runs a "Christmas Classic" series.

> **AI agents / coding assistants:** read [AGENTS.md](AGENTS.md) — it's the canonical technical guide.

---

## What it does

- **Live match-play scoring** in four formats — Singles, Two-Man Best Ball, Two-Man Shamble, Two-Man Scramble — with automatic net scoring, hole winners, dormie/early-close logic, and per-hole stroke handicaps.
- **Cup leaderboard** with a live score tracker (points to win, confirmed vs. projected).
- **Round pages & recaps** — schedule, per-round scores, skins games (gross/net pots), and rich Round Recaps (scoring leaders, per-hole averages, vs-all records).
- **Teams & rosters** by tier (A/B/C/D), team colors and logos.
- **Player profiles** — lifetime and per-series records, format breakdowns, badges, head-to-head.
- **Tournament history** — every past event, read-only.
- **Captains' live snake-draft** for setting pairings, and a pre-draft **Draft Pool** dashboard.
- **Sportsbook** — peer-to-peer wagers (match bets, over/unders, round & futures markets) with an in-play view and a settle-up ledger.
- **Chat & trash talk** — match threads and a tournament-wide feed with emoji reactions and replies.
- **Push notifications** (chat, bets, match & tournament events) with per-category preferences.
- **Installable PWA** — offline-tolerant scoring that queues and syncs on reconnect; auto-updates after deploys.
- **Admin console** (`/admin`) — manage tournaments, rounds, matches, players, courses, handicaps, locks, and score corrections.
- **Read-only AI access** via a hosted [MCP server](functions/src/mcp/README.md) so players can point their own AI assistant at tournament data.

## Tech stack

- **Frontend:** React 19, Vite 7, TypeScript 5.9 (strict), Tailwind CSS 4, `vite-plugin-pwa`. PWA served via Firebase Hosting.
- **Backend:** Firebase Cloud Functions Gen-2 (TypeScript, Node 20) — Firestore triggers + HTTPS callables.
- **Data / auth:** Cloud Firestore (real-time `onSnapshot`), Firebase Anonymous Auth (score entry), FCM (web push).

## Repository layout

| Path | What's there |
|---|---|
| [`rowdy-ui/`](rowdy-ui/) | React + Vite frontend (the PWA) |
| [`functions/`](functions/) | Cloud Functions — scoring, stats, betting, chat, notifications, drafts, admin, MCP |
| [`scripts/`](scripts/) | Break-glass admin scripts (seeding, exports, auth linking) — see [`scripts/README.md`](scripts/README.md) |
| Root | `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `.firebaserc` |
| [`AGENTS.md`](AGENTS.md) | Deep technical guide (architecture, data model, scoring contracts) |

## Getting started (local dev)

**Prerequisites:** Node 20+, `npm`, and the Firebase CLI (`npm i -g firebase-tools`).

```bash
# 1. Frontend
cd rowdy-ui
cp .env.example .env.local        # fill in Firebase web config + VAPID key
npm install
npm run dev                       # http://localhost:5173

# 2. Functions (optional — for backend work)
cd ../functions
npm install
npm run build
npm run serve                     # Firebase emulators (functions + Firestore)
```

The Firebase web config in `.env.local` is **not secret** (Firestore security rules are what protect data). Get the values from Firebase Console → Project Settings → Your apps.

### Everyday commands

```bash
# rowdy-ui/
npm run build      # tsc -b && vite build   (type errors block the build)
npm run lint       # eslint .
npm run test:run   # vitest, single run

# functions/
npm run build      # tsc
npm run test:run   # vitest (scoring + stats suites)
```

## Deploying

> ⚠️ **There is only one Firebase project: production (`rowdy-pwa`).** No staging exists — every deploy hits **live tournament data**. Build first (there are no predeploy build hooks) and double-check before deploying.

```bash
# Frontend
cd rowdy-ui && npm run build && firebase deploy --only hosting

# Cloud Functions
cd functions && npm run build && firebase deploy --only functions

# Security rules / indexes  (deploy indexes BEFORE code that queries them)
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

## How the app works (in one breath)

Players write a gross score to a single field (`matches/{id}.holes.{N}.input`). A Cloud Function recomputes match `status` and `result` on every write. When a match closes, per-player stat records are written and rolled up into lifetime/per-series aggregates. The UI subscribes to Firestore in real time, so scores, standings, and stats update live on every phone. Security rules keep the whole database public-read while allowing players to write **only** their own hole scores; everything else is written server-side.

Full data model, collection reference, scoring contracts, and the Cloud Functions map are in **[AGENTS.md](AGENTS.md)**.

## For tournament admins

Day-to-day setup lives in the in-app **Admin console** at `/admin` (admin accounts only): create/edit tournaments, rounds, matches, players, and courses; set handicaps; lock/unlock rounds and matches; override scores; and recompute stats. The [`scripts/`](scripts/) folder holds break-glass equivalents (bulk seeding, auth-account linking, exports) for when the UI can't do something or auth is down mid-event — see [`scripts/README.md`](scripts/README.md), including the player onboarding / login flow.

## Further reading

- **[AGENTS.md](AGENTS.md)** — architecture, Firestore collections, scoring & stats contracts, function map, conventions (the technical bible).
- **[SCORING-LEADERS-IMPLEMENTATION.md](SCORING-LEADERS-IMPLEMENTATION.md)** — round-recap scoring-leaders feature.
- **[functions/src/mcp/README.md](functions/src/mcp/README.md)** — the read-only AI (MCP) endpoint and how to connect a client.
- **[scripts/README.md](scripts/README.md)** — seeding, exports, and player auth workflow.
