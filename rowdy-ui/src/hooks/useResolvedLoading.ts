import { useEffect, useState } from "react";
import { LOAD_TIMEOUT_MS } from "../constants";

/**
 * Backstops an unbounded loading state so a page can never spin forever.
 *
 * Data hooks here flip `loading=false` only once every Firestore read resolves;
 * if the connection wedges after a (hard) reload, that never happens. This wraps
 * the raw flag: once we've waited `timeoutMs` AND already have something cached
 * to show (`hasData`), it stops blocking and lets the page render the
 * cached/partial data instead of spinning.
 *
 * When there's no data at all (brand-new user + dead network), it keeps the raw
 * loading state so the caller's LoadingScreen still surfaces its manual
 * Reload/Reset escape hatch — we never want to render a misleading empty page.
 */
export function useResolvedLoading(
  rawLoading: boolean,
  hasData: boolean,
  timeoutMs: number = LOAD_TIMEOUT_MS,
): boolean {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!rawLoading) {
      setExpired(false);
      return;
    }
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), timeoutMs);
    return () => clearTimeout(timer);
  }, [rawLoading, timeoutMs]);

  return rawLoading && !(expired && hasData);
}

export default useResolvedLoading;
