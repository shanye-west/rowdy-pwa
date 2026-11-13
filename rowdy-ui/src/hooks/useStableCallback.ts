import { useCallback, useEffect, useRef } from "react";

/**
 * Wrap a handler so its identity never changes while it always runs the latest
 * version (the "latest ref" pattern).
 *
 * Use for event handlers handed to memoized children: a handler that closes
 * over fast-changing state (e.g. the scorecard's `holes`) would otherwise get a
 * new identity on every change and defeat every child's `memo`.
 *
 * The ref is refreshed after each commit, so the returned function must only be
 * called from events/effects — never during render.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

export default useStableCallback;
