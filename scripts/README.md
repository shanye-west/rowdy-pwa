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

### Seed Match
```bash
npx ts-node seed-match.ts --input data/match-singles.json
npx ts-node seed-match.ts --input data/match-twoManBestBall.json
npx ts-node seed-match.ts --input data/match-twoManShamble.json
npx ts-node seed-match.ts --input data/match-twoManScramble.json
```

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
