# Rowdy Cup PWA - Copilot Instructions

## Project Overview
A mobile-first PWA for a 12v12 Ryder Cup-style golf tournament. Players enter gross scores; Cloud Functions compute net scores, hole winners, and match status in real-time. Public read-only access; anonymous auth for score entry.

## Architecture

### Monorepo Structure
- **`rowdy-ui/`** - React + Vite + TypeScript frontend (PWA)
- **`functions/`** - Firebase Cloud Functions (Gen-2, TypeScript)
- **Root** - Firebase configuration (`firebase.json`, `firestore.rules`)

### Data Flow
1. Players enter gross scores → `matches/{id}.holes.{N}.input`
2. Cloud Functions trigger on match write → compute net scores, status, results
3. `playerMatchFacts` generated per player per match → aggregated to `playerStats`
4. Frontend uses `onSnapshot` for real-time updates

### Key Collections (Firestore)
- `tournaments` - One `active: true` at a time; contains `teamA/teamB` with `rosterByTier`, `handicapByPlayer`
- `rounds` - Owns `format`, `pointsValue`, `courseId`, `trackDrives`, `matchIds`; format can be null until selected
- `matches` - `teamAPlayers/teamBPlayers` with `strokesReceived[18]`; `holes` with format-specific inputs
- `courses` - Hole data with `holes[18]` array containing `par`, `hcpIndex`; also `name`, `tees`, `par` (total course par)
- `playerMatchFacts` - Immutable per-match stats per player (see PlayerMatchFact fields below)
- `playerStats` - Aggregated lifetime stats with `lastUpdated` timestamp

## Match Formats & Scoring

Four formats with different hole input structures in `matches/{id}.holes.{N}.input`:

| Format | Input Fields | Scoring Logic |
|--------|--------------|---------------|
| `singles` | `teamAPlayerGross`, `teamBPlayerGross` | Net = gross - strokesReceived |
| `twoManBestBall` | `teamAPlayersGross[2]`, `teamBPlayersGross[2]` | Best NET per team |
| `twoManShamble` | `teamAPlayersGross[2]`, `teamBPlayersGross[2]` + `teamADrive`, `teamBDrive` | Best GROSS per team (no strokes) |
| `twoManScramble` | `teamAGross`, `teamBGross` + `teamADrive`, `teamBDrive` | Team gross vs team gross |

**Handicap**: `strokesReceived` is 18-element array of 0/1; max 1 stroke per hole. Only applies to singles and bestBall formats.

**Drive Tracking**: Shamble and scramble formats track which player's drive was used per hole. UI shows a modal picker with player names, and a "D" indicator appears on score cells.

## PlayerMatchFact Fields
Generated when a match closes (`status.closed = true`):
- `playerId`, `matchId`, `roundId`, `tournamentId` - References
- `team` - "teamA" or "teamB"
- `format` - Match format
- `outcome` - "win" | "loss" | "halve"
- `pointsEarned` - Points from this match
- `holesWon`, `holesLost`, `holesHalved` - Hole-by-hole results (halved = finalThru - won - lost)
- `finalMargin`, `finalThru` - Match result details
- `drivesUsed` - Count of drives used (shamble/scramble only)
- `ballsUsed` - Count of times player's ball was used (compares gross scores)
- `totalGross`, `totalNet` - 18-hole totals (individual formats only)
- `strokesVsParGross`, `strokesVsParNet` - Strokes relative to par (individual formats)
- `teamTotalGross`, `teamStrokesVsParGross` - Team totals (team formats only)
- `coursePar` - Par for the course played
- `comebackWin`, `blownLead` - Momentum stats (was down/up 3+ on back 9)
- `leadChanges`, `wasNeverBehind`, `winningHole`, `strokesGiven` - Additional match stats
- `playerTier`, `playerHandicap`, `partnerIds`, `partnerTiers`, `partnerHandicaps` - Player context
- `opponentIds`, `opponentTiers`, `opponentHandicaps` - Opponent context
- `courseId`, `day`, `tournamentYear`, `tournamentName`, `tournamentSeries` - Round/tournament context

## Development Commands

\`\`\`bash
# Frontend (rowdy-ui/)
cd rowdy-ui && npm run dev      # Vite dev server with PWA
cd rowdy-ui && npm run build    # TypeScript check + Vite build

# Functions
cd functions && npm run build   # Compile TypeScript

# Deployment (all development uses production Firebase)
firebase deploy --only functions
firebase deploy --only hosting
\`\`\`

## Code Patterns

### Types (\`rowdy-ui/src/types.ts\`)
All Firestore document types defined here. Use \`RoundFormat\` union type for format checks. Note: \`RoundDoc.format\` can be \`null\` until format is selected.

### Firebase Hooks Pattern (Frontend)
\`\`\`typescript
// Real-time subscription pattern used in Match.tsx, Round.tsx
useEffect(() => {
  const unsub = onSnapshot(doc(db, "matches", matchId), (snap) => { ... });
  return () => unsub();
}, [matchId]);
\`\`\`

### Cloud Function Triggers (\`functions/src/index.ts\`)
- \`seedMatchBoilerplate\` - onCreate: normalizes holes structure based on format
- \`seedCourseDefaults\` - onCreate: sets default par (72) if missing
- \`seedRoundDefaults\` - onCreate: sets default trackDrives, format=null, matchIds=[]
- \`linkRoundToTournament\` - onWrite: adds roundId to tournament.roundIds
- \`computeMatchOnWrite\` - onWrite: calculates \`status\` and \`result\`
- \`updateMatchFacts\` - onWrite: generates \`playerMatchFacts\` when \`status.closed\`
- \`aggregatePlayerStats\` - onWrite: updates \`playerStats\` from facts

### Format-Aware Components
Match.tsx renders different input layouts based on format:
- Check \`isFourPlayerRows\` for best ball/shamble (4 player inputs per hole)
- Check \`isTeamFormat\` for scramble (2 team inputs per hole)
- \`trackDrives\` enables drive tracking UI for scramble/shamble
- Drive selector: Modal popup with player names, initials display, "D" indicator on cells

## Firebase Configuration

### Environment Variables (rowdy-ui/.env)
\`\`\`
VITE_API_KEY, VITE_AUTH_DOMAIN, VITE_PROJECT_ID, 
VITE_STORAGE_BUCKET, VITE_MESSAGING_SENDER_ID, VITE_APP_ID
\`\`\`

### Security Rules Pattern
Public read; authenticated users can update \`matches\`. No admin UI—all setup via Firestore console.

## Styling
- Tailwind CSS 4 via Vite plugin
- CSS variables for theming: \`--team-a-default\`, \`--team-b-default\`, \`--brand-primary\`
- \`tournament.series\` ("rowdyCup" | "christmasClassic") controls theme colors

## Key Business Logic

### Match Status Calculation
- \`leader\`: teamA/teamB/null, \`margin\`: holes up, \`thru\`: holes completed
- \`closed\`: true when lead > remaining holes
- \`dormie\`: lead equals remaining holes
- \`wasTeamADown3PlusBack9\`, \`wasTeamAUp3PlusBack9\`: momentum tracking
- Editing earlier holes can reopen a closed match

### Player Tiers
Players assigned to tiers (A/B/C/D) in \`tournament.teamA/teamB.rosterByTier\` for roster display and stats filtering.
