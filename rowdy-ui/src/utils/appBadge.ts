/** Best-effort unread indicator. Unsupported browsers simply do nothing. */
export async function syncAppBadge(hasUnread: boolean): Promise<void> {
  try {
    if (hasUnread) await navigator.setAppBadge?.();
    else await navigator.clearAppBadge?.();
  } catch { /* Badge permission/support must never interrupt the app. */ }
}
