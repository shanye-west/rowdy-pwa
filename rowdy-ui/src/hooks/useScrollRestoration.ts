import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Persist scroll position per history entry (location.key) for the session.
const positions = new Map<string, number>();

/**
 * Window scroll behavior for client navigation:
 * - PUSH / REPLACE (a new page): scroll to top.
 * - POP (back / forward): restore the saved position, retrying once after async
 *   Firestore-driven lists have had a chance to grow past first paint.
 *
 * Replaces the unconditional `scrollTo(0, 0)` that used to live in LayoutShell.
 */
export function useScrollRestoration() {
  const location = useLocation();
  const navType = useNavigationType(); // "POP" | "PUSH" | "REPLACE"

  // Continuously record the scroll position for the current history entry, and
  // capture a final value when leaving it.
  useEffect(() => {
    const key = location.key;
    const save = () => positions.set(key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      save();
      window.removeEventListener("scroll", save);
    };
  }, [location.key]);

  // Apply the right scroll position whenever the entry changes.
  useEffect(() => {
    if (navType === "POP") {
      const saved = positions.get(location.key) ?? 0;
      const restore = () => window.scrollTo({ top: saved, left: 0 });
      const raf = requestAnimationFrame(restore);
      const timer = setTimeout(restore, 150);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
    window.scrollTo({ top: 0, left: 0 });
  }, [location.key, navType]);
}
