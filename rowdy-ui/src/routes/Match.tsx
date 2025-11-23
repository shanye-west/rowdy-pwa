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
// 1. Import unified types from your central file
import type { TournamentDoc, PlayerDoc, MatchDoc, RoundDoc, RoundFormat } from "../types";

// Helper component for Handicap Dots
function Dots({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <span style={{ 
      color: "#ef4444", 
      fontSize: "1.2em", 
      lineHeight: 0, 
      position: "absolute", 
      top: 4, 
      right: 4,
      pointerEvents: "none" 
    }}>
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

  useEffect(() => {
    if (!matchId) return;
    setLoading(true);

    const unsub = onSnapshot(doc(db, "matches", matchId), async (mSnap) => {
      if (!mSnap.exists()) {
        setMatch(null);
        setLoading(false);
        return;
      }

      const m = { id: mSnap.id, ...(mSnap.data() as any) } as MatchDoc;
      setMatch(m);

      if (m.roundId) {
        const rSnap = await getDoc(doc(db, "rounds", m.roundId));
        if (rSnap.exists()) {
          const r = { id: rSnap.id, ...(rSnap.data() as any) } as RoundDoc;
          setRound(r);

          const tId = r.tournamentId || m.tournamentId;
          if (tId) {
            const tSnap = await getDoc(doc(db, "tournaments", tId));
            if (tSnap.exists()) {
              setTournament({ id: tSnap.id, ...(tSnap.data() as any) } as TournamentDoc);
            }
          }
        }
      }

      // Load players
      const ids = Array.from(
        new Set([
          ...(m.teamAPlayers || []).map((p) => p.playerId).filter(Boolean),
          ...(m.teamBPlayers || []).map((p) => p.playerId).filter(Boolean),
        ])
      );
      if (ids.length) {
        const qPlayers = query(collection(db, "players"), where("__name__", "in", ids));
        const pSnap = await getDocs(qPlayers);
        const map: Record<string, PlayerDoc> = {};
        pSnap.forEach((d) => { map[d.id] = { id: d.id, ...(d.data() as any) }; });
        setPlayers(map);
      }
      setLoading(false);
    });

    return () => unsub();
  }, [matchId]);

  const format: RoundFormat = (round?.format as RoundFormat) || "twoManBestBall";
  const isClosed = !!match?.status?.closed;

  const holes = useMemo(() => {
    const h = match?.holes || {};
    return Array.from({ length: 18 }, (_, i) => String(i + 1)).map((k) => ({
      k,
      input: h[k]?.input || {},
    }));
  }, [match]);

  function nameFor(id?: string) {
    if (!id) return "";
    const p = players[id];
    return (p?.displayName as string) || (p?.username as string) || id;
  }

  async function saveHole(k: string, nextInput: any) {
    if (!match?.id || isClosed) return;
    try {
      await updateDoc(doc(db, "matches", match.id), { [`holes.${k}.input`]: nextInput });
    } catch (e) {
      console.error("updateDoc failed", e);
      alert("Failed to save score");
    }
  }

  // --- Hole Row Component ---
  function HoleRow({ k, input }: { k: string; input: any }) {
    const holeIdx = Number(k) - 1;

    // Helper to look up strokes for Team A/B at player index 0/1
    const getStrokes = (team: "A" | "B", pIdx: number) => {
      const roster = team === "A" ? match?.teamAPlayers : match?.teamBPlayers;
      return roster?.[pIdx]?.strokesReceived?.[holeIdx] ?? 0;
    };

    // Common input style
    const inputStyle = {
      width: "100%", 
      padding: "10px 4px", 
      textAlign: "center" as const, 
      fontSize: "1.1em",
      borderRadius: 4,
      border: "1px solid #ccc"
    };

    if (format === "twoManScramble") {
      const a = input?.teamAGross ?? null;
      const b = input?.teamBGross ?? null;
      
      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <div style={{ textAlign: "center", fontWeight: "bold", color: "#888" }}>{k}</div>
          
          <div style={{ position: "relative" }}>
            <input type="number" inputMode="numeric" value={a ?? ""} disabled={isClosed} style={inputStyle}
              onChange={(e) => saveHole(k, { teamAGross: e.target.value === "" ? null : Number(e.target.value), teamBGross: b })}
            />
          </div>

          <div style={{ position: "relative" }}>
            <input type="number" inputMode="numeric" value={b ?? ""} disabled={isClosed} style={inputStyle}
              onChange={(e) => saveHole(k, { teamAGross: a, teamBGross: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </div>
        </div>
      );
    }

    if (format === "singles") {
      const a = input?.teamAPlayerGross ?? null;
      const b = input?.teamBPlayerGross ?? null;
      const sA = getStrokes("A", 0);
      const sB = getStrokes("B", 0);

      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <div style={{ textAlign: "center", fontWeight: "bold", color: "#888" }}>{k}</div>
          
          <div style={{ position: "relative" }}>
            <input type="number" inputMode="numeric" value={a ?? ""} disabled={isClosed} style={inputStyle}
              onChange={(e) => saveHole(k, { teamAPlayerGross: e.target.value === "" ? null : Number(e.target.value), teamBPlayerGross: b })}
            />
            <Dots count={sA} />
          </div>

          <div style={{ position: "relative" }}>
            <input type="number" inputMode="numeric" value={b ?? ""} disabled={isClosed} style={inputStyle}
              onChange={(e) => saveHole(k, { teamAPlayerGross: a, teamBPlayerGross: e.target.value === "" ? null : Number(e.target.value) })}
            />
            <Dots count={sB} />
          </div>
        </div>
      );
    }

    // Best Ball / Shamble (4 Inputs)
    const aArr = Array.isArray(input?.teamAPlayersGross) ? input.teamAPlayersGross : [null, null];
    const bArr = Array.isArray(input?.teamBPlayersGross) ? input.teamBPlayersGross : [null, null];

    return (
      <div key={k} style={{ display: "grid", gridTemplateColumns: "30px repeat(4, 1fr)", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <div style={{ textAlign: "center", fontWeight: "bold", color: "#888", fontSize: "0.9em" }}>{k}</div>
        
        {/* Team A - Player 1 */}
        <div style={{ position: "relative" }}>
          <input type="number" inputMode="numeric" value={aArr[0] ?? ""} disabled={isClosed} style={inputStyle}
            onChange={(e) => { const n = [...aArr]; n[0] = e.target.value === "" ? null : Number(e.target.value); saveHole(k, { teamAPlayersGross: n, teamBPlayersGross: bArr }); }} 
          />
          <Dots count={getStrokes("A", 0)} />
        </div>
        
        {/* Team A - Player 2 */}
        <div style={{ position: "relative" }}>
          <input type="number" inputMode="numeric" value={aArr[1] ?? ""} disabled={isClosed} style={inputStyle}
            onChange={(e) => { const n = [...aArr]; n[1] = e.target.value === "" ? null : Number(e.target.value); saveHole(k, { teamAPlayersGross: n, teamBPlayersGross: bArr }); }} 
          />
          <Dots count={getStrokes("A", 1)} />
        </div>

        {/* Team B - Player 1 */}
        <div style={{ position: "relative" }}>
          <input type="number" inputMode="numeric" value={bArr[0] ?? ""} disabled={isClosed} style={inputStyle}
            onChange={(e) => { const n = [...bArr]; n[0] = e.target.value === "" ? null : Number(e.target.value); saveHole(k, { teamAPlayersGross: aArr, teamBPlayersGross: n }); }} 
          />
          <Dots count={getStrokes("B", 0)} />
        </div>

        {/* Team B - Player 2 */}
        <div style={{ position: "relative" }}>
          <input type="number" inputMode="numeric" value={bArr[1] ?? ""} disabled={isClosed} style={inputStyle}
            onChange={(e) => { const n = [...bArr]; n[1] = e.target.value === "" ? null : Number(e.target.value); saveHole(k, { teamAPlayersGross: aArr, teamBPlayersGross: n }); }} 
          />
          <Dots count={getStrokes("B", 1)} />
        </div>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (!match) return <div style={{ padding: 16 }}>Match not found.</div>;

  return (
    <div style={{ padding: 16, display: "grid", gap: 16, maxWidth: 600, margin: "0 auto" }}>
      {/* Header with Back Link */}
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {match.roundId && (
            <Link to={`/round/${match.roundId}`} style={{ textDecoration: "none", fontSize: "1.2rem" }}>
              ←
            </Link>
          )}
          <h2 style={{ margin: 0 }}>Match {match.id}</h2>
        </div>
        <div style={{ fontSize: "0.9em", opacity: 0.7, marginLeft: 24 }}>
          {format} {tournament && `• ${tournament.name}`}
        </div>
      </div>

      {/* Status Card */}
      <div style={{ background: isClosed ? "#fff1f2" : "#f8fafc", border: "1px solid #e2e8f0", padding: 16, borderRadius: 8, textAlign: "center" }}>
        <div style={{ fontSize: "1.2em", fontWeight: "bold", marginBottom: 4 }}>
          {/* 2. Added optional chaining to match.status calls here to fix red underlines */}
          {match.status?.leader
            ? `${match.status?.leader === "teamA" ? (tournament?.teamA.name || "Team A") : (tournament?.teamB.name || "Team B")} is ${match.status?.margin} UP`
            : (match.status?.thru ?? 0) > 0 ? "All Square" : "Even"
          }
        </div>
        <div style={{ fontSize: "0.9em", opacity: 0.7 }}>
          {match.status?.closed 
            ? "Final Result" 
            : (match.status?.thru ?? 0) > 0 ? `Thru ${match.status?.thru}` : "Not started"}
        </div>
      </div>

      {/* Player Names Header */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: "0.9em" }}>
        <div style={{ borderTop: `3px solid ${tournament?.teamA?.color || "#ccc"}`, paddingTop: 4 }}>
          <div style={{ fontWeight: 700 }}>{tournament?.teamA?.name || "Team A"}</div>
          <div style={{ opacity: 0.8 }}>
            {(match.teamAPlayers || []).map(p => nameFor(p.playerId)).filter(Boolean).join(", ")}
          </div>
        </div>
        <div style={{ borderTop: `3px solid ${tournament?.teamB?.color || "#ccc"}`, paddingTop: 4 }}>
          <div style={{ fontWeight: 700 }}>{tournament?.teamB?.name || "Team B"}</div>
          <div style={{ opacity: 0.8 }}>
            {(match.teamBPlayers || []).map(p => nameFor(p.playerId)).filter(Boolean).join(", ")}
          </div>
        </div>
      </div>

      {/* Score Input Grid */}
      <div>
        {/* Column Headers for 2v2 formats */}
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
            <HoleRow key={h.k} k={h.k} input={h.input} />
          ))}
        </div>
      </div>
    </div>
  );
}