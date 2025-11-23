import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom"; // Added Link
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
import type { TournamentDoc, PlayerDoc } from "../types";
import { db } from "../firebase";

type RoundFormat = "twoManBestBall" | "twoManShamble" | "twoManScramble" | "singles";

// ... (Keep existing MatchDoc/RoundDoc types) ...
type MatchDoc = {
  id: string;
  roundId: string;
  tournamentId?: string;
  holes?: Record<string, any>;
  status?: {
    leader: "teamA" | "teamB" | null;
    margin: number;
    thru: number;
    dormie: boolean;
    closed: boolean;
  };
  teamAPlayers?: { playerId: string; strokesReceived: number[] }[];
  teamBPlayers?: { playerId: string; strokesReceived: number[] }[];
  pointsValue?: number;
};

type RoundDoc = {
  id: string;
  tournamentId: string;
  format: RoundFormat;
  day?: number; // Added day for display
};

export default function Match() {
  const { matchId } = useParams();
  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  const [loading, setLoading] = useState(true);

  // ... (Keep your existing useEffect hook exactly as is) ...
  useEffect(() => {
    if (!matchId) return;
    setLoading(true);

    const unsub = onSnapshot(doc(db, "matches", matchId), async (mSnap) => {
      if (!mSnap.exists()) {
        setMatch(null); setLoading(false); return;
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

      // Fetch players logic (same as before)
      const ids = Array.from(new Set([
        ...(m.teamAPlayers || []).map((p) => p.playerId).filter(Boolean),
        ...(m.teamBPlayers || []).map((p) => p.playerId).filter(Boolean),
      ]));
      if (ids.length) {
        const qPlayers = query(collection(db, "players"), where("__name__", "in", ids));
        const pSnap = await getDocs(qPlayers);
        const map: Record<string, PlayerDoc> = {};
        pSnap.forEach((d) => { map[d.id] = { id: d.id, ...(d.data() as any) }; });
        setPlayers(map);
      } else {
        setPlayers({});
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
      console.error(e);
      alert("Error saving score");
    }
  }

  // Helper to render dots
  function Dots({ count }: { count: number }) {
    if (!count) return null;
    return <span style={{ color: "#0802cdff", fontWeight: "bold", marginLeft: 2 }}>{"•".repeat(count)}</span>;
  }

  // Updated HoleRow with Dots
  function HoleRow({ k, input }: { k: string; input: any }) {
    const hIndex = Number(k) - 1;

    // Helper to get strokes for a specific player index on a team (0 or 1)
    const getStrokes = (team: "A" | "B", pIdx: number) => {
      const list = team === "A" ? match?.teamAPlayers : match?.teamBPlayers;
      return list?.[pIdx]?.strokesReceived?.[hIndex] ?? 0;
    };

    if (format === "twoManScramble") {
      const a = input?.teamAGross ?? null;
      const b = input?.teamBGross ?? null;
      // Scrambles usually calculate team handicap at the end, but if you have hole strokes:
      const sA = getStrokes("A", 0); // Assuming team handicap stored on p0
      const sB = getStrokes("B", 0);

      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 8, alignItems: "center" }}>
          <div style={{textAlign:'center', color:'#888'}}>{k}</div>
          <div style={{position:'relative'}}>
            <input
              type="number" inputMode="numeric" value={a ?? ""} disabled={isClosed}
              style={{width:'100%', padding:'8px', textAlign:'center'}}
              onChange={(e) => saveHole(k, { teamAGross: e.target.value === "" ? null : Number(e.target.value), teamBGross: b })}
            />
            {sA > 0 && <div style={{position:'absolute', right:8, top:8}}><Dots count={sA} /></div>}
          </div>
          <div style={{position:'relative'}}>
            <input
              type="number" inputMode="numeric" value={b ?? ""} disabled={isClosed}
              style={{width:'100%', padding:'8px', textAlign:'center'}}
              onChange={(e) => saveHole(k, { teamAGross: a, teamBGross: e.target.value === "" ? null : Number(e.target.value) })}
            />
            {sB > 0 && <div style={{position:'absolute', right:8, top:8}}><Dots count={sB} /></div>}
          </div>
        </div>
      );
    }

    // Singles
    if (format === "singles") {
      const a = input?.teamAPlayerGross ?? null;
      const b = input?.teamBPlayerGross ?? null;
      const sA = getStrokes("A", 0);
      const sB = getStrokes("B", 0);

      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 8, alignItems: "center" }}>
          <div style={{textAlign:'center', color:'#888'}}>{k}</div>
          <div style={{position:'relative'}}>
            <input
              type="number" inputMode="numeric" value={a ?? ""} disabled={isClosed}
              style={{width:'100%', padding:'8px', textAlign:'center'}}
              onChange={(e) => saveHole(k, { teamAPlayerGross: e.target.value === "" ? null : Number(e.target.value), teamBPlayerGross: b })}
            />
            {sA > 0 && <div style={{position:'absolute', right:8, top:8}}><Dots count={sA} /></div>}
          </div>
          <div style={{position:'relative'}}>
            <input
              type="number" inputMode="numeric" value={b ?? ""} disabled={isClosed}
              style={{width:'100%', padding:'8px', textAlign:'center'}}
              onChange={(e) => saveHole(k, { teamAPlayerGross: a, teamBPlayerGross: e.target.value === "" ? null : Number(e.target.value) })}
            />
            {sB > 0 && <div style={{position:'absolute', right:8, top:8}}><Dots count={sB} /></div>}
          </div>
        </div>
      );
    }

    // Best Ball / Shamble (4 inputs)
    const aArr = Array.isArray(input?.teamAPlayersGross) ? input.teamAPlayersGross : [null, null];
    const bArr = Array.isArray(input?.teamBPlayersGross) ? input.teamBPlayersGross : [null, null];

    return (
      <div key={k} style={{ display: "grid", gridTemplateColumns: "30px repeat(4, 1fr)", gap: 4, alignItems: "center" }}>
        <div style={{textAlign:'center', fontSize:'0.85em', color:'#888'}}>{k}</div>
        
        {/* Team A P1 */}
        <div style={{position:'relative'}}>
          <input type="number" inputMode="numeric" value={aArr[0] ?? ""} disabled={isClosed} style={{width:'100%', textAlign:'center', padding:'6px 2px'}}
            onChange={(e) => { const n=[...aArr]; n[0]=e.target.value===""?null:Number(e.target.value); saveHole(k, {teamAPlayersGross:n, teamBPlayersGross:bArr}); }} />
          {getStrokes("A",0) > 0 && <div style={{position:'absolute', top:0, right:2}}><Dots count={getStrokes("A",0)} /></div>}
        </div>
        {/* Team A P2 */}
        <div style={{position:'relative'}}>
          <input type="number" inputMode="numeric" value={aArr[1] ?? ""} disabled={isClosed} style={{width:'100%', textAlign:'center', padding:'6px 2px'}}
            onChange={(e) => { const n=[...aArr]; n[1]=e.target.value===""?null:Number(e.target.value); saveHole(k, {teamAPlayersGross:n, teamBPlayersGross:bArr}); }} />
          {getStrokes("A",1) > 0 && <div style={{position:'absolute', top:0, right:2}}><Dots count={getStrokes("A",1)} /></div>}
        </div>

        {/* Team B P1 */}
        <div style={{position:'relative'}}>
          <input type="number" inputMode="numeric" value={bArr[0] ?? ""} disabled={isClosed} style={{width:'100%', textAlign:'center', padding:'6px 2px'}}
            onChange={(e) => { const n=[...bArr]; n[0]=e.target.value===""?null:Number(e.target.value); saveHole(k, {teamAPlayersGross:aArr, teamBPlayersGross:n}); }} />
          {getStrokes("B",0) > 0 && <div style={{position:'absolute', top:0, right:2}}><Dots count={getStrokes("B",0)} /></div>}
        </div>
        {/* Team B P2 */}
        <div style={{position:'relative'}}>
          <input type="number" inputMode="numeric" value={bArr[1] ?? ""} disabled={isClosed} style={{width:'100%', textAlign:'center', padding:'6px 2px'}}
            onChange={(e) => { const n=[...bArr]; n[1]=e.target.value===""?null:Number(e.target.value); saveHole(k, {teamAPlayersGross:aArr, teamBPlayersGross:n}); }} />
          {getStrokes("B",1) > 0 && <div style={{position:'absolute', top:0, right:2}}><Dots count={getStrokes("B",1)} /></div>}
        </div>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (!match) return <div style={{ padding: 16 }}>Match not found.</div>;

  return (
    <div style={{ padding: 16, display: "grid", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
          {/* New Back Link */}
          {match.roundId && (
            <Link to={`/round/${match.roundId}`} style={{textDecoration:'none', fontSize:'1.2em'}}>
              ←
            </Link>
          )}
          <h2 style={{ margin: 0 }}>Match {match.id}</h2>
          <span style={{ opacity: 0.7, fontSize: "0.9em" }}>{format}</span>
        </div>

        {/* Team Names & Players */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: "0.9em" }}>
          <div style={{ borderTop: `3px solid ${tournament?.teamA?.color || "#ccc"}`, paddingTop: 4 }}>
            <div style={{fontWeight: 700}}>{tournament?.teamA?.name || "Team A"}</div>
            <div style={{opacity: 0.8}}>
              {(match.teamAPlayers || []).map(p => nameFor(p.playerId)).filter(Boolean).join(", ")}
            </div>
          </div>
          <div style={{ borderTop: `3px solid ${tournament?.teamB?.color || "#ccc"}`, paddingTop: 4 }}>
            <div style={{fontWeight: 700}}>{tournament?.teamB?.name || "Team B"}</div>
            <div style={{opacity: 0.8}}>
              {(match.teamBPlayers || []).map(p => nameFor(p.playerId)).filter(Boolean).join(", ")}
            </div>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div style={{ background: "#f5f5f5", padding: "8px 12px", borderRadius: 6, textAlign: "center", fontWeight: "bold" }}>
        {match.status?.leader
          ? `${match.status.leader === "teamA" ? (tournament?.teamA?.name || "Team A") : (tournament?.teamB?.name || "Team B")} is ${match.status.margin} UP`
          : (match.status?.thru ?? 0) > 0 ? "All Square" : "Match Preview"
        }
        <span style={{fontWeight: 400, opacity: 0.6, marginLeft: 8}}>
          {match.status?.closed ? "Final" : (match.status?.thru ?? 0) > 0 ? `(${match.status?.thru})` : ""}
        </span>
      </div>

      {isClosed && <div style={{ color: "#b91c1c", textAlign:'center', fontSize:'0.9em' }}>Match Finalized</div>}

      {/* Score Entry Grid */}
      <div style={{ display: "grid", gap: 0, border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
        {/* Table Header for Best Ball context */}
        {format !== "singles" && format !== "twoManScramble" && (
           <div style={{ display: "grid", gridTemplateColumns: "30px repeat(4, 1fr)", gap: 4, background: "#fafafa", padding: "8px 0", fontSize: "0.8em", textAlign: "center", fontWeight: 600, borderBottom: "1px solid #eee" }}>
             <div>#</div>
             <div style={{color: tournament?.teamA?.color}}>P1</div>
             <div style={{color: tournament?.teamA?.color}}>P2</div>
             <div style={{color: tournament?.teamB?.color}}>P1</div>
             <div style={{color: tournament?.teamB?.color}}>P2</div>
           </div>
        )}
        
        <div style={{display: 'grid', gap: 12, padding: format.includes("BestBall") ? 0 : 8 }}>
          {holes.map((h) => (
            <HoleRow key={h.k} k={h.k} input={h.input} />
          ))}
        </div>
      </div>
    </div>
  );
}