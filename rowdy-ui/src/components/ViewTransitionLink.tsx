import { Link, useNavigate, type LinkProps } from "react-router-dom";
import { forwardRef, type MouseEvent } from "react";
import { supportsViewTransitions } from "../hooks/useViewTransition";

/**
 * Link component that wraps navigation in a View Transition
 */
export const ViewTransitionLink = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ to, onClick, ...props }, ref) => {
    const navigate = useNavigate();

    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
      // Call original onClick if provided
      onClick?.(e);

      // If default prevented or modified click, let default behavior handle it
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) {
        return;
      }

      // Intercept and wrap in view transition
      e.preventDefault();

      const href = typeof to === "string" ? to : to.pathname || "/";

      if (supportsViewTransitions() && (document as any).startViewTransition) {
        // Capture current scroll position to maintain during transition
        const currentScrollY = window.scrollY;
        
        const transition = (document as any).startViewTransition(() => {
          navigate(href);
        });
        
        // Keep scroll position during transition, then scroll to top after
        transition.ready.then(() => {
          window.scrollTo(0, currentScrollY);
        });
        
        transition.finished.then(() => {
          window.scrollTo(0, 0);
        });
      } else {
        navigate(href);
      }
    };

    return <Link ref={ref} to={to} onClick={handleClick} {...props} />;
  }
);

ViewTransitionLink.displayName = "ViewTransitionLink";
