import { useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { isIOS, isStandalone } from "../messaging";
const report = httpsCallable(functions, "reportDevice");

export function useDeviceReporting(playerId: string | undefined) {
  useEffect(() => {
    if (!playerId) return;
    let last = 0;
    let previous = "";
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
        const signature = JSON.stringify(data);
        if (signature === previous && Date.now() - last < 300_000) return;
        busy = true;
        await report(data);
        previous = signature;
        last = Date.now();
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
