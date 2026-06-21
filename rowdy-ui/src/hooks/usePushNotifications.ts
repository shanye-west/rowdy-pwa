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

function setPushOnState(value: boolean) {
  if (pushOnState === value) return;
  pushOnState = value;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePushNotifications() {
  const { showToast } = useToast();
  const pushOn = useSyncExternalStore(subscribe, () => pushOnState);
  // Hide the toggle only where push can never work (e.g. desktop browsers without
  // push support); on iOS-not-installed we still show it to guide the user.
  const pushUnsupported = pushSupport() === "unsupported";

  const enable = async () => {
    const result = await enablePush();
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
  };

  const disable = async () => {
    await disablePush();
    setPushOnState(false);
    showToast({ message: "Notifications turned off", variant: "info" });
  };

  return {
    pushOn,
    pushUnsupported,
    enable,
    disable,
    toggle: () => (pushOn ? disable() : enable()),
  };
}
