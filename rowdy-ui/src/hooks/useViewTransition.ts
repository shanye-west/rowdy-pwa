import { useCallback, useEffect, useRef } from "react";
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
  if (supportsViewTransitions()) {
    (document as any).startViewTransition(callback);
  } else {
    callback();
  }
}

/**
 * Custom hook that provides a navigate function with view transitions
 */
export function useViewTransitionNavigate() {
  const navigate = useCallback((to: string | number) => {
    // We don't need to wrap navigate here - the router handles it
    // View Transitions are applied via CSS based on same-document navigation
    if (typeof to === "number") {
      window.history.go(to);
    }
    // Let React Router handle navigation normally for strings
  }, []);
  
  return navigate;
}
