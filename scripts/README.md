LAST UPDATED ON FRI JUN 12, 2026

# Rowdy Cup Scripts

Scripts for seeding and managing Firestore data for the Rowdy Cup PWA.

> **⚠️ Emergency backup only.** Routine admin work now lives in the in-app
> Admin UI (`/admin` — tournaments, rounds, matches, players, courses, auth
> linking, handicaps). These scripts bypass the admin checks and rate limits
> in the callables and write straight to Firestore with the service account,
> so reserve them for break-glass situations (e.g. auth is down mid-tournament)
> or bulk seeding the in-app UI can't do yet. The read-only `check-*` scripts
> remain fine for diagnostics any time.

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

## Match Editing During Testing

Keep `openPublicEdits` false on every production tournament, including test tournaments.
On November 11, 2026, it was disabled for `_TestRowdyCup2026` and verified disabled
across all nine production tournaments. The test-auth setup script preserves this setting.

For production scoring checks, use a signed-in player listed in the match's
`authorizedUids`, with the match unlocked. Use the Firestore emulator for tests
that need synthetic identities or unauthenticated write attempts.

The legacy public-edit toggle still exists in the admin UI and rules. Setting it
true bypasses authentication entirely for unlocked matches in that tournament;
it does not limit access to signed-in testers. Such writes also run production
scoring and other triggers. Do not re-enable it for routine QA.

## Auth Scripts

Production account creation is administrator-only. Firebase Authentication has
`client.permissions.disabledUserSignup: true` (verified November 11, 2026), so
public email/password and anonymous `accounts:signUp` requests are rejected.
Existing players can still sign in. Create new accounts through Firebase Console
or the Admin SDK; do not re-enable public registration to run legacy test-seeding
scripts that call the public sign-up API. This setting lives in Firebase project
configuration, not in the hosting bundle or Firestore rules.

Account-linking scripts keep only `authUid` on the public player document.
Email is merged into `players/{playerId}/private/profile`, alongside any existing
scouting notes. The private email write and removal of a legacy public `email`
field commit atomically. The single-player, bulk-link, and legacy test-auth setup
scripts all use this separation; do not put email or scouting notes in public
player documents or import them from an old snapshot.

### Link Single Auth User to Player

Links a Firebase Auth user (by email) to a player doc (by player ID). Run this after creating an auth account for a player.

```bash
npx ts-node link-auth-to-player.ts --email=player@email.com --playerId=pPlayerId
```

Example:
```bash
npx ts-node link-auth-to-player.ts --email=jane.doe@example.com --playerId=pJaneDoe
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

### Player Privacy Regression Tests

From the repository root, with Java 21 and the Firebase CLI available:

```bash
npm --prefix scripts ci
firebase emulators:exec --only firestore --project demo-rowdy-pii "npm --prefix scripts run test:pii"
```

These tests execute all three linking workflows against a local Firestore
emulator with synthetic data. Authentication and credential loading are stubbed;
the tests require a loopback emulator address and use only `demo-rowdy-pii`.
They verify private email storage, removal of legacy public emails, preservation
of scouting notes, repeat linking, and failure without a partial profile update.

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
