import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

type RoundFormat = "twoManBestBall" | "twoManShamble" | "twoManScramble" | "singles";

type MatchDoc = {
  id: string;
  roundId: string;
  holes?: Record<string, any>;
  status?: any;
  teamAPlayers?: any[];
  teamBPlayers?: any[];
  pointsValue?: number;
};

type RoundDoc = {
  id: string;
  format: RoundFormat;
};

const [match, setMatch] = useState<MatchDoc | null>(null);
const [round, setRound] = useState<RoundDoc | null>(null);
const [loading, setLoading] = useState(true);

export default function Match() {
  const { matchId } = useParams();
  const [match, setMatch] = useState<any>(null);
  const [round, setRound] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!matchId) return;
    (async () => {
      setLoading(true);
      const mRef = doc(db, "matches", matchId);
      const mSnap = await getDoc(mRef);
      if (!mSnap.exists()) { setMatch(null); setLoading(false); return; }
      const m = { id: mSnap.id, ...mSnap.data() };
      setMatch(m);

      // fetch round for format
      if (m.roundId) {
        const rRef = doc(db, "rounds", m.roundId);
        const rSnap = await getDoc(rRef);
        if (rSnap.exists()) setRound({ id: rSnap.id, ...rSnap.data() });
      }
      setLoading(false);
    })();
  }, [matchId]);

  const format: RoundFormat = (round?.format as RoundFormat) || "twoManBestBall";
  const holes = useMemo(() => {
    const h = match?.holes || {};
    // ensure keys "1".."18" exist for rendering
    return Array.from({ length: 18 }, (_, i) => String(i + 1)).map(k => ({ k, input: h[k]?.input || {} }));
  }, [match]);

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (!match) return <div style={{ padding: 16 }}>Match not found.</div>;

  async function saveHole(k: string, nextInput: any) {
    // We always write the full input map for that hole.
    await updateDoc(doc(db, "matches", match.id), { [`holes.${k}.input`]: nextInput });
  }

  function renderHoleRow(h: { k: string; input: any }) {
    const k = h.k;

    if (format === "twoManScramble") {
      const teamAGross = h.input?.teamAGross ?? null;
      const teamBGross = h.input?.teamBGross ?? null;
      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 8, alignItems: "center" }}>
          <div>#{k}</div>
          <input
            type="number"
            placeholder="A gross"
            value={teamAGross ?? ""}
            onChange={(e) => saveHole(k, { teamAGross: e.target.value === "" ? null : Number(e.target.value), teamBGross })}
          />
          <input
            type="number"
            placeholder="B gross"
            value={teamBGross ?? ""}
            onChange={(e) => saveHole(k, { teamAGross, teamBGross: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
      );
    }

    if (format === "singles") {
      const a = h.input?.teamAPlayerGross ?? null;
      const b = h.input?.teamBPlayerGross ?? null;
      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 8, alignItems: "center" }}>
          <div>#{k}</div>
          <input
            type="number"
            placeholder="A gross"
            value={a ?? ""}
            onChange={(e) => saveHole(k, { teamAPlayerGross: e.target.value === "" ? null : Number(e.target.value), teamBPlayerGross: b })}
          />
          <input
            type="number"
            placeholder="B gross"
            value={b ?? ""}
            onChange={(e) => saveHole(k, { teamAPlayerGross: a, teamBPlayerGross: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
      );
    }

    // twoManBestBall / twoManShamble → per-team arrays length 2
    const aArr: (number | null)[] = Array.isArray(h.input?.teamAPlayersGross) ? h.input.teamAPlayersGross : [null, null];
    const bArr: (number | null)[] = Array.isArray(h.input?.teamBPlayersGross) ? h.input.teamBPlayersGross : [null, null];

    const setA = (idx: 0 | 1, val: number | null) => {
      const nextA = [...aArr]; nextA[idx] = val;
      saveHole(k, { teamAPlayersGross: nextA, teamBPlayersGross: bArr });
    };
    const setB = (idx: 0 | 1, val: number | null) => {
      const nextB = [...bArr]; nextB[idx] = val;
      saveHole(k, { teamAPlayersGross: aArr, teamBPlayersGross: nextB });
    };

    return (
      <div key={k} style={{ display: "grid", gridTemplateColumns: "40px repeat(4, 1fr)", gap: 8, alignItems: "center" }}>
        <div>#{k}</div>
        <input
          type="number"
          placeholder="A1"
          value={aArr[0] ?? ""}
          onChange={(e) => setA(0, e.target.value === "" ? null : Number(e.target.value))}
        />
        <input
          type="number"
          placeholder="A2"
          value={aArr[1] ?? ""}
          onChange={(e) => setA(1, e.target.value === "" ? null : Number(e.target.value))}
        />
        <input
          type="number"
          placeholder="B1"
          value={bArr[0] ?? ""}
          onChange={(e) => setB(0, e.target.value === "" ? null : Number(e.target.value))}
        />
        <input
          type="number"
          placeholder="B2"
          value={bArr[1] ?? ""}
          onChange={(e) => setB(1, e.target.value === "" ? null : Number(e.target.value))}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 12 }}>
      <h2>Match {match.id}</h2>
      <div>
        <strong>Format:</strong> {format}
      </div>
      <div>
        <strong>Status:</strong>{" "}
        {match.status
          ? `${match.status.leader ?? "AS"} ${match.status.margin ?? 0} • thru ${match.status.thru ?? 0} • ${match.status.closed ? "Final" : "Live"}`
          : "—"}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {holes.map(renderHoleRow)}
      </div>
    </div>
  );
}