LAST UPDATED ON FRI NOV 28, 2025 AT 3:47PM

# Rowdy Cup Scripts

Scripts for seeding and managing Firestore data for the Rowdy Cup PWA.

## Setup

1. Download your Firebase service account key from Firebase Console → Project Settings → Service Accounts → Generate new private key
2. Save it as `service-account.json` in the project root (one level up from this folder)
3. Install dependencies:
   ```bash
   cd scripts
   npm install
   ```

## Seed Scripts

### Seed Players
```bash
npx ts-node seed-players.ts --input data/players.json
```

### Seed Course
```bash
npx ts-node seed-course.ts --input data/course.json
npx ts-node seed-course.ts --input data/course.json --force  # overwrite existing
```

### Seed Tournament
```bash
npx ts-node seed-tournament.ts --input data/tournament.json
npx ts-node seed-tournament.ts --input data/tournament.json --force  # overwrite existing
```

### Seed Round
```bash
npx ts-node seed-round.ts --input data/round.json
npx ts-node seed-round.ts --input data/round.json --force  # overwrite existing
```

**Skins Game Configuration**: Rounds can include optional `skinsGrossPot` and `skinsNetPot` fields to enable skins games. Only available for `singles` and `twoManBestBall` formats. If either pot value is > 0, that skins game will be active for the round and accessible via a "Skins" link on the Round page.

Example:
```json
{
  "format": "singles",
  "skinsGrossPot": 240,
  "skinsNetPot": 240
}
```

### Seed Match
```bash
npx ts-node seed-match.ts --input data/match-singles.json
npx ts-node seed-match.ts --input data/match-twoManBestBall.json
npx ts-node seed-match.ts --input data/match-twoManShamble.json
npx ts-node seed-match.ts --input data/match-twoManScramble.json
```

**Tee Time Field**: Matches can include an optional `teeTime` field (Firestore Timestamp) that displays on the Round page for matches that haven't started. Example format in JSON:
```json
{
  "teeTime": { "_seconds": 1733666400, "_nanoseconds": 0 }
}
```
This will display as "Match X" with the formatted time (e.g., "9:10am") on the Round page match card.

### Seed Handicaps
Update tournament player handicaps from a JSON file. Accepts either an object map (`{ "playerId": handicap }`),
an array (`[{ "playerId": "p1", "handicap": 12.3 }, ...]`), or a JSON that includes `tournamentId` and
`handicapByPlayer`.

Examples:

Object map (recommended):
```json
{
   "pShanePeterson": 7.0,
   "pJohnSmith": 9.8
}
```

Array form:
```json
[
   { "playerId": "pShanePeterson", "handicap": 7.0 },
   { "playerId": "pJohnSmith", "handicap": 9.8 }
]
```

Run the seed script (either include `tournamentId` inside the JSON or pass `--tournament`):
```bash
npx ts-node seed-handicaps.ts --input data/update-handicaps.json --tournament 2025-rowdycup
```

Notes:
- The script uses `service-account.json` in the repo root if present (same as other seed scripts).
- It will detect whether each player belongs to `teamA` or `teamB` and write to
   `teamA.handicapByPlayer.<playerId>` or `teamB.handicapByPlayer.<playerId>`.
- The script validates numeric handicaps and will skip unknown player IDs (it reports skipped entries).

## Temporary Public Match Editing (developer testing)

You can temporarily allow any client (anonymous or signed-in) to update `matches/{matchId}` for a specific
tournament by toggling a flag on the tournament document. This is useful for UI testing when you want to
open match editing to testers without requiring their auth to be linked to a player.

How it works
- An addition was made to `firestore.rules` to allow `update` on `matches/{matchId}` when:
   - the requesting user is an authenticated, rostered player (unchanged behavior), OR
   - the tournament document at `tournaments/{tournamentId}` has `openPublicEdits == true`.

Steps to enable temporary public editing
1. Deploy the updated security rules (rules are included in the repo):

```bash
firebase deploy --only firestore:rules
```

2. Turn on public edits for a tournament (example using `firebase-tools`):

Run these commands from the repository root (project root) — that is, one level up from this `scripts/` folder.

```bash
# set the flag to true
firebase firestore:update tournaments/2025ChristmasClassic --data '{"openPublicEdits": true}'

# when you're finished, turn it off
firebase firestore:update tournaments/2025ChristmasClassic --data '{"openPublicEdits": false}'
```

Notes & safety
- This toggle is intentionally simple so you can flip it on/off directly on the tournament document.
- While `openPublicEdits` is `true`, any client can update matches for that tournament — use only for
   short-term testing in development or controlled QA sessions.
- After testing, set `openPublicEdits` back to `false` immediately.
- Changes made while the flag is enabled are normal Firestore writes and will trigger any Cloud Functions
   that respond to match updates (e.g., computing match status/results). Audit changes if needed.

If you'd like, I can add a short script to flip the flag from the command line (one-liner using
`firebase firestore:update`) or add a note in your deployment checklist.


## Auth Scripts

### Link Single Auth User to Player

Links a Firebase Auth user (by email) to a player doc (by player ID). Run this after creating an auth account for a player.

```bash
npx ts-node link-auth-to-player.ts --email=player@email.com --playerId=pPlayerId
```

Example:
```bash
npx ts-node link-auth-to-player.ts --email=shanepeterson32@gmail.com --playerId=pShanePeterson
```

### Bulk Link Auth Users to Players

Links multiple Firebase Auth users to player docs at once.

1. Edit `data/player-emails.json` with real email addresses:
   ```json
   [
     { "email": "adam@email.com", "playerId": "pAdamReinwasser" },
     { "email": "dan@email.com", "playerId": "pDanCassady" },
     ...
   ]
   ```

2. Create auth accounts in Firebase Console (Authentication → Add user) for each email

3. Run the bulk link script:
   ```bash
   npx ts-node bulk-link-auth.ts --input=data/player-emails.json
   ```

The script will:
- Skip any placeholder emails (containing `@email.com`)
- Report which players were linked successfully
- Report which failed (auth account doesn't exist yet)

## Player Auth Workflow

1. **Collect emails** from all players
2. **Create auth accounts** in Firebase Console with a temporary password (e.g., "Rowdy2025!")
3. **Run link script** to connect auth accounts to player docs
4. **Tell players** to:
   - Go to the app → Login
   - Click "Forgot password?"
   - Enter their email
   - Check email for reset link
   - Set their own password

## Templates

Template files are in `data/template-txts/` for reference. Copy and modify for actual data.
