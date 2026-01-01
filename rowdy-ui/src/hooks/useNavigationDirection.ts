import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Hook to track navigation direction for page transitions.
 * Returns "forward" for push navigation, "back" for pop navigation.
 * 
 * Uses a combination of:
 * 1. React Router's navigationType (POP = back button)
 * 2. History stack depth tracking
 */
export function useNavigationDirection() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const historyStack = useRef<string[]>([]);
  
  useEffect(() => {
    const currentPath = location.pathname + location.search;
    
    // POP type means browser back/forward button was used
    if (navigationType === "POP") {
      // Check if we're going to a page that was earlier in our stack
      const previousIndex = historyStack.current.lastIndexOf(currentPath);
      if (previousIndex !== -1 && previousIndex < historyStack.current.length - 1) {
        // We're going back to an earlier page
        setDirection("back");
        // Trim the stack to the current position
        historyStack.current = historyStack.current.slice(0, previousIndex + 1);
      } else {
        // Forward through history (rare case)
        setDirection("forward");
        historyStack.current.push(currentPath);
      }
    } else {
      // PUSH or REPLACE - this is forward navigation
      setDirection("forward");
      historyStack.current.push(currentPath);
      
      // Limit stack size to prevent memory issues
      if (historyStack.current.length > 50) {
        historyStack.current = historyStack.current.slice(-25);
      }
    }
  }, [location, navigationType]);
  
  return direction;
}

/** Page transition variants for smooth sliding animations */
export const pageTransitionVariants = {
  initial: (direction: "forward" | "back") => ({
    x: direction === "forward" ? "100%" : "-100%",
    opacity: 0,
  }),
  animate: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: "forward" | "back") => ({
    x: direction === "forward" ? "-100%" : "100%",
    opacity: 0,
  }),
};

export const pageTransitionConfig = {
  type: "tween" as const,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number], // Cubic bezier for smooth ease-out
  duration: 0.55, // Slower, smoother transition
};
