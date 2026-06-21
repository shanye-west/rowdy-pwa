/**
 * Add-to-Home-Screen plumbing.
 *
 * Two cases, one hook:
 *   - Android / desktop Chromium fire `beforeinstallprompt`, which lets us trigger
 *     the real OS install prompt from a button. The event can fire before any
 *     component mounts, so we capture it at module load and stash it.
 *   - iOS Safari has no such API — installing is a manual Share → Add to Home
 *     Screen flow — so there we just open a visual guide (InstallGuideModal).
 *
 * `openInstallGuide()` is exported as a plain function so non-UI code (e.g. the
 * push-enable flow on iOS) can pop the guide without prop-drilling.
 */

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let guideOpen = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Stop Chrome's mini-infobar so we can surface install on our own terms.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    guideOpen = false;
    emit();
  });
}

export function openInstallGuide(): void {
  guideOpen = true;
  emit();
}

function closeInstallGuide(): void {
  guideOpen = false;
  emit();
}

export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const update = () => force((n) => n + 1);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  /** Fire the native OS install prompt. Returns true if the user accepted. */
  const promptInstall = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // The event is single-use; drop it so the button hides afterward.
    deferredPrompt = null;
    emit();
    return outcome === "accepted";
  };

  return {
    /** Native install prompt is available (Android / desktop Chromium). */
    canInstall: !!deferredPrompt,
    promptInstall,
    guideOpen,
    openGuide: openInstallGuide,
    closeGuide: closeInstallGuide,
  };
}
