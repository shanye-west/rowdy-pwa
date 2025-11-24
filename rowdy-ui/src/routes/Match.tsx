import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot, getDoc, updateDoc, getDocs, collection, where, query, documentId } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, PlayerDoc, MatchDoc, RoundDoc, RoundFormat } from "../types";
import { formatMatchStatus } from "../utils";
import Layout from "../components/Layout";

// Small red dots for strokes
function Dots({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <div style={{ 
      display: 'flex', gap: 1, justifyContent: 'center', 
      position: "absolute", top: 2, right: 2, pointerEvents: "none" 
    }}>
      {Array.from({length: count}).map((_, i) => (
        <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: '#ef4444' }}></div>
      ))}
    </div>
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

      // Load players 
      const ids = Array.from(new Set([
        ...(mData.teamAPlayers || []).map((p) => p.playerId).filter(Boolean),
        ...(mData.teamBPlayers || []).map((p) => p.playerId).filter(Boolean),
      ]));
      
      if (ids.length === 0) {
        setLoading(false);
        return;
      }

      // Only fetch if we haven't already (or if new players appeared)
      // For simplicity in this hook, we just fetch. 
      // A production app might cache this better.
      const fetchPlayers = async () => {
        const batches = [];
        for (let i = 0; i < ids.length; i += 10) batches.push(ids.slice(i, i + 10));
        
        const newPlayers: Record<string, PlayerDoc> = {};
        for (const batch of batches) {
            const q = query(collection(db, "players"), where(documentId(), "in", batch));
            const snap = await getDocs(q);
            snap.forEach(d => { newPlayers[d.id] = { id: d.id, ...d.data() } as PlayerDoc; });
        }
        setPlayers(prev => ({ ...prev, ...newPlayers }));
      };

      fetchPlayers().finally(() => setLoading(false));
    });

    return () => unsub();
  }, [matchId]);

  // 2. Listen to ROUND
  useEffect(() => {
    if (!match?.roundId) return;
    const unsub = onSnapshot(doc(db, "rounds", match.roundId), async (rSnap) => {
      if (rSnap.exists()) {
        const rData = { id: rSnap.id, ...(rSnap.data() as any) } as RoundDoc;
        setRound(rData);
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
  const roundLocked = !!round?.locked;
  const isMatchClosed = !!match?.status?.closed;
  const matchThru = match?.status?.thru ?? 0;

  const holes = useMemo(() => {
    const hMatch = match?.holes || {};
    const hCourse = round?.course?.holes || [];
    return Array.from({ length: 18 }, (_, i) => {
      const num = i + 1;
      const k = String(num);
      const info = hCourse.find(h => h.number === num);
      return { k, input: hMatch[k]?.input || {}, par: info?.par, hcpIndex: info?.hcpIndex };
    });
  }, [match, round]);

  function getInitials(pid?: string) {
    if (!pid) return "P";
    const p = players[pid];
    if (!p) return "?";
    // Return "FM" (First Middle/Last)
    if (p.displayName) {
        const parts = p.displayName.split(" ");
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
        return p.displayName.slice(0,2).toUpperCase();
    }
    return (p.username || "??").slice(0,2).toUpperCase();
  }

  async function saveHole(k: string, nextInput: any) {
    if (!match?.id || roundLocked) return;
    try {
      await updateDoc(doc(db, "matches", match.id), { [`holes.${k}.input`]: nextInput });
    } catch (e) {
      console.error("Save failed", e);
    }
  }

  // --- SUB-COMPONENT: SINGLE HOLE ROW ---
  function HoleRow({ k, input, par, hcpIndex }: { k: string; input: any; par?: number; hcpIndex?: number }) {
    const holeIdx = Number(k) - 1;
    
    // Lock logic: only lock if the administrator has locked the round via the dashboard
    const isLocked = roundLocked; 

    const getStrokes = (team: "A" | "B", pIdx: number) => {
      const roster = team === "A" ? match?.teamAPlayers : match?.teamBPlayers;
      return roster?.[pIdx]?.strokesReceived?.[holeIdx] ?? 0;
    };

    // Specialized Input Renderers based on format
    const renderInputs = () => {
        if (format === "twoManScramble") {
            const a = input?.teamAGross ?? "";
            const b = input?.teamBGross ?? "";
            return (
                <>
                    <div style={{ gridColumn: "span 2" }}>
                        <input className="score-input" type="number" inputMode="numeric" value={a ?? ""} disabled={isLocked} 
                            onChange={(e) => saveHole(k, { teamAGross: e.target.value === "" ? null : Number(e.target.value), teamBGross: b })} />
                    </div>
                    <div style={{ gridColumn: "span 2" }}>
                        <input className="score-input" type="number" inputMode="numeric" value={b ?? ""} disabled={isLocked}
                            onChange={(e) => saveHole(k, { teamAGross: a, teamBGross: e.target.value === "" ? null : Number(e.target.value) })} />
                    </div>
                </>
            );
        }
        if (format === "singles") {
            const a = input?.teamAPlayerGross ?? "";
            const b = input?.teamBPlayerGross ?? "";
            return (
                <>
                    <div style={{ gridColumn: "span 2", position: 'relative' }}>
                        <input className="score-input" type="number" inputMode="numeric" value={a ?? ""} disabled={isLocked}
                            onChange={(e) => saveHole(k, { teamAPlayerGross: e.target.value === "" ? null : Number(e.target.value), teamBPlayerGross: b })} />
                        <Dots count={getStrokes("A", 0)} />
                    </div>
                    <div style={{ gridColumn: "span 2", position: 'relative' }}>
                        <input className="score-input" type="number" inputMode="numeric" value={b ?? ""} disabled={isLocked}
                            onChange={(e) => saveHole(k, { teamAPlayerGross: a, teamBPlayerGross: e.target.value === "" ? null : Number(e.target.value) })} />
                        <Dots count={getStrokes("B", 0)} />
                    </div>
                </>
            );
        }
        // Default: 2 Man (Best Ball / Shamble) -> 4 Inputs
        const aArr = Array.isArray(input?.teamAPlayersGross) ? input.teamAPlayersGross : [null, null];
        const bArr = Array.isArray(input?.teamBPlayersGross) ? input.teamBPlayersGross : [null, null];
        
        return (
            <>
                <div style={{ position: 'relative' }}>
                    <input className="score-input" type="number" inputMode="numeric" value={aArr[0] ?? ""} disabled={isLocked}
                        onChange={(e) => { const n = [...aArr]; n[0] = e.target.value===""?null:Number(e.target.value); saveHole(k, { teamAPlayersGross: n, teamBPlayersGross: bArr }); }} />
                    <Dots count={getStrokes("A", 0)} />
                </div>
                <div style={{ position: 'relative' }}>
                    <input className="score-input" type="number" inputMode="numeric" value={aArr[1] ?? ""} disabled={isLocked}
                        onChange={(e) => { const n = [...aArr]; n[1] = e.target.value===""?null:Number(e.target.value); saveHole(k, { teamAPlayersGross: n, teamBPlayersGross: bArr }); }} />
                    <Dots count={getStrokes("A", 1)} />
                </div>
                <div style={{ position: 'relative' }}>
                    <input className="score-input" type="number" inputMode="numeric" value={bArr[0] ?? ""} disabled={isLocked}
                        onChange={(e) => { const n = [...bArr]; n[0] = e.target.value===""?null:Number(e.target.value); saveHole(k, { teamAPlayersGross: aArr, teamBPlayersGross: n }); }} />
                    <Dots count={getStrokes("B", 0)} />
                </div>
                <div style={{ position: 'relative' }}>
                    <input className="score-input" type="number" inputMode="numeric" value={bArr[1] ?? ""} disabled={isLocked}
                        onChange={(e) => { const n = [...bArr]; n[1] = e.target.value===""?null:Number(e.target.value); saveHole(k, { teamAPlayersGross: aArr, teamBPlayersGross: n }); }} />
                    <Dots count={getStrokes("B", 1)} />
                </div>
            </>
        );
    };

    return (
        <div className="card" style={{ display: "grid", gridTemplateColumns: "40px repeat(4, 1fr)", gap: 8, alignItems: "center", padding: "12px 8px" }}>
            <div style={{ textAlign: "center", borderRight: "1px solid var(--divider)", paddingRight: 8 }}>
                <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>{k}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                    {par ? `Par ${par}` : ""}
                </div>
                {hcpIndex && <div style={{ fontSize: "0.6rem", color: "#94a3b8" }}>{hcpIndex}</div>}
            </div>
            
            {renderInputs()}
        </div>
    );
  }

  if (loading) return <div style={{ padding: 20, textAlign: "center" }}>Loading Match...</div>;
  if (!match) return <div style={{ padding: 20 }}>Match not found.</div>;

  const tName = tournament?.name || "Match Scoring";
  const tSeries = tournament?.series;

  // Header Initials Row
  const showFour = format !== "singles" && format !== "twoManScramble";

  return (
    <Layout title={tName} series={tSeries} showBack>
      <div style={{ padding: 16, display: "grid", gap: 16, maxWidth: 600, margin: "0 auto" }}>
        
        {/* MATCH STATUS BANNER */}
        <div style={{ 
            background: isMatchClosed ? "var(--brand-secondary)" : "var(--brand-primary)", 
            color: "var(--brand-accent)", 
            padding: 16, 
            borderRadius: 12, 
            textAlign: "center",
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)"
        }}>
            <div style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.9 }}>
                {isMatchClosed ? "Final Result" : `Thru ${matchThru}`}
            </div>
            <div style={{ fontSize: "1.8rem", fontWeight: 800, margin: "4px 0" }}>
                {formatMatchStatus(match.status, tournament?.teamA?.name, tournament?.teamB?.name)}
            </div>
            <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>
                {format}
            </div>
        </div>

        {/* HEADERS (Initials) */}
        <div style={{ display: "grid", gridTemplateColumns: "40px repeat(4, 1fr)", gap: 8, textAlign: "center", padding: "0 8px" }}>
            <div></div> {/* Hole Num */}
            
            {/* Team A Headers */}
            {showFour ? (
                <>
                    <div style={{ color: tournament?.teamA?.color, fontWeight: 800 }}>{getInitials(match.teamAPlayers?.[0]?.playerId)}</div>
                    <div style={{ color: tournament?.teamA?.color, fontWeight: 800 }}>{getInitials(match.teamAPlayers?.[1]?.playerId)}</div>
                </>
            ) : (
                <div style={{ gridColumn: "span 2", color: tournament?.teamA?.color, fontWeight: 800 }}>
                    {tournament?.teamA?.name || "Team A"}
                </div>
            )}

            {/* Team B Headers */}
            {showFour ? (
                <>
                    <div style={{ color: tournament?.teamB?.color, fontWeight: 800 }}>{getInitials(match.teamBPlayers?.[0]?.playerId)}</div>
                    <div style={{ color: tournament?.teamB?.color, fontWeight: 800 }}>{getInitials(match.teamBPlayers?.[1]?.playerId)}</div>
                </>
            ) : (
                <div style={{ gridColumn: "span 2", color: tournament?.teamB?.color, fontWeight: 800 }}>
                    {tournament?.teamB?.name || "Team B"}
                </div>
            )}
        </div>

        {/* HOLES LIST */}
        <div style={{ display: "grid", gap: 8 }}>
            {holes.map((h) => (
                <HoleRow key={h.k} k={h.k} input={h.input} par={h.par} hcpIndex={h.hcpIndex} />
            ))}
        </div>

        <div style={{ height: 40 }}></div>
      </div>
    </Layout>
  );
}