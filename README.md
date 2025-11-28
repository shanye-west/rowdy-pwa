LAST UPDATED ON FRI NOV 28 3:53PM

What the app is

A mobile-first Progressive Web App for a 12v12 Ryder-Cup–style golf tournament. Our webpage (for styling, etc. is www.rowdycup.com). Admins seed all setup data in Firestore (no admin UI). Players only enter gross scores per hole during play. Cloud Functions compute net, hole winners, match status, and results in real time. The public can view everything read-only (match pages, leaderboard, roster).

If you want the longer spec you drafted earlier, it’s here: /mnt/data/Golf Tournament PWA - Project Blueprint (Final MVP).docx
And the current “compute & stats” contract lives here (latest): Golf Pwa — Compute & Stats Contract V1 (Canvas)

Who uses it

Players: enter hole scores on phones; see live match status.

Spectators: read-only live matches, leaderboard, roster by tier.

Admin (pre-event only): seeds tournaments, rounds, matches, players, handicaps; may lock/unlock a match.

Core behavior

Multiple tournaments stored; exactly one active=true live at a time; others are read-only history.

Rounds own the format; matches inherit it (no per-match overrides).

Formats supported: Singles, Two-man Best Ball, Two-man Shamble (gross entry; scoring like best ball), Two-man Scramble.

Matches are auto-templated with 18 holes and format-specific inputs on create.

Handicaps are pre-seeded as per-player strokesReceived arrays (length 18, each 0 or 1). Course handicaps capped at 18, so never >1 stroke per hole.

Players type gross numbers only:

Singles: one gross per side.

Best Ball/Shamble: two gross inputs per side.

Scramble: one team gross per side.

Net calculation = gross − strokesReceived[holeIndex].

Hole winners:

Scramble: team gross vs team gross.

Best Ball/Shamble: side score = min(player net); lower wins; equal = AS.

Singles: player net vs player net.

Match status/result:

Win = full pointsValue; halve (AS) = half; loss = 0.

Early closure when lead > holes remaining → closed=true; “dormie” when lead == holes remaining.

End of 18 tied → AS; each gets half points.

Editing earlier holes can reopen a closed match if the math changes.

Player Tier tracking per tournament (A/B/C/D) for roster display and lifetime stats “by tier.”

Head-to-head counts include team formats as agreed.

Data (Firestore, simplified)

tournaments/{id}: { active, name, teamA:{ id,name,color, rosterByTier:{A:[],B:[],C:[],D:[]} }, teamB:{...}, roundIds[] }

players/{id}: { displayName?, username? }

rounds/{id}: { tournamentId, day, format, course:{ name, holes:[{number,par,hcpIndex}] }, matchIds[] }

matches/{id}:

Setup: { tournamentId, roundId, pointsValue, teamAPlayers:[{playerId,strokesReceived:number[18]}], teamBPlayers:[...] }

Inputs per hole:

Singles: { teamAPlayerGross?, teamBPlayerGross? }

Best Ball/Shamble: { teamAPlayersGross:[n|null,n|null], teamBPlayersGross:[n|null,n|null] }

Scramble: { teamAGross?, teamBGross? }

Computed: status:{ leader|null, margin, thru, dormie, closed }, result:{ winner|'AS', holesWonA, holesWonB }

Security (development → production)

Dev: public read; any authenticated (anonymous) user can update matches.

Production tightening: only allow writes to matches/{id}.holes.*.input.*. Deny writes to status, result, rosters, or setup fields. Optional: restrict writers to rostered players or admin; lock when closed.

Tech stack

Firebase: Firestore, Cloud Functions (Gen-2), Auth (Anonymous), Hosting.

Frontend: Vite + React (TypeScript), PWA-ready.

Live updates: Firestore onSnapshot on match docs.

What you want long-term

Simple, reliable scoring for all formats with minimal UI.

Read-only public access; phones show live status.

Full historical stats:

Per-player lifetime and per-tournament records.

Head-to-head totals (team formats count).

Records by match type and by Tier (A/B/C/D).

No in-app admin; all seeding via Firestore UI; templates/defaults reduce data entry.

Step-by-step plan
Phase 1 — Core UX (now)

Lock dev rules to “holes-only” writes (keep public read).

Match page:

Live subscription, format-specific inputs.

Team names/colors, player names.

Inputs disabled when status.closed.

Stroke badges per hole (visual check of strokesReceived).

Leaderboard route (/leaderboard): sum points from result by team and by round.

Roster route (/roster): list Tier A/B/C/D per team from rosterByTier.

Hosting deploy. Verify on phones.

Phase 2 — Stats engine

Cloud Function updatePlayerStatsOnMatch:

On matches/{id} write, if result changed, upsert immutable playerMatchFacts for each rostered player with an outcome signature.

Apply idempotent increments to playerStats (lifetime, by type, by tournament) and headToHead (lifetime/by type/by tournament).

Player page (/player/:playerId): show lifetime record, per-type splits, head-to-head, by-tier slices.

Phase 3 — Admin conveniences (optional)

In-UI Lock/Unlock control (admin-only) to toggle status.closed.

Seed validator script (Node/TS) to sanity-check Firestore docs before events:

Valid strokes arrays; hole keys “1”..“18”; players exist; format present; pointsValue>0.

Tighten rules to rostered-player writes only; add admin bypass.

Phase 4 — PWA polish

vite-plugin-pwa manifest + icons; registerType:'autoUpdate'.

Offline read caching verification; install banners.

---

## Stats Reference

Every stat tracked in `playerMatchFacts` and how it's calculated.

### Core Match Stats

| Stat | Calculation | Plain English |
|------|-------------|---------------|
| `outcome` | `"win"` / `"loss"` / `"halve"` based on match result | Did you win, lose, or tie the match? |
| `pointsEarned` | Full `pointsValue` for win, half for halve, 0 for loss | Points you earned from this match |
| `holesWon` | Count of holes where your team/side had the lower net (or gross for scramble) | How many holes you won |
| `holesLost` | Count of holes where opponent had the lower score | How many holes you lost |
| `holesHalved` | `finalThru - holesWon - holesLost` | How many holes ended in a tie |
| `finalMargin` | Number of holes up/down when match ended | How many holes you won or lost by |
| `finalThru` | Last hole played (1-18, may end early if closed) | What hole the match ended on |

### Momentum Stats

| Stat | Calculation | Plain English |
|------|-------------|---------------|
| `comebackWin` | `true` if you were down 3+ holes at any point on back 9 and still won | Did you mount a big comeback to win? |
| `blownLead` | `true` if you were up 3+ holes at any point on back 9 and lost | Did you blow a big lead? |
| `wasNeverBehind` | `true` if you never trailed at any point during the match | Were you always ahead or tied? |
| `leadChanges` | Count of times the leader changed during the match | How many times did the lead swap? |
| `winningHole` | Hole number where match was clinched (`null` if went 18 or halved) | What hole did the match end on? |

### Clutch Stats (18th Hole Pressure)

These stats track matches that were decided by the 18th hole result.

| Stat | Calculation | Plain English |
|------|-------------|---------------|
| `decidedOn18` | `true` if the 18th hole result directly determined the match outcome | Was the match decided on the final hole? |
| `won18thHole` | `true` if your team won, `false` if lost, `null` if pushed | Did your team win the 18th hole? |

**What counts as "Decided on 18":**
- Match went to 18 holes (not closed early)
- The 18th hole result changed the outcome

**Scenarios:**
| Going into 18 | 18th Hole | Match Result | Decided on 18? |
|---------------|-----------|--------------|----------------|
| AS (tied) | Team wins | Winner 1UP | ✅ Yes |
| AS (tied) | Push | Match halved | ❌ No |
| 1UP | Trailing team wins | Match halved | ✅ Yes |
| 1UP | Push | Leader wins 1UP | ❌ No |
| 1UP | Leader wins | Leader wins 2UP | ❌ No |
| 2UP+ | Any | N/A | ❌ No (closed early) |

**Derived Stats:**
- **Clutch Win**: `decidedOn18 && won18thHole === true && outcome === "win"` — Won the match by winning 18
- **Clutch Save**: `decidedOn18 && won18thHole === true && outcome === "halve"` — Saved a halve by winning 18 when down 1
- **Choke Loss**: `decidedOn18 && won18thHole === false && outcome === "loss"` — Lost the match by losing 18
- **Choke Halve**: `decidedOn18 && won18thHole === false && outcome === "halve"` — Let opponent halve by losing 18 when up 1

### Ball Usage Stats (Best Ball & Shamble Only)

These stats track when your individual score was used as the team score. Best Ball compares **net** scores; Shamble compares **gross** scores.

| Stat | Calculation | Plain English |
|------|-------------|---------------|
| `ballsUsed` | Holes where your score ≤ partner's score (includes ties) | How many times was your ball "in play"? |
| `ballsUsedSolo` | Holes where your score < partner's score (strictly better) | How many times did you carry the team alone? |
| `ballsUsedShared` | Holes where your score = partner's score | How many times did you and your partner tie? |
| `ballsUsedSoloWonHole` | Holes where you were solo AND your team won the hole | Times you single-handedly won a hole |
| `ballsUsedSoloPush` | Holes where you were solo AND the hole was halved | Times you single-handedly pushed (tied) a hole |
| `ballUsedOn18` | `true` if your ball was used solo on 18, `false` if partner's, `null` if tied | Was your ball the counting ball on the final hole? |

**Derived Clutch Stats (combining with 18th hole stats):**
- **Clutch Hero**: `decidedOn18 && won18thHole === true && ballUsedOn18 === true` — Your ball won the decisive 18th
- **Clutch Goat**: `decidedOn18 && won18thHole === false && ballUsedOn18 === true` — Your ball lost the decisive 18th

### Drive Usage Stats (Scramble & Shamble Only)

| Stat | Calculation | Plain English |
|------|-------------|---------------|
| `drivesUsed` | Count of holes where your drive was selected | How many of your drives did the team use? |

### Individual Scoring Stats (Singles & Best Ball Only)

| Stat | Calculation | Plain English |
|------|-------------|---------------|
| `totalGross` | Sum of your gross scores for all holes played | Your raw score before handicap |
| `totalNet` | Sum of `gross - strokesReceived` for each hole | Your score after handicap strokes |
| `strokesVsParGross` | `totalGross - coursePar` | How many over/under par (gross)? E.g., +5 or -2 |
| `strokesVsParNet` | `totalNet - coursePar` | How many over/under par (net)? |

### Team Scoring Stats (Scramble & Shamble Only)

| Stat | Calculation | Plain English |
|------|-------------|---------------|
| `teamTotalGross` | Sum of team gross scores for all holes played | The team's combined score |
| `teamStrokesVsParGross` | `teamTotalGross - coursePar` | Team's strokes over/under par |

### Handicap & Strokes Stats

| Stat | Calculation | Plain English |
|------|-------------|---------------|
| `playerHandicap` | Player's handicap index from tournament settings | Your handicap going into this match |
| `strokesGiven` | Sum of `strokesReceived` array (0s and 1s) | Total strokes you received in the match |

### Context Stats

| Stat | Source | Plain English |
|------|--------|---------------|
| `playerTier` | From `tournament.rosterByTier` (A/B/C/D) | What tier were you playing in? |
| `partnerIds` / `partnerTiers` / `partnerHandicaps` | From match player arrays | Who was your partner and their details? |
| `opponentIds` / `opponentTiers` / `opponentHandicaps` | From match player arrays | Who did you play against? |
| `coursePar` | From course document | What was par for the course? |
| `courseId` / `day` | From round document | Which course and which day? |
| `tournamentYear` / `tournamentName` / `tournamentSeries` | From tournament document | What tournament was this? |

### Aggregated Lifetime Stats (playerStats)

| Stat | Calculation | Plain English |
|------|-------------|---------------|
| `wins` | Count of `outcome = "win"` across all matches | Total career wins |
| `losses` | Count of `outcome = "loss"` across all matches | Total career losses |
| `halves` | Count of `outcome = "halve"` across all matches | Total career ties |
| `totalPoints` | Sum of `pointsEarned` across all matches | Total career points |
| `matchesPlayed` | Count of all `playerMatchFacts` for this player | How many matches you've played |

### Format-Specific Notes

- **Singles**: 1v1, net scoring (`gross - strokesReceived`). Individual stats tracked.
- **Two-Man Best Ball**: 2v2, each player plays their own ball, best **net** score per team counts. Ball usage stats tracked.
- **Two-Man Shamble**: 2v2, players select a drive then play their own ball, best **gross** score counts (no handicap). Ball usage and drive stats tracked.
- **Two-Man Scramble**: 2v2, team picks best shot each time, one team gross score. Drive stats tracked.