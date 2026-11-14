/**
 * NotificationsContext — the logged-in player's notifications
 * (players/{id}/notifications), powering the header bell and the unread nav
 * badges.
 *
 * Two listeners, to keep reads down:
 *  - UNREAD only, always on (badges + app icon). Usually a handful of docs, so
 *    reopening the app after a while re-reads a few docs instead of the whole
 *    recent history (a listener that resumes after ~30 min is billed for every
 *    doc it returns).
 *  - The full recent HISTORY, only while the bell panel is open (`setHistoryOpen`).
 *    Until it arrives the panel shows the unread items it already has. Also keeps this device's push registration healthy
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
  where,
  writeBatch,
  type QuerySnapshot,
} from "firebase/firestore";
import { syncAppBadge } from "../utils/appBadge";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";
import { useDeviceReporting } from "../hooks/useDeviceReporting";
import { refreshPushRegistration } from "../messaging";
import type { NotificationDoc } from "../types";

const HISTORY_LIMIT = 30;

interface NotificationsValue {
  /** Recent history while the bell is open; otherwise just the unread items. */
  notifications: NotificationDoc[];
  /** Load (true) or release (false) the full recent history — the bell panel. */
  setHistoryOpen: (open: boolean) => void;
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
  const [unread, setUnread] = useState<NotificationDoc[]>([]);
  const [history, setHistory] = useState<NotificationDoc[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const playerId = player?.id;

  const toItems = (snap: QuerySnapshot) =>
    snap.docs.map((d) => ({ id: d.id, ...d.data() }) as NotificationDoc);

  // Unread notifications, newest first — always on while signed in.
  useEffect(() => {
    if (!playerId) {
      setUnread([]);
      if (!authLoading) void syncAppBadge(false);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, "players", playerId, "notifications"),
        where("read", "==", false),
        orderBy("createdAt", "desc"),
        limit(HISTORY_LIMIT)
      ),
      (snap) => {
        const items = toItems(snap);
        setUnread(items);
        // Wait for the feed snapshot; don't clear a background badge at boot.
        void syncAppBadge(items.length > 0);
      },
      () => {
        /* permission/transient errors — keep last known state */
      }
    );
    return () => unsub();
  }, [playerId, authLoading]);

  // Full recent history — only while the bell panel is open.
  useEffect(() => {
    if (!playerId || !historyOpen) {
      setHistory(null);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, "players", playerId, "notifications"),
        orderBy("createdAt", "desc"),
        limit(HISTORY_LIMIT)
      ),
      (snap) => setHistory(toItems(snap)),
      () => {
        /* permission/transient errors — the panel keeps showing unread items */
      }
    );
    return () => unsub();
  }, [playerId, historyOpen]);

  // Self-heal the device's push registration on start and whenever the app
  // comes back to the foreground (an iOS PWA resumes far more often than it
  // cold-boots). Throttled inside refreshPushRegistration; never prompts.
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
    const notifications = history ?? unread;
    return {
      notifications,
      setHistoryOpen,
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
  }, [history, unread, player]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within a NotificationsProvider");
  return ctx;
}
