// Player headshots, bundled as static assets.
//
// Each file is named `{playerId}.webp` (e.g. `pAustinBrady.webp`). Vite emits
// them into the build with hashed filenames and the PWA service worker
// precaches them (see `workbox.globPatterns` in vite.config.ts), so headshots
// render offline. To add a player photo, drop a `{playerId}.webp` file in this
// folder — the map below picks it up automatically, no code change needed.
// `?no-inline` forces every headshot to emit as its own hashed asset file
// (rather than being base64-inlined into this shared chunk when small), so they
// cache individually and precache cleanly as image entries.
const modules = import.meta.glob<string>("./*.webp", {
  eager: true,
  import: "default",
  query: "?no-inline",
});

/** Map of playerId -> bundled headshot URL. */
export const playerPhotos: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([path, url]) => {
    // "./pAustinBrady.webp" -> "pAustinBrady"
    const playerId = path.replace(/^\.\//, "").replace(/\.webp$/, "");
    return [playerId, url];
  })
);

/** Resolve a player's headshot URL, or undefined if none is bundled. */
export function playerPhotoUrl(playerId?: string | null): string | undefined {
  if (!playerId) return undefined;
  return playerPhotos[playerId];
}
