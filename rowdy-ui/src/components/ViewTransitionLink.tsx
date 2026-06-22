import { Link, useNavigate, type LinkProps } from "react-router-dom";
import { forwardRef, type MouseEvent, type PointerEvent } from "react";
import { startViewTransitionSafe } from "../hooks/useViewTransition";
import { prefetchRoute } from "../utils/routePrefetch";

/**
 * Link component that wraps navigation in a View Transition, prefetches the
 * destination's lazy chunk on press, and never lets the animation layer swallow
 * the navigation itself.
 */
export const ViewTransitionLink = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ to, onClick, onPointerDown, ...props }, ref) => {
    const navigate = useNavigate();

    const href = typeof to === "string" ? to : to.pathname || "/";

    // Warm the route's chunk on press-down, before the click resolves — most
    // navigations then render instantly instead of suspending on the fetch.
    const handlePointerDown = (e: PointerEvent<HTMLAnchorElement>) => {
      onPointerDown?.(e);
      prefetchRoute(href);
    };

    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
      // Call original onClick if provided
      onClick?.(e);

      // If default prevented or modified click, let default behavior handle it
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) {
        return;
      }

      // Intercept and wrap in view transition
      e.preventDefault();

      // Capture current scroll position to maintain during the transition.
      const currentScrollY = window.scrollY;

      // startViewTransitionSafe runs navigate() even if the API is unsupported
      // or throws, so navigation can never be lost to the animation layer.
      const transition = startViewTransitionSafe(() => {
        navigate(href);
      });

      // Keep scroll position during the transition, then scroll to top after.
      // Both reject when a transition is skipped (e.g. the route suspended), so
      // swallow that — it isn't an error worth surfacing.
      transition?.ready.then(() => window.scrollTo(0, currentScrollY)).catch(() => {});
      transition?.finished.then(() => window.scrollTo(0, 0)).catch(() => {});
    };

    return <Link ref={ref} to={to} onClick={handleClick} onPointerDown={handlePointerDown} {...props} />;
  }
);

ViewTransitionLink.displayName = "ViewTransitionLink";
