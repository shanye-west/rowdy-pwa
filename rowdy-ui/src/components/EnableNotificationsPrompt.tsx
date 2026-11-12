/**
 * One-time-ish "turn on notifications?" popup for the INSTALLED app.
 *
 * Shown only where enabling can actually succeed from a single tap: running from
 * the Home Screen (iOS requires it; on Android it's where players live), push
 * supported, a signed-in roster player, push not already on, and the OS
 * permission not hard-blocked (a blocked permission can't be re-prompted, so the
 * popup would be a dead end). It stays out of the way of scoring.
 *
 * "Not now" (or dismissing) snoozes it for a week. Turning notifications off
 * from the menu/settings is an explicit "no" and silences it until the player
 * turns them back on themselves (see usePushNotifications).
 */

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bell } from "lucide-react";
import { Modal } from "./Modal";
import { useAuth } from "../contexts/AuthContext";
import { usePushNotifications, hasOptedOutOfPushPrompt } from "../hooks/usePushNotifications";
import { isStandalone, pushSupport } from "../messaging";

const SNOOZE_KEY = "rowdy:push-prompt-snoozed-until";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
/** Let the first screen settle before interrupting. */
const SHOW_DELAY_MS = 2500;

function isSnoozed(): boolean {
  try {
    return Date.now() < (Number(localStorage.getItem(SNOOZE_KEY)) || 0);
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* storage unavailable — it will simply ask again next launch */
  }
}

export function EnableNotificationsPrompt() {
  const { player, loading } = useAuth();
  const { pushOn, busy, enable } = usePushNotifications();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  // Ask at most once per app session, whatever the answer.
  const [asked, setAsked] = useState(false);

  // Never interrupt a scorecard.
  const onScorecard = pathname.startsWith("/match/");
  const eligible =
    !loading &&
    !!player &&
    !pushOn &&
    !busy &&
    !asked &&
    !onScorecard &&
    isStandalone() &&
    pushSupport() === "ok" &&
    Notification.permission !== "denied" &&
    !hasOptedOutOfPushPrompt() &&
    !isSnoozed();

  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => {
      setAsked(true);
      setOpen(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eligible]);

  const dismiss = () => {
    if (!open) return;
    snooze();
    setOpen(false);
  };

  const accept = () => {
    // Start enabling synchronously inside the tap: iOS only shows the system
    // permission sheet while the user activation from this tap is still live.
    void enable();
    setOpen(false);
  };

  return (
    <Modal isOpen={open} onClose={dismiss} ariaLabel="Turn on notifications">
      <div className="flex flex-col items-center text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bell className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold">Turn on notifications?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Get an alert for match results, chat messages, and bets. You can pick which ones in Settings anytime.
        </p>
        <div className="mt-5 flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={accept}
            className="w-full rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition-transform active:scale-95"
          >
            Yes, turn on
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="w-full rounded-lg px-4 py-3 text-base font-medium text-muted-foreground transition-transform active:scale-95"
          >
            Not now
          </button>
        </div>
      </div>
    </Modal>
  );
}
