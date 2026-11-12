/**
 * NotificationsContext — one shared subscription to the logged-in player's
 * notification history (players/{id}/notifications), powering the header bell and
 * the unread nav badges. Also keeps this device's push registration healthy
 * (the service worker renders every push as a system notification itself).
 *
 * Marking read is a direct Firestore update (the security rules allow the owner
 * to flip only read/readAt), so no callable is needed.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { syncAppBadge } from "../utils/appBadge";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";
import { useDeviceReporting } from "../hooks/useDeviceReporting";
import { refreshPushRegistration } from "../messaging";
import type { NotificationDoc } from "../types";

const HISTORY_LIMIT = 30;

interface NotificationsValue {
  notifications: NotificationDoc[];
  unreadCount: number;
  /** Unread count whose deep link starts with the given path (for nav badges). */
  unreadForPrefix: (prefix: string) => number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** Permanently remove a single notification from the player's history. */
  deleteNotification: (id: string) => void;
  /** Permanently remove every notification currently in the player's history. */
  clearAll: () => void;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { player, loading: authLoading } = useAuth();
  useDeviceReporting(player?.id);
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);

  // Live history for the current player (most recent first).
  useEffect(() => {
    if (!player) {
      setNotifications([]);
      if (!authLoading) void syncAppBadge(false);
      return;
    }
    const q = query(
      collection(db, "players", player.id, "notifications"),
      orderBy("createdAt", "desc"),
      limit(HISTORY_LIMIT)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as NotificationDoc);
        setNotifications(items);
        // Wait for the feed snapshot; don't clear a background badge at boot.
        void syncAppBadge(items.some(item => !item.read));
      },
      () => {
        /* permission/transient errors — keep last known state */
      }
    );
    return () => unsub();
  }, [player, authLoading]);

  // Self-heal the device's push registration on start and whenever the app
  // comes back to the foreground (an iOS PWA resumes far more often than it
  // cold-boots). Throttled inside refreshPushRegistration; never prompts.
  const playerId = player?.id;
  useEffect(() => {
    if (!playerId) return;
    void refreshPushRegistration();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshPushRegistration();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [playerId]);

  const value = useMemo<NotificationsValue>(() => {
    const unread = notifications.filter((n) => !n.read);
    return {
      notifications,
      unreadCount: unread.length,
      unreadForPrefix: (prefix) => unread.filter((n) => n.link?.startsWith(prefix)).length,
      markRead: (id) => {
        if (!player) return;
        void updateDoc(doc(db, "players", player.id, "notifications", id), {
          read: true,
          readAt: serverTimestamp(),
        }).catch(() => {});
      },
      markAllRead: () => {
        if (!player || unread.length === 0) return;
        const batch = writeBatch(db);
        unread.forEach((n) =>
          batch.update(doc(db, "players", player.id, "notifications", n.id), {
            read: true,
            readAt: serverTimestamp(),
          })
        );
        void batch.commit().catch(() => {});
      },
      deleteNotification: (id) => {
        if (!player) return;
        void deleteDoc(doc(db, "players", player.id, "notifications", id)).catch(() => {});
      },
      clearAll: () => {
        if (!player || notifications.length === 0) return;
        const batch = writeBatch(db);
        notifications.forEach((n) =>
          batch.delete(doc(db, "players", player.id, "notifications", n.id))
        );
        void batch.commit().catch(() => {});
      },
    };
  }, [notifications, player]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within a NotificationsProvider");
  return ctx;
}
