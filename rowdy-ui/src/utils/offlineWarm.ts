import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "../firebase";

export interface WarmMatchArgs {
  matchId: string;
  roundId?: string;
  courseId?: string;
  tournamentId?: string;
  /** Roster player IDs to pre-cache. */
  playerIds: string[];
  /** Team/tournament logo URLs to pull through the SW image cache (best-effort). */
  imageUrls?: string[];
}

/**
 * Force-fetch a match and its scoring context straight from the server so
 * Firestore's persistent cache is warm for offline scoring. After this resolves
 * the player can lose signal and still load and score the match. Rejects if the
 * server can't be reached (caller decides whether that's fatal or best-effort).
 *
 * Shared by the manual "Prepare for offline" checklist and the silent auto-warm
 * that runs when a rostered player opens their match while online.
 */
export async function warmMatchForOffline({
  matchId,
  roundId,
  courseId,
  tournamentId,
  playerIds,
  imageUrls,
}: WarmMatchArgs): Promise<void> {
  await getDocFromServer(doc(db, "matches", matchId));
  if (roundId) await getDocFromServer(doc(db, "rounds", roundId));
  if (courseId) await getDocFromServer(doc(db, "courses", courseId));
  if (tournamentId) await getDocFromServer(doc(db, "tournaments", tournamentId));
  await Promise.all(playerIds.map((id) => getDocFromServer(doc(db, "players", id))));
  // Pull logos through the SW's image cache — best-effort, so a missing logo
  // degrades to the emoji fallback offline rather than failing the warm.
  (imageUrls ?? []).filter(Boolean).forEach((url) => {
    const img = new Image();
    img.src = url;
  });
}
