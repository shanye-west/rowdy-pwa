import { useSyncExternalStore } from "react";

let updateAvailable = false;
const listeners = new Set<() => void>();
export function markAppUpdateAvailable(): void {
  updateAvailable = true;
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useAppUpdate(): boolean {
  return useSyncExternalStore(subscribe, () => updateAvailable, () => false);
}
