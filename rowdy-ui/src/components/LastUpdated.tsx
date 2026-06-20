import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

// Build provenance injected at build time (see vite.config.ts). Shown so it's
// possible to confirm at a glance which build is running. The git SHA changes
// every commit; with autoUpdate the app reloads to the newest build on its own,
// so a stale SHA here is the tell that a device hasn't picked up a deploy yet.
const BUILD_DATE = new Date(__BUILD_TIME__);
const BUILD_LABEL = Number.isNaN(BUILD_DATE.getTime())
  ? __GIT_SHA__
  : `${__GIT_SHA__} · ${BUILD_DATE.toLocaleDateString([], { month: "short", day: "numeric" })}`;

export default function LastUpdated() {
  const [timestamp, setTimestamp] = useState<Date>(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setTimestamp(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mt-6 flex flex-col items-center gap-1.5 pb-6 text-muted-foreground">
      <div className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.3em]">
        <Clock className="h-3.5 w-3.5" />
        Last updated {timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </div>
      <div className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground/70">
        Build {BUILD_LABEL}
      </div>
    </div>
  );
}
