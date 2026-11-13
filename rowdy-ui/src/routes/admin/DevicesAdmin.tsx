import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { RefreshCw } from "lucide-react";
import { functions } from "../../firebase";
import AdminPage from "../../components/admin/AdminPage";
import AdminSection from "../../components/admin/AdminSection";
import { EmptyRow } from "../../components/admin/NavRow";
import SearchInput from "../../components/admin/SearchInput";
import SegmentedTabs, { type SegmentedTab } from "../../components/admin/SegmentedTabs";
import StatTiles from "../../components/admin/StatTiles";
import { InfoNote } from "../../components/admin/fields";
import { Badge, type BadgeProps } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { getErrorMessage } from "../../api/errors";

interface DeviceReport {
  id: string;
  playerId: string;
  platform: string;
  mode: string;
  permission: string;
  registered: boolean;
  lastSeen: string | null;
}

interface Dashboard {
  players: { id: string; name: string }[];
  devices: DeviceReport[];
}

const fetchDashboard = httpsCallable<void, Dashboard>(functions, "getDeviceDashboard");

/** Where a player stands on push, worst-case first so problems sort to the top. */
type PushStatus = "blocked" | "none" | "off" | "on";

const STATUS: Record<PushStatus, { label: string; variant: BadgeProps["variant"] }> = {
  blocked: { label: "blocked", variant: "error" },
  off: { label: "push off", variant: "warning" },
  none: { label: "no report", variant: "muted" },
  on: { label: "push on", variant: "success" },
};

const PERMISSION_LABEL: Record<string, string> = {
  granted: "Notifications allowed",
  denied: "Notifications blocked",
  default: "Not asked yet",
  unsupported: "Not available here",
};

type Filter = "all" | "attention" | "on";

const FILTERS: SegmentedTab<Filter>[] = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs help" },
  { id: "on", label: "Push on" },
];

/** A device counts as push-ready when the OS allows it and a token was saved. */
const pushReady = (d: DeviceReport) => d.permission === "granted" && d.registered;

function statusFor(devices: DeviceReport[]): PushStatus {
  if (devices.length === 0) return "none";
  if (devices.some(pushReady)) return "on";
  if (devices.some((d) => d.permission === "denied")) return "blocked";
  return "off";
}

/** "5 min ago", "3 days ago" — coarse on purpose; the exact time is in the tooltip. */
function timeAgo(iso: string | null): string {
  if (!iso) return "never seen";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Who has the app set up, and whether a push can reach them — the page to open
 * before a round to chase the players who won't get notifications.
 */
export default function DevicesAdmin() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      setData((await fetchDashboard()).data);
    } catch (err) {
      setError(getErrorMessage(err, "Could not load devices"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.players
      .map((p) => {
        const devices = data.devices
          .filter((d) => d.playerId === p.id)
          .sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
        return { ...p, devices, status: statusFor(devices) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const counts = useMemo(
    () => ({
      reporting: rows.filter((r) => r.status !== "none").length,
      on: rows.filter((r) => r.status === "on").length,
      attention: rows.filter((r) => r.status === "blocked" || r.status === "off").length,
    }),
    [rows]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "on" && r.status !== "on") return false;
      if (filter === "attention" && r.status !== "blocked" && r.status !== "off") return false;
      return !q || r.name.toLowerCase().includes(q);
    });
  }, [rows, search, filter]);

  return (
    <AdminPage
      title="Devices"
      breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Devices" }]}
      description="Each player's last reported app setup, and whether a push notification can reach them."
      error={error}
      loading={busy && !data}
      actions={
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      }
    >
      <StatTiles
        tiles={[
          { label: "Reporting", value: `${counts.reporting}/${rows.length}`, detail: "players seen" },
          { label: "Push on", value: counts.on, detail: "reachable", tone: "good" },
          {
            label: "Needs help",
            value: counts.attention,
            detail: "blocked or off",
            tone: counts.attention > 0 ? "warning" : "default",
          },
        ]}
      />

      <AdminSection title={`Players (${visible.length})`} flush>
        <div className="space-y-3 border-b border-border/60 p-4">
          <SegmentedTabs tabs={FILTERS} value={filter} onChange={setFilter} ariaLabel="Filter players by push status" />
          <SearchInput value={search} onChange={setSearch} placeholder="Search players" label="Search players" />
        </div>

        <ul className="divide-y divide-border/60">
          {visible.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">{r.name}</span>
                <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
              </div>
              {r.devices.length === 0 ? (
                <p className="mt-0.5 text-xs text-muted-foreground">Hasn't opened the app while signed in.</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {r.devices.map((d) => (
                    <li key={d.id} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="min-w-0 text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {d.platform} · {d.mode}
                        </span>
                        {" — "}
                        {PERMISSION_LABEL[d.permission] ?? "Unknown permission"}
                        {d.permission === "granted" && !d.registered && ", but not registered"}
                      </span>
                      <span
                        className="shrink-0 tabular-nums text-muted-foreground"
                        title={d.lastSeen ? new Date(d.lastSeen).toLocaleString() : undefined}
                      >
                        {timeAgo(d.lastSeen)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {visible.length === 0 && (
          <div className="p-4">
            <EmptyRow>{rows.length === 0 ? "No players yet." : "No players match that filter."}</EmptyRow>
          </div>
        )}
      </AdminSection>

      <InfoNote>
        Reports arrive when a signed-in player opens the app. The browser and the installed app report separately, even
        on the same phone. “Push on” means a token was saved at the last check — it doesn't guarantee delivery, and
        can't see Focus modes or an app that was installed and never opened.
      </InfoNote>
    </AdminPage>
  );
}
