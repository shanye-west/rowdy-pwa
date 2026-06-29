import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Bell, BellOff } from "lucide-react";
import Layout from "../components/Layout";
import LoadingScreen from "../components/LoadingScreen";
import { Card } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { db, functions } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useTournamentContext } from "../contexts/TournamentContext";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { useToast } from "../contexts/ToastContext";
import type { NotificationCategory, NotificationPrefs } from "../types";

/**
 * Mirror of the server defaults (functions/src/messaging/notify.ts
 * DEFAULT_NOTIFICATION_PREFS) — keep in sync. Opt-out: everything on except the
 * high-volume live lead changes, which are opt-in.
 */
const DEFAULT_PREFS: Record<NotificationCategory, boolean> = {
  chat: true,
  sportsbook: true,
  matchResult: true,
  matchLeadChange: false,
  tournament: true,
};

const CATEGORIES: { key: NotificationCategory; label: string; description: string }[] = [
  { key: "matchResult", label: "Match results", description: "When a match finishes — who won and the final margin." },
  {
    key: "matchLeadChange",
    label: "Live lead changes",
    description: "When the lead flips in a match. Covers every match — can be chatty.",
  },
  {
    key: "tournament",
    label: "Tournament milestones",
    description: "A team takes the overall lead, a round goes final, or the Cup is decided.",
  },
  { key: "chat", label: "Chat messages", description: "New comments and replies in match threads and the sportsbook feed." },
  { key: "sportsbook", label: "Sportsbook & bets", description: "When someone challenges you to a bet or takes one of yours." },
];

const setNotificationPrefs = httpsCallable<{ prefs: NotificationPrefs }, { success: boolean }>(
  functions,
  "setNotificationPrefs"
);

export default function NotificationSettings() {
  const { player } = useAuth();
  const { tournament } = useTournamentContext();
  const { pushOn, busy: pushBusy, pushUnsupported, toggle: togglePush } = usePushNotifications();
  const { showToast } = useToast();

  const [prefs, setPrefs] = useState<Record<NotificationCategory, boolean> | null>(null);

  // Seed from the player doc itself (authoritative) rather than the auth context,
  // which loads prefs once at login and would go stale after a save.
  useEffect(() => {
    if (!player?.id) {
      setPrefs(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, "players", player.id))
      .then((snap) => {
        if (cancelled) return;
        const stored = (snap.data()?.notificationPrefs ?? {}) as NotificationPrefs;
        setPrefs({ ...DEFAULT_PREFS, ...stored });
      })
      .catch(() => {
        if (!cancelled) setPrefs({ ...DEFAULT_PREFS });
      });
    return () => {
      cancelled = true;
    };
  }, [player?.id]);

  const persist = async (next: Record<NotificationCategory, boolean>) => {
    try {
      await setNotificationPrefs({ prefs: next });
    } catch {
      showToast({ message: "Couldn't save notification settings — try again.", variant: "error" });
      // Re-seed from the server so the UI reflects what's actually saved.
      if (player?.id) {
        const snap = await getDoc(doc(db, "players", player.id));
        setPrefs({ ...DEFAULT_PREFS, ...((snap.data()?.notificationPrefs ?? {}) as NotificationPrefs) });
      }
    }
  };

  const toggle = (key: NotificationCategory) => {
    setPrefs((cur) => {
      if (!cur) return cur;
      const next = { ...cur, [key]: !cur[key] };
      void persist(next); // optimistic; persist() re-seeds on failure
      return next;
    });
  };

  return (
    <Layout
      title="Notifications"
      series={tournament?.series}
      showBack
      tournamentLogo={tournament?.tournamentLogo}
    >
      {!player ? (
        <Card className="m-4 p-6 text-center text-sm text-muted-foreground">
          Log in to manage your notification settings.
        </Card>
      ) : !prefs ? (
        <LoadingScreen />
      ) : (
        <div className="mx-auto max-w-xl space-y-4 p-4">
          {/* Device master switch: enables/disables push for THIS device. The
              per-category prefs below decide WHICH alerts you want once push is on. */}
          <Card className="flex items-center justify-between gap-4 p-4">
            <div className="flex min-w-0 items-start gap-3">
              {pushOn ? (
                <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              ) : (
                <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 text-sm">
                <div className="font-semibold text-foreground">
                  All notifications {pushOn ? "on" : "off"}
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {pushUnsupported
                    ? "This device can't receive push notifications, but your choices below apply on devices that can."
                    : pushOn
                      ? "This device will receive the alerts you choose below."
                      : "Turn on to receive pushes on this device — your choices below still apply."}
                </p>
              </div>
            </div>
            <Switch
              checked={pushOn}
              onCheckedChange={() => void togglePush()}
              disabled={pushBusy || pushUnsupported}
              aria-label="Enable all notifications"
            />
          </Card>

          <Card className="divide-y divide-border/70">
            {CATEGORIES.map(({ key, label, description }) => (
              <label
                key={key}
                htmlFor={`notif-${key}`}
                className="flex cursor-pointer items-center justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{label}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                </div>
                <Switch
                  id={`notif-${key}`}
                  checked={prefs[key]}
                  onCheckedChange={() => toggle(key)}
                  aria-label={label}
                />
              </label>
            ))}
          </Card>
        </div>
      )}
    </Layout>
  );
}
