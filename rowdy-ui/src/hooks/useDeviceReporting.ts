import { useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { isIOS, isStandalone } from "../messaging";
const report = httpsCallable(functions, "reportDevice");

/**
 * Each report costs the server 2 reads + 1 write. It feeds the admin Devices
 * page (push readiness), which only needs to know when something CHANGES —
 * so report on a change, or at most every REPORT_EVERY_MS as a "still here"
 * heartbeat. The last report is kept in localStorage so an app restart doesn't
 * re-send an identical one (it used to: every launch, then every 5 minutes).
 */
const REPORT_EVERY_MS = 6 * 60 * 60 * 1000;
const LAST_REPORT_KEY = "rowdy:device-report";

function lastReport(): { signature: string; at: number } {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_REPORT_KEY) || "null");
    if (parsed && typeof parsed.signature === "string" && typeof parsed.at === "number") return parsed;
  } catch { /* storage unavailable or corrupt — treat as never reported */ }
  return { signature: "", at: 0 };
}

export function useDeviceReporting(playerId: string | undefined) {
  useEffect(() => {
    if (!playerId) return;
    let busy = false;
    const send = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || busy) return;
      try {
        let deviceId = localStorage.getItem("rowdy:device-id");
        if (!deviceId) {
          deviceId = crypto.randomUUID();
          localStorage.setItem("rowdy:device-id", deviceId);
        }
        const data = { deviceId, platform: isIOS() ? "iPhone/iPad" : /android/i.test(navigator.userAgent) ? "Android" : "Other",
          mode: isStandalone() ? "Installed app" : "Browser",
          permission: "Notification" in window ? Notification.permission : "unsupported",
          token: localStorage.getItem("rowdy:push-token") };
        // Keyed per player so switching accounts on one device still reports.
        const signature = JSON.stringify({ playerId, ...data });
        const prev = lastReport();
        if (signature === prev.signature && Date.now() - prev.at < REPORT_EVERY_MS) return;
        busy = true;
        await report(data);
        localStorage.setItem(LAST_REPORT_KEY, JSON.stringify({ signature, at: Date.now() }));
      } catch { /* Reporting must never interrupt scoring. Retry on the next visit/tick. */ }
      finally { busy = false; }
    };
    void send();
    const interval = window.setInterval(() => void send(), 30_000);
    document.addEventListener("visibilitychange", send);
    window.addEventListener("online", send);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", send);
      window.removeEventListener("online", send);
    };
  }, [playerId]);
}
