/**
 * Header notification bell — the in-app notification center.
 *
 * Shows the player's recent notifications with an unread count, lets them mark
 * all read, and deep-links to the relevant thread/bet on tap. Backed by the
 * shared NotificationsContext subscription.
 */

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { useAuth } from "../contexts/AuthContext";
import { useNotifications } from "../contexts/NotificationsContext";
import { toDateOrNull } from "../utils";
import type { FirestoreTimestampLike } from "../types";

/** Compact relative time, e.g. "now", "5m", "3h", "2d". */
function relativeTime(ts: FirestoreTimestampLike | undefined): string {
  const date = toDateOrNull(ts);
  if (!date) return "";
  const secs = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function NotificationBell() {
  const { player } = useAuth();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  // Only logged-in players have a notification feed.
  if (!player) return null;

  const handleItem = (id: string, link: string) => {
    markRead(id);
    setOpen(false);
    navigate(link);
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative text-white/90 hover:bg-white/10 hover:text-white"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[0.6rem] font-bold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+0.6rem)] w-72 origin-top-right animate-menu-open"
          onClick={(e) => e.stopPropagation()}
        >
          <Card className="overflow-hidden border border-border/60 bg-card/95 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm font-semibold text-foreground">Notifications</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() => markAllRead()}
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="h-px bg-border/80" />
            <div className="max-h-[60vh] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">No notifications yet</div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleItem(n.id, n.link)}
                    className={`flex w-full flex-col items-start gap-0.5 border-b border-border/40 px-4 py-2.5 text-left last:border-b-0 hover:bg-muted ${
                      n.read ? "" : "bg-primary/5"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{n.title}</span>
                      <span className="shrink-0 text-[0.65rem] text-muted-foreground/70">
                        {relativeTime(n.createdAt)}
                      </span>
                    </div>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                  </button>
                ))
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
