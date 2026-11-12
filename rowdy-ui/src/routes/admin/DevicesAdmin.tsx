import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";
import AdminPage from "../../components/admin/AdminPage";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
interface Dashboard {
  players: { id: string; name: string }[];
  devices: { id: string; playerId: string; platform: string; mode: string; permission: string; registered: boolean; lastSeen: string | null }[];
}
const fetchDashboard = httpsCallable<void, Dashboard>(functions, "getDeviceDashboard");
export default function DevicesAdmin() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    setBusy(true); setError(null);
    try { setData((await fetchDashboard()).data); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load devices"); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, []);
  return <AdminPage title="Player devices" description="Last reported app usage and notification setup." error={error}
    loading={busy && !data} actions={<Button disabled={busy} onClick={() => void refresh()}>Refresh</Button>}>
    <p className="mb-4 text-sm text-muted-foreground">Reports appear after signed-in players visit the updated app. Browser and installed-app sessions may appear separately, even on the same phone. Registration means a token was saved when last checked; it does not guarantee delivery. These observations cannot detect an unused installation or Focus settings.</p>
    <div className="space-y-3">{data?.players.slice().sort((a,b) => a.name.localeCompare(b.name)).map(p => {
      const devices = data.devices.filter(d => d.playerId === p.id).sort((a,b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
      return <Card key={p.id} className="p-4"><h2 className="font-semibold">{p.name}</h2>
        {!devices.length && <p className="text-sm text-muted-foreground">No device reports yet</p>}
        {devices.map(d => <div key={d.id} className="mt-3 border-t pt-3 text-sm">
          <div className="font-medium">{d.platform} · {d.mode}</div>
          <div>Permission: {({ granted: "Allowed", denied: "Blocked", default: "Not granted", unsupported: "Unavailable in this context" } as Record<string,string>)[d.permission] ?? "Unknown"}</div>
          <div>Push registration: {d.registered ? "Registered at last check" : "Not registered"}</div>
          <div className="text-muted-foreground">Last seen: {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "Unknown"}</div>
        </div>)}
      </Card>;
    })}</div>
  </AdminPage>;
}
