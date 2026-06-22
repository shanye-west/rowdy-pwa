/**
 * Shared device-level web-push state + actions.
 *
 * Both the header menu and the notification bell let a player turn push on/off,
 * so the "is push enabled here?" flag lives in a tiny module-level store: enabling
 * from one surface immediately updates the other. Toast feedback (incl. the iOS
 * "install to Home Screen first" guidance) is handled here so callers just render
 * a button.
 */

import { useSyncExternalStore } from "react";
import { useToast } from "../contexts/ToastContext";
import { enablePush, disablePush, isPushEnabledLocally, pushSupport } from "../messaging";
import { openInstallGuide } from "./useInstallPrompt";

const listeners = new Set<() => void>();
let pushOnState = isPushEnabledLocally();
// True while an enable/disable is in flight — lets every surface show a spinner
// and guards against overlapping taps racing the FCM token mint/delete.
let busyState = false;

function emit() {
  listeners.forEach((l) => l());
}

function setPushOnState(value: boolean) {
  if (pushOnState === value) return;
  pushOnState = value;
  emit();
}

function setBusyState(value: boolean) {
  if (busyState === value) return;
  busyState = value;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePushNotifications() {
  const { showToast, dismissToast } = useToast();
  const pushOn = useSyncExternalStore(subscribe, () => pushOnState);
  const busy = useSyncExternalStore(subscribe, () => busyState);
  // Hide the toggle only where push can never work (e.g. desktop browsers without
  // push support); on iOS-not-installed we still show it to guide the user.
  const pushUnsupported = pushSupport() === "unsupported";

  const enable = async () => {
    if (busyState) return;
    setBusyState(true);
    // Enabling is network-bound (mint an FCM token + register it server-side), so
    // it isn't instant. Show a sticky status toast immediately — the menu closes
    // on tap, so without this the user gets no signal until it finishes.
    const progressId = showToast({ message: "Enabling notifications…", variant: "info", duration: 0 });
    try {
      const result = await enablePush();
      dismissToast(progressId);
      if (result.ok) {
        setPushOnState(true);
        showToast({ message: "Notifications enabled 🎉", variant: "success" });
        return;
      }
      if (result.reason === "ios-needs-install") {
        // iOS only delivers push to installed PWAs — show the visual how-to.
        openInstallGuide();
      } else if (result.reason === "denied") {
        showToast({
          message: "Notifications are blocked — turn them on for this site in your browser settings.",
          variant: "error",
        });
      } else if (result.reason === "missing-vapid") {
        showToast({ message: "Push isn't configured yet. Try again later.", variant: "error" });
      } else {
        showToast({ message: "Couldn't enable notifications on this device.", variant: "error" });
      }
    } catch {
      dismissToast(progressId);
      showToast({ message: "Couldn't enable notifications on this device.", variant: "error" });
    } finally {
      setBusyState(false);
    }
  };

  const disable = async () => {
    if (busyState) return;
    // Optimistic: the token teardown is best-effort cleanup, so flip the UI and
    // confirm right away instead of making the user wait on the network. `busy`
    // stays set during the background teardown to keep a quick re-enable from
    // racing the token delete.
    setPushOnState(false);
    showToast({ message: "Notifications turned off", variant: "info" });
    setBusyState(true);
    try {
      await disablePush();
    } finally {
      setBusyState(false);
    }
  };

  return {
    pushOn,
    busy,
    pushUnsupported,
    enable,
    disable,
    toggle: () => (pushOn ? disable() : enable()),
  };
}
