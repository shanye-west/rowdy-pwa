import { isNative } from "../native/platform";
import { useSyncExternalStore } from "react";

let updateAvailable = false;
const listeners = new Set<() => void>();
export async function markAppUpdateAvailable(): Promise<void> {
  if (isNative()) return;
  // Workbox may report an external activation even when this page is already
  // current. Compare the deployed build instead of treating the event as proof.
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const version: unknown = await response.json();
    if (!version || typeof version !== "object" || !("buildTime" in version)
      || typeof version.buildTime !== "string") return;
    const available = version.buildTime !== __BUILD_TIME__;
    if (available === updateAvailable) return;
    updateAvailable = available;
    listeners.forEach(listener => listener());
  } catch { /* Offline or unavailable version: don't claim there's an update. */ }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useAppUpdate(): boolean {
  return useSyncExternalStore(subscribe, () => updateAvailable, () => false);
}
