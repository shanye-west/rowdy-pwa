/**
 * Narrow Admin-SDK reader for the MCP layer.
 *
 * The rest of the MCP reads via the *unauthenticated* Web SDK (see firestore.ts),
 * which is rules-enforced and physically cannot write. The one exception is a
 * player's `scoutingNotes`: that candid free-text moved to the server-only
 * players/{id}/private/profile subcollection (so it is NOT world-readable), which
 * the anonymous Web SDK can no longer read. The MCP is the AI's data source for
 * draft/pairing help and is already gated by the shared ROWDY_MCP_KEY, so it
 * reads that single private field through the Admin SDK here.
 *
 * SCOPE GUARD: this module exposes READS ONLY. Never add a write helper here —
 * doing so would break the MCP's read-only guarantee. The Admin SDK default app
 * is already initialised by functions/src/index.ts (initializeApp()), which is
 * the entry module for the deployed `mcp` function.
 */
import { getFirestore } from "firebase-admin/firestore";

/** One player's private scouting note (server-only subcollection), or undefined. */
export async function getScoutingNotes(playerId: string): Promise<string | undefined> {
  const snap = await getFirestore()
    .collection("players")
    .doc(playerId)
    .collection("private")
    .doc("profile")
    .get();
  const notes = snap.exists ? (snap.data()?.scoutingNotes as string | undefined) : undefined;
  return notes || undefined;
}

/**
 * Private scouting notes for many players in one batched read, keyed by playerId.
 * Players without a note are simply absent from the map.
 */
export async function getScoutingNotesByIds(playerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (playerIds.length === 0) return out;
  const db = getFirestore();
  const refs = playerIds.map((id) =>
    db.collection("players").doc(id).collection("private").doc("profile")
  );
  const snaps = await db.getAll(...refs);
  snaps.forEach((snap, i) => {
    const notes = snap.exists ? (snap.data()?.scoutingNotes as string | undefined) : undefined;
    if (notes) out.set(playerIds[i], notes);
  });
  return out;
}
