# Rowdy Cup MCP server (read-only)

A remote [Model Context Protocol](https://modelcontextprotocol.io) endpoint that lets
players point their own AI assistant at Rowdy Cup data — players, stats, head-to-head
records, leaderboards, round recaps, and captain draft analysis.

- **Hosted** as the `mcp` Gen-2 Cloud Function in this Firebase project (no per-player
  install). The AI/LLM cost is on each player's own ChatGPT/Claude subscription.
- **Read-only by construction**: reads go through the *unauthenticated* Firebase Web
  SDK, and Firestore rules deny all client writes. The Admin SDK is never used here and
  no write tools exist. The endpoint physically cannot modify data.
- **Guarded by a shared key** (Functions secret `ROWDY_MCP_KEY`) to keep random traffic
  from running up invocations — the data itself is already public-read.

## URL

```
https://<region>-rowdy-pwa.cloudfunctions.net/mcp?key=YOUR_KEY
```

(Optionally front it with a Hosting rewrite for `https://app.rowdycup.com/mcp?key=...`.)

The key can also be sent as a header: `Authorization: Bearer YOUR_KEY`.

## Tools

| Tool | What it answers |
|------|-----------------|
| `search_players` | Find players by name; resolve to ids; show team/tier/handicap. |
| `get_player_stats` | A player's record, points, format breakdown, badges (all-time or per-tournament). |
| `get_player_match_history` | A player's recent matches (outcome, opponents, partners, birdies/eagles). |
| `get_head_to_head` | Record between any two players, overall and by format. |
| `get_leaderboard` | All-time (by series) or current-tournament standings. |
| `get_tournament` | Active tournament: teams, rosters, handicaps, captains, live cup score. |
| `get_draft_pool` | Pre-draft pool handicaps joined with all-time stats (captain analysis). |
| `get_round_recap` | Scoring leaders, per-hole averages, vs-all records for a round. |

## Adding it to an AI client

- **Claude.ai** → Settings → Connectors → *Add custom connector* → paste the URL.
  Requires a paid plan (Pro/Max/Team/Enterprise).
- **ChatGPT** → enable developer mode/connectors → add the MCP server URL.
  (ChatGPT is the finickier client; verify current requirements in its docs.)
- **Claude Code** →
  `claude mcp add --transport http rowdy-cup "https://.../mcp?key=YOUR_KEY"`

## Operating it

```bash
# Set / rotate the shared key
firebase functions:secrets:set ROWDY_MCP_KEY

# Deploy (additive; no rules or index changes needed)
cd functions && npm run build && firebase deploy --only functions
```

## Local testing

Run the emulator (the key check is bypassed only under the emulator) and point the MCP
Inspector at it:

```bash
cd functions && npm run serve            # emulator on :5001
npx @modelcontextprotocol/inspector       # then connect via Streamable HTTP to the local mcp URL
```
