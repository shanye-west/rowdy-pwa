/**
 * Remembers which pages last rendered in the Christmas Classic theme, so a
 * reload paints the right colours from the first frame instead of flashing the
 * default navy until the tournament arrives from Firestore.
 *
 * Read twice: by the inline script in index.html (before any JS bundle runs —
 * keep the KEY and the stored shape in sync with it) and by Layout's theme
 * effect while a page's `series` is still unknown (loading).
 *
 * Shape: { [pathname]: 1 } — only Christmas paths are stored; absence = default.
 */
export const THEME_HINT_KEY = "rowdy:christmasPaths";
const MAX_PATHS = 100;

function read(): Record<string, 1> {
  try {
    const raw = localStorage.getItem(THEME_HINT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function isChristmasPath(pathname: string): boolean {
  return read()[pathname] === 1;
}

export function rememberPathTheme(pathname: string, isChristmas: boolean): void {
  const map = read();
  if ((map[pathname] === 1) === isChristmas) return;
  if (isChristmas) {
    map[pathname] = 1;
    // Insertion order = age; drop the oldest past the cap.
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length - MAX_PATHS; i++) delete map[keys[i]];
  } else {
    delete map[pathname];
  }
  try {
    localStorage.setItem(THEME_HINT_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — the hint is only a nicety */
  }
}
