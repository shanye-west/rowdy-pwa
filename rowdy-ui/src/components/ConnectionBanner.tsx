import { memo } from "react";

interface ConnectionBannerProps {
  /** Whether the device is currently online */
  isOnline: boolean;
}

/**
 * Full-width banner shown app-wide (in Layout) only while offline.
 * Firestore queues writes automatically — we just reassure the user that their
 * scores are safe on-device and will sync once they reconnect.
 */
export const ConnectionBanner = memo(function ConnectionBanner({
  isOnline,
}: ConnectionBannerProps) {
  // Only show when offline
  if (isOnline) {
    return null;
  }

  return (
    <div
      className="flex items-center justify-center gap-2 bg-amber-400/95 px-4 py-2 text-sm font-semibold text-amber-950 shadow-sm"
      role="status"
      aria-live="polite"
    >
      <span>📶</span>
      <span>You're offline — scores save on this device and sync when you reconnect</span>
    </div>
  );
});

export default ConnectionBanner;
