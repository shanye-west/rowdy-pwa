import { isNative } from './platform';
import { RowdyNative } from './standings';
export type HapticKind = 'selection' | 'success' | 'queued' | 'error';
/** Feedback must never block or fail a score write. */
export function haptic(kind: HapticKind) {
  if (isNative()) {
    void RowdyNative.haptic({ kind }).catch(() => {});
  } else if (typeof navigator !== 'undefined') {
    navigator.vibrate?.(kind === 'error' ? [40, 30, 40] : 10);
  }
}
