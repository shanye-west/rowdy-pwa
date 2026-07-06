import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, Loader2, Circle } from "lucide-react";
import { Modal } from "./Modal";
import { warmMatchForOffline } from "../utils/offlineWarm";

type StepState = "pending" | "running" | "ok" | "fail";

interface StepInfo {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
}

interface OfflineReadyCheckProps {
  open: boolean;
  onClose: () => void;
  /** Whether the current user is allowed to enter this match's scores. */
  canEdit: boolean;
  /** Display name for the signed-in player (used in confirmation copy). */
  playerName?: string | null;
  /** IDs used to warm the persistent cache from the server. */
  matchId: string;
  roundId?: string;
  courseId?: string;
  tournamentId?: string;
  /** Roster player IDs to pre-cache. Memoize in the parent to avoid reruns. */
  playerIds: string[];
  /**
   * Image URLs (team/tournament logos) to pull through the service worker's
   * runtime cache so they render offline too. Best-effort — a failed image
   * never fails the check. Memoize in the parent.
   */
  imageUrls?: string[];
}

const STEP_DEFS = [
  { key: "auth", label: "Signed in to score" },
  { key: "online", label: "Connected right now" },
  { key: "warm", label: "Match data saved for offline" },
] as const;

const makeInitial = (): StepInfo[] =>
  STEP_DEFS.map((s) => ({ key: s.key, label: s.label, state: "pending" }));

function StepIcon({ state }: { state: StepState }) {
  if (state === "ok") return <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />;
  if (state === "fail") return <XCircle className="h-5 w-5 shrink-0 text-red-600" />;
  if (state === "running") return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />;
  return <Circle className="h-5 w-5 shrink-0 text-slate-300" />;
}

/**
 * Pre-round "get ready for offline" checklist.
 *
 * Run while still on wi-fi/cell, it (1) confirms the player is signed in and
 * rostered, (2) confirms there's a live connection, and (3) force-fetches the
 * match, round, course, and roster from the *server* so Firestore's persistent
 * cache is warm. After that the player can lose signal and still load and score
 * the match. This directly addresses arriving at a no-signal course with nothing
 * cached (and Firebase auth being unable to initialize offline).
 */
export function OfflineReadyCheck({
  open,
  onClose,
  canEdit,
  playerName,
  matchId,
  roundId,
  courseId,
  tournamentId,
  playerIds,
  imageUrls,
}: OfflineReadyCheckProps) {
  const [steps, setSteps] = useState<StepInfo[]>(makeInitial);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [allOk, setAllOk] = useState(false);
  // Guards against a stale run (re-open / prop change) clobbering newer state.
  const runTokenRef = useRef(0);

  const run = useCallback(async () => {
    const token = ++runTokenRef.current;
    setRunning(true);
    setFinished(false);
    setAllOk(false);

    let current = makeInitial();
    setSteps(current);

    const set = (key: string, patch: Partial<StepInfo>) => {
      if (runTokenRef.current !== token) return;
      current = current.map((s) => (s.key === key ? { ...s, ...patch } : s));
      setSteps(current);
    };
    const finish = (ok: boolean) => {
      if (runTokenRef.current !== token) return;
      setAllOk(ok);
      setFinished(true);
      setRunning(false);
    };

    // 1. Allowed to score (logged in + rostered, or public edits enabled)
    set("auth", { state: "running" });
    if (!canEdit) {
      set("auth", { state: "fail", detail: "Log in as a rostered player before your round so you can score offline." });
      return finish(false);
    }
    set("auth", { state: "ok", detail: playerName ? `Signed in as ${playerName}` : "Public scoring enabled" });

    // 2. Online right now (needed to actually fetch fresh data)
    set("online", { state: "running" });
    const online = typeof navigator === "undefined" || navigator.onLine;
    if (!online) {
      set("online", { state: "fail", detail: "Connect to wi-fi or cell, then run this again." });
      return finish(false);
    }
    set("online", { state: "ok" });

    // 3. Warm the persistent cache straight from the server
    set("warm", { state: "running" });
    try {
      await warmMatchForOffline({ matchId, roundId, courseId, tournamentId, playerIds, imageUrls });
      set("warm", { state: "ok", detail: "Scorecard, players & course cached on this device." });
      finish(true);
    } catch {
      set("warm", { state: "fail", detail: "Couldn't reach the server. Check your connection and retry." });
      finish(false);
    }
  }, [canEdit, playerName, matchId, roundId, courseId, tournamentId, playerIds, imageUrls]);

  // Auto-run whenever the dialog opens. Deferred a tick so we kick off the
  // checks after the dialog has committed open (and to avoid setState directly
  // in the effect body).
  useEffect(() => {
    if (!open) {
      runTokenRef.current++; // invalidate any in-flight run when closed
      return;
    }
    const id = window.setTimeout(() => void run(), 0);
    return () => window.clearTimeout(id);
  }, [open, run]);

  return (
    <Modal isOpen={open} onClose={onClose} title="Prepare for offline" ariaLabel="Prepare for offline">
      <p className="mb-4 text-center text-sm text-muted-foreground">
        Run this on wi-fi or cell before your round so you can keep scoring even
        if you lose signal on the course.
      </p>

      <ul className="mb-4 space-y-3">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-3">
            <StepIcon state={s.state} />
            <div className="min-w-0">
              <div
                className={`text-sm font-medium ${
                  s.state === "fail"
                    ? "text-red-700"
                    : s.state === "ok"
                      ? "text-foreground"
                      : "text-muted-foreground"
                }`}
              >
                {s.label}
              </div>
              {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
            </div>
          </li>
        ))}
      </ul>

      {finished && allOk && (
        <div className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-center text-sm font-semibold text-green-800">
          ✓ You're ready to score offline
        </div>
      )}
      {finished && !allOk && (
        <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm font-medium text-amber-800">
          Not ready yet — fix the item above and retry.
        </div>
      )}

      <div className="flex gap-3">
        {finished && !allOk && (
          <button
            type="button"
            onClick={() => void run()}
            className="flex-1 rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white transition-transform active:scale-95 hover:bg-slate-800"
          >
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={running}
          className="flex-1 rounded-lg bg-muted px-4 py-3 text-base font-semibold text-foreground transition-transform active:scale-95 hover:bg-muted disabled:opacity-60"
        >
          {running ? "Checking…" : allOk ? "Done" : "Close"}
        </button>
      </div>
    </Modal>
  );
}

export default OfflineReadyCheck;
