# Scoring Leaders Implementation

## Overview
Added comprehensive scoring leaders to Round Recap showing gross and net scoring relative to par, with per-18 normalization for fair ranking of incomplete rounds.

## Features

### Format-Specific Leader Lists
- **Singles**: Individual gross + individual net
- **Two-Man Best Ball**: Individual gross + individual net + team net
- **Two-Man Shamble/Scramble**: Team gross only

### Per-18 Normalization
- Players with incomplete rounds are ranked fairly using: `(strokesVsPar * 18) / holesCompleted`
- Display shows actual score with holes completed notation: "+10 (16)"
- Per-18 value shown as secondary info: "(+11.3 per 18)"

## Implementation

### Backend (Cloud Functions)

#### Type Definitions (`functions/src/types.ts`)
```typescript
export interface ScoringLeader {
  playerId: string;
  playerName: string;
  strokesVsPar: number;
  holesCompleted: number;
  strokesVsParPer18: number;
  teamKey?: string;
}

export interface RoundRecapDoc {
  // ... existing fields
  leaders: {
    // ... existing fields
    scoringGross?: ScoringLeader[];
    scoringNet?: ScoringLeader[];
    scoringTeamGross?: ScoringLeader[];
    scoringTeamNet?: ScoringLeader[];
  };
}
```

#### Computation Logic (`functions/src/index.ts`)
Added to `computeRoundRecap` function (after birdie/eagle leaders):

1. **Individual Scoring (Singles & Best Ball)**
   - Recompute vs-par from the fact's `holePerformance` via `parForPlayerHolesPlayed`
     (`functions/src/helpers/parPlayed.ts`), against the round's authoritative
     `holePars`. Do NOT measure against the full 18-hole course par — matches close
     early (5&4 = 14 holes), and a partial gross vs. a full par reads far too low.
   - Take `holesPlayed` from the fact; it always agrees with the helper's par subset
   - Calculate per-18 normalized score: `(strokesVsPar * 18) / holesPlayed`
   - Sort by normalized score (ascending, lower is better)
   - Create separate arrays for gross and net

2. **Team Net (Best Ball only)**
   - Group players by team using sorted player IDs as team key
   - Compute team net by summing hole-by-hole best net scores across all 18 holes
   - Calculate per-18 normalized score
   - Sort by normalized score

3. **Team Gross (Shamble & Scramble)**
   - Group players by team
   - Recompute vs-par from `teamTotalGross` and `parForTeamHolesPlayed`
     (`functions/src/helpers/parPlayed.ts`) — format-aware, because shamble stores
     each player's individual gross plus `partnerGross` (only scramble stores a team
     gross), so the team played a hole if EITHER partner has a ball. Gating on
     `gross` alone makes the two partners' facts disagree about their own team.
   - Calculate per-18 normalized score
   - Sort by normalized score

### Frontend (UI)

#### Type Definitions (`rowdy-ui/src/types.ts`)
- Mirrored backend `ScoringLeader` interface
- Updated `RoundRecapDoc` interface

#### UI Component (`rowdy-ui/src/routes/RoundRecap.tsx`)

1. **New View Tab**
   - Added "Scoring Leaders" tab between "vs All" and "Scoring Summary"
   - State: `scoringLeaderTab` for switching between gross/net/teamGross/teamNet

2. **Dynamic Tab Display**
   - Only show tabs for available data (format-specific)
   - Auto-select first available tab on load

3. **Leader Display**
   - Rank badge (1, 2, 3...)
   - Player/team name (stacked for teams)
   - Primary score display (large, color-coded: green if ≤0, red if >0)
   - Secondary info: holes completed and per-18 score (if incomplete)
   - Format: "+10" or "+10 (16)" with "(+11.3 per 18)" below

## Data Flow

1. Admin calls `computeRoundRecap` cloud function
2. Function fetches all `playerMatchFacts` for the round
3. Extracts scoring data based on format:
   - Singles/BestBall: individual `strokesVsParGross`, `strokesVsParNet`
   - BestBall: compute team net from hole-by-hole best scores
   - Shamble/Scramble: use `teamStrokesVsParGross`
4. Calculates per-18 normalized scores for ranking
5. Stores in `roundRecaps/{roundId}.leaders.scoring*` arrays
6. UI fetches recap document and displays appropriate leader lists

## Example Calculations

### Incomplete Round Example
- Player 1: +10 thru 16 holes
- Per-18 calculation: `(10 * 18) / 16 = 11.25`
- Display: "+10 (16)" with "(+11.3 per 18)" secondary
- Used for ranking: 11.25

### Team Net (Best Ball)
- Hole 1: Player A net 4, Player B net 5 → Team net vs par: -1 (par 5)
- Hole 2: Player A net 3, Player B net 4 → Team net vs par: -1 (par 4)
- Sum all 18 holes for team net total vs par
- Apply per-18 normalization if incomplete

## Testing Checklist

- [ ] Singles round: Individual gross and net leaders display correctly
- [ ] Best Ball round: Individual gross, individual net, and team net all display
- [ ] Shamble round: Only team gross displays
- [ ] Scramble round: Only team gross displays
- [ ] Incomplete rounds: Per-18 normalization ranks fairly
- [ ] Display format: "+10 (16)" shows for incomplete rounds
- [ ] Tab auto-selection: First available tab selected on load
- [ ] No data: Empty states show when no scoring data exists

## Deployment

1. Build functions: `cd functions && npm run build`
2. Deploy functions: `firebase deploy --only functions:computeRoundRecap`
3. Rebuild existing recaps (if needed): Call `computeRoundRecap` for each round
4. Build UI: `cd rowdy-ui && npm run build`
5. Deploy hosting: `firebase deploy --only hosting`

## Notes

- Per-18 normalization only used for sorting; actual scores always displayed
- Team keys use sorted player IDs joined by underscore: "player1_player2"
- Best Ball team net computed from hole-by-hole best net (not from individual totals)
- Empty arrays or undefined fields handled gracefully in UI
