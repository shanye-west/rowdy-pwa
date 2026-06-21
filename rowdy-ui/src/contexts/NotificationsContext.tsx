/**
 * NotificationsContext — one shared subscription to the logged-in player's
 * notification history (players/{id}/notifications), powering the header bell and
 * the unread nav badges. Also forwards foreground push to a toast (background
 * push is rendered by the service worker).
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
import { db } from "../firebase";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";
import { onForegroundMessage } from "../messaging";
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
  const { player } = useAuth();
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);

  // Live history for the current player (most recent first).
  useEffect(() => {
    if (!player) {
      setNotifications([]);
      return;
    }
    const q = query(
      collection(db, "players", player.id, "notifications"),
      orderBy("createdAt", "desc"),
      limit(HISTORY_LIMIT)
    );
    const unsub = onSnapshot(
      q,
      (snap) => setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as NotificationDoc)),
      () => {
        /* permission/transient errors — keep last known state */
      }
    );
    return () => unsub();
  }, [player]);

  // Foreground push → toast. Background delivery is the service worker's job.
  useEffect(() => {
    let active = true;
    let cleanup = () => {};
    onForegroundMessage((payload) => {
      const data = payload.data ?? {};
      const title = data.title;
      const body = data.body;
      if (!title && !body) return;
      showToast({ message: body ? `${title}: ${body}` : (title as string), variant: "info" });
    }).then((unsub) => {
      if (active) cleanup = unsub;
      else unsub();
    });
    return () => {
      active = false;
      cleanup();
    };
  }, [showToast]);

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
