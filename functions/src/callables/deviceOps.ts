import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireAdmin, requirePlayer } from "../helpers/adminAuth.js";

export const reportDevice = onCall(async (request) => {
  const { playerId } = await requirePlayer(request, "reportDevice", { maxCalls: 30, windowSeconds: 60 });
  const data = request.data;
  if (!data || typeof data.deviceId !== "string" || !/^[a-zA-Z0-9-]{10,80}$/.test(data.deviceId)) {
    throw new HttpsError("invalid-argument", "Invalid device identifier");
  }
  const allowed: Record<string, string[]> = {
    platform: ["iPhone/iPad", "Android", "Other"],
    mode: ["Installed app", "Browser"],
    permission: ["granted", "denied", "default", "unsupported"],
  };
  for (const [key, values] of Object.entries(allowed)) {
    if (!values.includes(data[key])) throw new HttpsError("invalid-argument", "Invalid device status");
  }
  let registered = false;
  if (typeof data.token === "string" && data.token.length <= 4096 && !data.token.includes("/") && data.token) {
    const token = await getFirestore().collection("pushTokens").doc(data.token).get();
    registered = token.exists && token.data()?.playerId === playerId;
  }
  await getFirestore().collection("deviceObservations").doc(`${playerId}__${data.deviceId}`).set({
    playerId, platform: data.platform, mode: data.mode, permission: data.permission,
    registered, lastSeen: FieldValue.serverTimestamp(),
  });
  return { success: true };
});

export const getDeviceDashboard = onCall(async (request) => {
  await requireAdmin(request, "getDeviceDashboard", { maxCalls: 30, windowSeconds: 60 });
  const db = getFirestore();
  const [players, devices] = await Promise.all([db.collection("players").get(), db.collection("deviceObservations").get()]);
  return { players: players.docs.map((p) => ({ id: p.id, name: String(p.data().displayName || p.id) })),
    devices: devices.docs.map((d) => {
      const value = d.data();
      return { id: d.id, playerId: value.playerId, platform: value.platform, mode: value.mode,
        permission: value.permission, registered: value.registered, lastSeen: value.lastSeen?.toDate().toISOString() ?? null };
    }) };
});
