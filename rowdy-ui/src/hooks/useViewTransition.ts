import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Hook to track navigation direction for CSS View Transitions.
 * Sets a data attribute on the document element to control transition direction.
 */
export function useViewTransitionDirection() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const historyStack = useRef<string[]>([]);
  
  useEffect(() => {
    const currentPath = location.pathname + location.search;
    let direction: "forward" | "back" = "forward";
    
    if (navigationType === "POP") {
      const previousIndex = historyStack.current.lastIndexOf(currentPath);
      if (previousIndex !== -1 && previousIndex < historyStack.current.length - 1) {
        direction = "back";
        historyStack.current = historyStack.current.slice(0, previousIndex + 1);
      } else {
        historyStack.current.push(currentPath);
      }
    } else {
      historyStack.current.push(currentPath);
      if (historyStack.current.length > 50) {
        historyStack.current = historyStack.current.slice(-25);
      }
    }
    
    // Set direction on document for CSS to read
    document.documentElement.dataset.navDirection = direction;
  }, [location, navigationType]);
}

/**
 * Check if View Transitions API is supported
 */
export function supportsViewTransitions(): boolean {
  return typeof document !== "undefined" && "startViewTransition" in document;
}

/**
 * Wrapper to start a view transition if supported
 */
export function startViewTransition(callback: () => void | Promise<void>): void {
  if (supportsViewTransitions() && (document as any).startViewTransition) {
    (document as any).startViewTransition(callback);
  } else {
    callback();
  }
}

/** Minimal typing for the View Transitions API (not yet in the TS DOM lib). */
interface DomViewTransition {
  ready: Promise<void>;
  finished: Promise<void>;
}
type StartViewTransitionFn = (callback: () => void) => DomViewTransition;

/**
 * Start a view transition without ever letting the animation layer swallow the
 * navigation. Returns the transition (so callers can hook `ready`/`finished`,
 * e.g. for scroll), or `null` when unsupported or the API throws — in which case
 * `callback` has already run. `ready`/`finished` reject when a transition is
 * skipped (the route suspended, or the DOM didn't change) — common on iOS — so
 * we pre-attach a catch to avoid unhandled-rejection noise.
 */
export function startViewTransitionSafe(callback: () => void): DomViewTransition | null {
  const start = (document as unknown as { startViewTransition?: StartViewTransitionFn }).startViewTransition;
  if (!supportsViewTransitions() || typeof start !== "function") {
    callback();
    return null;
  }
  try {
    const transition = start.call(document, callback);
    transition.ready?.catch?.(() => {});
    transition.finished?.catch?.(() => {});
    return transition;
  } catch {
    // The API threw synchronously — never let that swallow the navigation.
    callback();
    return null;
  }
}

