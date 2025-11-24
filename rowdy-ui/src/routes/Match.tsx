import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  doc,
  onSnapshot,
  getDoc,
  updateDoc,
  getDocs,
  collection,
  where,
  query,
} from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, PlayerDoc, MatchDoc, RoundDoc, RoundFormat } from "../types";
import { formatMatchStatus } from "../utils";

function Dots({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <span style={{ color: "#ef4444", fontSize: "1.2em", lineHeight: 0, position: "absolute", top: 4, right: 4, pointerEvents: "none" }}>
      {"•".repeat(count)}
    </span>
  );
}

export default function Match() {
  const { matchId } = useParams();
  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  const [loading, setLoading] = useState(true);

  // 1. Listen to MATCH
  useEffect(() => {
    if (!matchId) return;
    setLoading(true);

    const unsub = onSnapshot(doc(db, "matches", matchId), (mSnap) => {
      if (!mSnap.exists()) { setMatch(null); setLoading(false); return; }
      
      const mData = { id: mSnap.id, ...(mSnap.data() as any) } as MatchDoc;
      setMatch(mData);

      // Load players logic (Keep this here or move to its own effect)
      const ids = Array.from(new Set([
        ...(mData.teamAPlayers || []).map((p) => p.playerId).filter(Boolean),
        ...(mData.teamBPlayers || []).map((p) => p.playerId).filter(Boolean),
      ]));
      
      const fetchPlayers = async () => {
        if (!ids.length) return {} as Record<string, PlayerDoc>;

        const batches: string[][] = [];
        for (let i = 0; i < ids.length; i += 10) {
          batches.push(ids.slice(i, i + 10));
        }

        const snapshots = await Promise.all(
          batches.map((batch) => getDocs(query(collection(db, "players"), where("__name__", "in", batch))))
        );

        return snapshots.reduce((map, snap) => {
          snap.forEach((d) => { map[d.id] = { id: d.id, ...(d.data() as any) }; });
          return map;
        }, {} as Record<string, PlayerDoc>);
      };

      fetchPlayers()
        .then((map) => setPlayers((prev) => ({ ...prev, ...map })))
        .finally(() => setLoading(false));
    });

    return () => unsub();
  }, [matchId]);

  // 2. Listen to ROUND (Only when roundId changes)
  useEffect(() => {
    if (!match?.roundId) return;

    const unsub = onSnapshot(doc(db, "rounds", match.roundId), async (rSnap) => {
      if (rSnap.exists()) {
        const rData = { id: rSnap.id, ...(rSnap.data() as any) } as RoundDoc;
        setRound(rData);

        // Fetch Tournament (One-time fetch is fine)
        if (rData.tournamentId) {
            const tSnap = await getDoc(doc(db, "tournaments", rData.tournamentId));
            if (tSnap.exists()) {
                setTournament({ id: tSnap.id, ...(tSnap.data() as any) } as TournamentDoc);
            }
        }
      }
    });

    return () => unsub();
  }, [match?.roundId]);

  const format: RoundFormat = (round?.format as RoundFormat) || "twoManBestBall";
  
  // --- LOCK LOGIC ---
  const roundLocked = !!round?.locked;
  const isMatchClosed = !!match?.status?.closed;
  const matchThru = match?.status?.thru ?? 0;

  const holes = useMemo(() => {
    const hMatch = match?.holes || {};
    const hCourse = round?.course?.holes || [];

    return Array.from({ length: 18 }, (_, i) => {
      const num = i + 1;
      const k = String(num);
      // Find static info (par/hcpIndex) if it exists
      const info = hCourse.find(h => h.number === num);
      
      return {
        k,
        input: hMatch[k]?.input || {},
        par: info?.par,  // <--- Pass to HoleRow
        hcpIndex: info?.hcpIndex,  // <--- Pass to HoleRow
      };
    });
  }, [match, round]);

  function nameFor(id?: string) {
    if (!id) return "";
    const p = players[id];
    return (p?.displayName as string) || (p?.username as string) || id;
  }

  async function saveHole(k: string, nextInput: any) {
    if (!match?.id || roundLocked) return;
    try {
      await updateDoc(doc(db, "matches", match.id), { [`holes.${k}.input`]: nextInput });
    } catch (e) {
      console.error("updateDoc failed", e);
      alert("Failed to save score");
    }
  }

  function HoleRow({ k, input, par, hcpIndex }: { k: string; input: any; par?: number; hcpIndex?: number }) {
    const holeIdx = Number(k) - 1;
    const holeNum = Number(k);
    const isHoleLocked = roundLocked || (isMatchClosed && holeNum > matchThru);

    const getStrokes = (team: "A" | "B", pIdx: number) => {
      const roster = team === "A" ? match?.teamAPlayers : match?.teamBPlayers;
      return roster?.[pIdx]?.strokesReceived?.[holeIdx] ?? 0;
    };

    const inputStyle = {
      width: "100%", padding: "10px 4px", textAlign: "center" as const, 
      fontSize: "1.1em", borderRadius: 4, border: "1px solid #ccc",
      backgroundColor: isHoleLocked ? "#f3f4f6" : "white",
      color: isHoleLocked ? "#9ca3af" : "inherit"
    };

    if (format === "twoManScramble") {
      const a = input?.teamAGross ?? null;
      const b = input?.teamBGross ?? null;
      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <div style={{ textAlign: "center", fontWeight: "bold", color: "#888" }}>
            <div>{k}</div>
            <div style={{ fontSize: "0.65em", opacity: 0.6 }}>{par ? `Par ${par}` : ""}{hcpIndex ? ` • hcpIndex ${hcpIndex}` : ""}</div>
          </div>
          <div style={{ position: "relative" }}>
            <input type="number" inputMode="numeric" value={a ?? ""} disabled={isHoleLocked} style={inputStyle}
              onChange={(e) => saveHole(k, { teamAGross: e.target.value === "" ? null : Number(e.target.value), teamBGross: b })} />
          </div>
          <div style={{ position: "relative" }}>
            <input type="number" inputMode="numeric" value={b ?? ""} disabled={isHoleLocked} style={inputStyle}
              onChange={(e) => saveHole(k, { teamAGross: a, teamBGross: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
        </div>
      );
    }

    if (format === "singles") {
      const a = input?.teamAPlayerGross ?? null;
      const b = input?.teamBPlayerGross ?? null;
      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <div style={{ textAlign: "center", fontWeight: "bold", color: "#888" }}>
            <div>{k}</div>
            <div style={{ fontSize: "0.65em", opacity: 0.6 }}>{par ? `Par ${par}` : ""}{hcpIndex ? ` • hcpIndex ${hcpIndex}` : ""}</div>
          </div>
          <div style={{ position: "relative" }}>
            <input type="number" inputMode="numeric" value={a ?? ""} disabled={isHoleLocked} style={inputStyle}
              onChange={(e) => saveHole(k, { teamAPlayerGross: e.target.value === "" ? null : Number(e.target.value), teamBPlayerGross: b })} />
            <Dots count={getStrokes("A", 0)} />
          </div>
          <div style={{ position: "relative" }}>
            <input type="number" inputMode="numeric" value={b ?? ""} disabled={isHoleLocked} style={inputStyle}
              onChange={(e) => saveHole(k, { teamAPlayerGross: a, teamBPlayerGross: e.target.value === "" ? null : Number(e.target.value) })} />
            <Dots count={getStrokes("B", 0)} />
          </div>
        </div>
      );
    }

    // Best Ball / Shamble
    const aArr = Array.isArray(input?.teamAPlayersGross) ? input.teamAPlayersGross : [null, null];
    const bArr = Array.isArray(input?.teamBPlayersGross) ? input.teamBPlayersGross : [null, null];

      return (
      <div key={k} style={{ display: "grid", gridTemplateColumns: "30px repeat(4, 1fr)", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <div style={{ textAlign: "center", fontWeight: "bold", color: "#888", fontSize: "0.9em" }}>
          <div>{k}</div>
          <div style={{ fontSize: "0.65em", opacity: 0.6 }}>{par ? `Par ${par}` : ""}{hcpIndex ? ` • hcpIndex ${hcpIndex}` : ""}</div>
        </div>
        <div style={{ position: "relative" }}>
          <input type="number" inputMode="numeric" value={aArr[0] ?? ""} disabled={isHoleLocked} style={inputStyle}
            onChange={(e) => { const n = [...aArr]; n[0] = e.target.value === "" ? null : Number(e.target.value); saveHole(k, { teamAPlayersGross: n, teamBPlayersGross: bArr }); }} />
          <Dots count={getStrokes("A", 0)} />
        </div>
        <div style={{ position: "relative" }}>
          <input type="number" inputMode="numeric" value={aArr[1] ?? ""} disabled={isHoleLocked} style={inputStyle}
            onChange={(e) => { const n = [...aArr]; n[1] = e.target.value === "" ? null : Number(e.target.value); saveHole(k, { teamAPlayersGross: n, teamBPlayersGross: bArr }); }} />
          <Dots count={getStrokes("A", 1)} />
        </div>
        <div style={{ position: "relative" }}>
          <input type="number" inputMode="numeric" value={bArr[0] ?? ""} disabled={isHoleLocked} style={inputStyle}
            onChange={(e) => { const n = [...bArr]; n[0] = e.target.value === "" ? null : Number(e.target.value); saveHole(k, { teamAPlayersGross: aArr, teamBPlayersGross: n }); }} />
          <Dots count={getStrokes("B", 0)} />
        </div>
        <div style={{ position: "relative" }}>
          <input type="number" inputMode="numeric" value={bArr[1] ?? ""} disabled={isHoleLocked} style={inputStyle}
            onChange={(e) => { const n = [...bArr]; n[1] = e.target.value === "" ? null : Number(e.target.value); saveHole(k, { teamAPlayersGross: aArr, teamBPlayersGross: n }); }} />
          <Dots count={getStrokes("B", 1)} />
        </div>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (!match) return <div style={{ padding: 16 }}>Match not found.</div>;

  return (
    <div style={{ padding: 16, display: "grid", gap: 16, maxWidth: 600, margin: "0 auto" }}>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {match.roundId && (
              <Link to={`/round/${match.roundId}`} style={{ textDecoration: "none", fontSize: "1.2rem" }}>←</Link>
            )}
            <h2 style={{ margin: 0 }}>Match {match.id}</h2>
          </div>
          {roundLocked && (
            <div style={{background:'#fee2e2', color:'#b91c1c', fontSize:'0.8rem', padding:'4px 8px', borderRadius:4, fontWeight:'bold'}}>
              LOCKED
            </div>
          )}
        </div>
        <div style={{ fontSize: "0.9em", opacity: 0.7, marginLeft: 24 }}>
          {format} {tournament && `• ${tournament.name}`}
        </div>
      </div>

      <div style={{ background: (isMatchClosed || roundLocked) ? "#fff1f2" : "#f8fafc", border: "1px solid #e2e8f0", padding: 16, borderRadius: 8, textAlign: "center" }}>
        <div style={{ fontSize: "1.2em", fontWeight: "bold", marginBottom: 4 }}>
          {formatMatchStatus(match.status, tournament?.teamA?.name, tournament?.teamB?.name)}
        </div>
        <div style={{ fontSize: "0.9em", opacity: 0.7 }}>
          {match.status?.closed 
            ? "Final Result" 
            : (match.status?.thru ?? 0) > 0 ? `Thru ${match.status?.thru}` : "Not started"}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: "0.9em" }}>
        <div style={{ borderTop: `3px solid ${tournament?.teamA?.color || "#ccc"}`, paddingTop: 4 }}>
          <div style={{ fontWeight: 700 }}>{tournament?.teamA?.name || "Team A"}</div>
          <div style={{ opacity: 0.8 }}>{(match.teamAPlayers || []).map(p => nameFor(p.playerId)).filter(Boolean).join(", ")}</div>
        </div>
        <div style={{ borderTop: `3px solid ${tournament?.teamB?.color || "#ccc"}`, paddingTop: 4 }}>
          <div style={{ fontWeight: 700 }}>{tournament?.teamB?.name || "Team B"}</div>
          <div style={{ opacity: 0.8 }}>{(match.teamBPlayers || []).map(p => nameFor(p.playerId)).filter(Boolean).join(", ")}</div>
        </div>
      </div>

      <div>
        {format !== "singles" && format !== "twoManScramble" && (
          <div style={{ display: "grid", gridTemplateColumns: "30px repeat(4, 1fr)", gap: 6, textAlign: "center", fontSize: "0.75em", fontWeight: 600, opacity: 0.6, marginBottom: 8 }}>
            <div>#</div>
            <div>{tournament?.teamA?.name ? "A1" : "P1"}</div>
            <div>{tournament?.teamA?.name ? "A2" : "P2"}</div>
            <div>{tournament?.teamB?.name ? "B1" : "P1"}</div>
            <div>{tournament?.teamB?.name ? "B2" : "P2"}</div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {holes.map((h) => (
            <HoleRow key={h.k} k={h.k} input={h.input} par={h.par} hcpIndex={h.hcpIndex} />
          ))}
        </div>
      </div>
    </div>
  );
}