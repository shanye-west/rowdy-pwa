/**
 * Theme preference engine for light / dark / system.
 *
 * The actual `.dark` class is first applied by a tiny inline script in
 * index.html (before paint, to avoid a flash); these helpers keep it in sync
 * afterwards and persist the user's choice. "system" follows the OS setting and
 * is the default when nothing is stored.
 */

export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "rowdy-theme";

/** Read the saved preference (defaults to "system" when unset/invalid). */
export function getThemePref(): ThemePref {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

/** Resolve a preference to a concrete dark/light boolean using the OS setting. */
export function resolveDark(pref: ThemePref): boolean {
  if (pref === "dark") return true;
  if (pref === "light") return false;
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Toggle the `.dark` class on <html> to match the given preference. */
export function applyTheme(pref: ThemePref): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveDark(pref));
}

/** Persist a preference ("system" clears storage) and apply it immediately. */
export function setThemePref(pref: ThemePref): void {
  if (typeof localStorage !== "undefined") {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  }
  applyTheme(pref);
}
