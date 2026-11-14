import React, { useEffect, useRef, useState } from "react";

interface PullToRefreshProps {
  children: React.ReactNode;
  /**
   * Runs when the user pulls past the threshold and lets go. The indicator
   * spins until it settles; if it reloads the page, it simply never settles.
   */
  onRefresh?: () => void | Promise<void>;
}

/** Pull distance (after resistance) that arms the refresh. */
const THRESHOLD = 72;
/** Furthest the content can be dragged. */
const MAX_PULL = 120;
/** Finger travel before deciding whether this is a pull or a sideways swipe. */
const DECIDE_PX = 8;
const SNAP_MS = 220;

type Phase = "idle" | "pulling" | "armed" | "refreshing";

/** Rubber-band resistance: 1:1 at first, flattening toward MAX_PULL. */
function resist(dy: number): number {
  return MAX_PULL * (1 - Math.exp(-dy / (MAX_PULL * 1.6)));
}

function pageScrollTop(): number {
  return document.scrollingElement?.scrollTop ?? window.scrollY;
}

/**
 * Whether a touch starting on `target` may begin a pull. Not when something
 * else owns the gesture: an open dialog/sheet or popover (e.g. the score
 * picker), an element that opted out, or an inner scroll area that is itself
 * scrolled down (pulling there should scroll it back up, not refresh).
 */
function canStartPull(target: EventTarget | null, root: HTMLElement): boolean {
  try {
    if (document.querySelector("dialog[open], [role='dialog'], [aria-modal='true'], :popover-open")) return false;
  } catch {
    /* :popover-open unsupported — the dialog checks above still ran */
    if (document.querySelector("dialog[open], [role='dialog'], [aria-modal='true']")) return false;
  }
  let el = target instanceof Element ? target : null;
  while (el && el !== root) {
    if (el instanceof HTMLElement) {
      if (el.dataset.noPullRefresh !== undefined) return false;
      if (el.scrollTop > 0) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === "auto" || oy === "scroll") return false;
      }
    }
    el = el.parentElement;
  }
  return true;
}

/**
 * Pull-to-refresh for the installed (standalone) PWA, where iOS offers no
 * native one.
 *
 * Built on native touch listeners rather than React's: React registers
 * touchmove as passive, so it could never preventDefault, and the browser's
 * own scroll / rubber-band fought the custom drag. The drag itself is applied
 * straight to the DOM per frame, so a pull doesn't re-render the page.
 *
 * The content wrapper has NO transform while idle. Any transform — even
 * translateY(0) — makes `position: fixed` descendants (e.g. the Rules Official
 * composer) position against the wrapper instead of the screen.
 */
export default function PullToRefresh({ children, onRefresh }: PullToRefreshProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  // Latest values for the native listeners (attached once).
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    const indicator = indicatorRef.current;
    if (!root || !content || !indicator) return;

    let tracking = false; // a touch began somewhere a pull is allowed
    let decided = false; // the gesture has been classified as a pull
    let startX = 0;
    let startY = 0;
    let dist = 0;
    let busy = false; // refreshing — ignore new gestures
    let frame = 0;
    let snapTimer = 0;
    let current: Phase = "idle";

    const setPhaseIfChanged = (next: Phase) => {
      if (next === current) return;
      if (next === "armed") navigator.vibrate?.(10);
      current = next;
      setPhase(next);
    };

    /** Paint the drag: content offset + indicator position, opacity, rotation. */
    const paint = (d: number, animate: boolean) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const transition = animate ? `transform ${SNAP_MS}ms ease-out, opacity ${SNAP_MS}ms ease-out` : "none";
        content.style.transition = transition;
        content.style.transform = d > 0 ? `translate3d(0, ${d}px, 0)` : "";
        indicator.style.transition = transition;
        indicator.style.opacity = String(Math.min(1, d / (THRESHOLD * 0.6)));
        indicator.style.transform = `translate3d(-50%, ${d - 44}px, 0) rotate(${Math.min(d, THRESHOLD) * 4}deg)`;
      });
    };

    /** Place the indicator just under the sticky header (whatever its height). */
    const placeIndicator = () => {
      const header = document.querySelector(".app-header");
      indicator.style.top = `${header ? header.getBoundingClientRect().bottom : 0}px`;
    };

    const reset = () => {
      paint(0, true);
      window.clearTimeout(snapTimer);
      // Drop the transform entirely once the snap-back has finished.
      snapTimer = window.setTimeout(() => {
        content.style.transition = "";
        content.style.transform = "";
      }, SNAP_MS + 20);
      setPhaseIfChanged("idle");
    };

    const onStart = (e: TouchEvent) => {
      tracking = false;
      decided = false;
      if (busy || e.touches.length !== 1) return;
      if (pageScrollTop() > 0) return;
      if (!canStartPull(e.target, root)) return;
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dist = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      if (!decided) {
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
        // Upward or mostly-sideways (e.g. scrolling the scorecard): not ours.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || pageScrollTop() > 0) {
          tracking = false;
          return;
        }
        decided = true;
        placeIndicator();
      }

      // We own this gesture now: stop the browser scrolling/bouncing the page.
      if (e.cancelable) e.preventDefault();
      dist = dy > 0 ? resist(dy) : 0;
      paint(dist, false);
      setPhaseIfChanged(dist >= THRESHOLD ? "armed" : "pulling");
    };

    const onEnd = async () => {
      if (!tracking) return;
      tracking = false;
      if (!decided) return;
      decided = false;

      if (dist < THRESHOLD) {
        reset();
        return;
      }

      busy = true;
      dist = THRESHOLD;
      paint(THRESHOLD, true);
      setPhaseIfChanged("refreshing");
      try {
        await onRefreshRef.current?.();
      } catch (err) {
        console.error("Refresh failed:", err);
      } finally {
        busy = false;
        reset();
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      cancelAnimationFrame(frame);
      window.clearTimeout(snapTimer);
    };
  }, []);

  const armed = phase === "armed" || phase === "refreshing";

  return (
    <div ref={rootRef} style={{ minHeight: "100vh" }}>
      {/* Indicator: a small round chip that slides out from under the header.
          Sits below the header (z-50) and above the page content. */}
      <div
        ref={indicatorRef}
        role="status"
        aria-live="polite"
        aria-label={phase === "refreshing" ? "Refreshing" : undefined}
        className="pointer-events-none fixed left-1/2 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-md"
        style={{ top: 0, opacity: 0, transform: "translate3d(-50%, -44px, 0)" }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={phase === "refreshing" ? "animate-spin motion-reduce:animate-none" : undefined}
          style={{ color: armed ? "var(--brand-primary)" : "#94a3b8", transition: "color 0.15s" }}
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </div>

      <div ref={contentRef}>{children}</div>
    </div>
  );
}
