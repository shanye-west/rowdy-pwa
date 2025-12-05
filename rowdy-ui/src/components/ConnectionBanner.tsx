import { memo } from "react";

interface ConnectionBannerProps {
  /** Whether the device is currently online */
  isOnline: boolean;
}

/**
 * Simple banner that shows only when offline.
 * Firestore handles sync automatically - we just need to tell users they're offline.
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
      className="flex items-center justify-center gap-2 py-2 px-4 text-sm font-medium bg-yellow-100 text-yellow-800 rounded-lg"
      role="status"
      aria-live="polite"
    >
      <span>📶</span>
      <span>You're offline — scores will sync when you reconnect</span>
    </div>
  );
});

export default ConnectionBanner;
