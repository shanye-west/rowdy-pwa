export type RoundFormat = "twoManBestBall" | "twoManShamble" | "twoManScramble" | "singles";

export function playersPerSide(format: RoundFormat): number {
  return format === "singles" ? 1 : 2;
}

export function emptyHolesFor(format: RoundFormat) {
  const holes: Record<string, any> = {};
  for (let i = 1; i <= 18; i++) {
    const k = String(i);
    if (format === "twoManScramble") {
      holes[k] = { input: { teamAGross: null, teamBGross: null, teamADrive: null, teamBDrive: null } };
    } else if (format === "singles") {
      holes[k] = { input: { teamAPlayerGross: null, teamBPlayerGross: null } };
    } else if (format === "twoManShamble") {
      holes[k] = { input: { teamAPlayersGross: [null, null], teamBPlayersGross: [null, null], teamADrive: null, teamBDrive: null } };
    } else {
      holes[k] = { input: { teamAPlayersGross: [null, null], teamBPlayersGross: [null, null] } };
    }
  }
  return holes;
}

export function defaultStatus() {
  return { leader: null, margin: 0, thru: 0, dormie: false, closed: false };
}

function zeros18(): number[] {
  return Array.from({ length: 18 }, () => 0);
}

export function ensureSideSize(side: any, count: number) {
  const make = () => ({ playerId: "", strokesReceived: zeros18() });
  if (!Array.isArray(side)) return Array.from({ length: count }, make);
  const trimmed = side.slice(0, count).map((p: any) => ({
    playerId: typeof p?.playerId === "string" ? p.playerId : "",
    strokesReceived: Array.isArray(p?.strokesReceived) && p.strokesReceived.length === 18 ? p.strokesReceived : zeros18(),
  }));
  while (trimmed.length < count) trimmed.push(make());
  return trimmed;
}

export function normalizeHoles(existing: Record<string, any> | undefined, format: RoundFormat) {
  const desired = emptyHolesFor(format);
  const holes: Record<string, any> = { ...(existing || {}) };
  for (let i = 1; i <= 18; i++) {
    const k = String(i);
    const want = desired[k];
    const ex = holes[k];
    if (!ex || typeof ex !== "object") { holes[k] = want; continue; }
    const exInput = ex.input ?? {};

    if (format === "twoManScramble") {
      const a = exInput.teamAGross ?? null;
      const b = exInput.teamBGross ?? null;
      const aDrive = exInput.teamADrive ?? null;
      const bDrive = exInput.teamBDrive ?? null;
      holes[k] = { input: { teamAGross: a, teamBGross: b, teamADrive: aDrive, teamBDrive: bDrive } };
    } else if (format === "singles") {
      let a = exInput.teamAPlayerGross;
      let b = exInput.teamBPlayerGross;
      if (a == null && Array.isArray(exInput.teamAPlayersGross)) a = exInput.teamAPlayersGross[0] ?? null;
      if (b == null && Array.isArray(exInput.teamBPlayersGross)) b = exInput.teamBPlayersGross[0] ?? null;
      holes[k] = { input: { teamAPlayerGross: a ?? null, teamBPlayerGross: b ?? null } };
    } else if (format === "twoManShamble") {
      const aArr = Array.isArray(exInput.teamAPlayersGross) ? exInput.teamAPlayersGross : [null, null];
      const bArr = Array.isArray(exInput.teamBPlayersGross) ? exInput.teamBPlayersGross : [null, null];
      const norm2 = (arr: any[]) => [arr[0] ?? null, arr[1] ?? null];
      const aDrive = exInput.teamADrive ?? null;
      const bDrive = exInput.teamBDrive ?? null;
      holes[k] = { input: { teamAPlayersGross: norm2(aArr), teamBPlayersGross: norm2(bArr), teamADrive: aDrive, teamBDrive: bDrive } };
    } else {
      const aArr = Array.isArray(exInput.teamAPlayersGross) ? exInput.teamAPlayersGross : [null, null];
      const bArr = Array.isArray(exInput.teamBPlayersGross) ? exInput.teamBPlayersGross : [null, null];
      const norm2 = (arr: any[]) => [arr[0] ?? null, arr[1] ?? null];
      holes[k] = { input: { teamAPlayersGross: norm2(aArr), teamBPlayersGross: norm2(bArr) } };
    }
  }
  return holes;
}

export function clamp01(n: unknown) { return Number(n) === 1 ? 1 : 0; }
export function isNum(n: any): n is number { return typeof n === "number" && Number.isFinite(n); }
export function to2(arr: any[]) { return [isNum(arr?.[0]) ? arr[0] : null, isNum(arr?.[1]) ? arr[1] : null]; }
export function holesRange(obj: Record<string, any>) {
  const keys = Object.keys(obj).filter(k => /^[1-9]$|^1[0-8]$/.test(k)).map(Number);
  keys.sort((a,b)=>a-b);
  return keys;
}

export function decideHole(format: RoundFormat, i: number, match: any) {
  const h = match.holes?.[String(i)]?.input ?? {};
  if (format === "twoManScramble") {
    const { teamAGross: a, teamBGross: b } = h;
    if (!isNum(a) || !isNum(b)) return null;
    return a < b ? "teamA" : b < a ? "teamB" : "AS";
  }
  if (format === "singles") {
    const { teamAPlayerGross: aG, teamBPlayerGross: bG } = h;
    if (!isNum(aG) || !isNum(bG)) return null;
    const aNet = aG - clamp01(match.teamAPlayers?.[0]?.strokesReceived?.[i-1]);
    const bNet = bG - clamp01(match.teamBPlayers?.[0]?.strokesReceived?.[i-1]);
    return aNet < bNet ? "teamA" : bNet < aNet ? "teamB" : "AS";
  }
  if (format === "twoManShamble") {
    const aArr = to2(h.teamAPlayersGross || []);
    const bArr = to2(h.teamBPlayersGross || []);
    if (aArr[0]==null || aArr[1]==null || bArr[0]==null || bArr[1]==null) return null;

    const aBest = Math.min(aArr[0]!, aArr[1]!);
    const bBest = Math.min(bArr[0]!, bArr[1]!);
    return aBest < bBest ? "teamA" : bBest < aBest ? "teamB" : "AS";
  }
  const aArr = to2(h.teamAPlayersGross || []);
  const bArr = to2(h.teamBPlayersGross || []);
  if (aArr[0]==null || aArr[1]==null || bArr[0]==null || bArr[1]==null) return null;

  const getNet = (g:number|null, pIdx:number, teamArr:any[]) => {
    const s = clamp01(teamArr?.[pIdx]?.strokesReceived?.[i-1]);
    return g! - s;
  };
  const aBest = Math.min(getNet(aArr[0],0,match.teamAPlayers), getNet(aArr[1],1,match.teamAPlayers));
  const bBest = Math.min(getNet(bArr[0],0,match.teamBPlayers), getNet(bArr[1],1,match.teamBPlayers));

  return aBest < bBest ? "teamA" : bBest < aBest ? "teamB" : "AS";
}

export function summarize(format: RoundFormat, match: any) {
  let a = 0, b = 0, thru = 0;
  let runningMargin = 0;
  let wasTeamADown3PlusBack9 = false;
  let wasTeamAUp3PlusBack9 = false;
  const marginHistory: number[] = [];

  for (const i of holesRange(match.holes ?? {})) {
    const res = decideHole(format, i, match);
    if (res === null) continue;
    thru = Math.max(thru, i);
    if (res === "teamA") { a++; runningMargin++; }
    else if (res === "teamB") { b++; runningMargin--; }

    marginHistory.push(runningMargin);

    if (i >= 10) {
      if (runningMargin <= -3) wasTeamADown3PlusBack9 = true;
      if (runningMargin >= 3) wasTeamAUp3PlusBack9 = true;
    }
  }
  const leader = a > b ? "teamA" : b > a ? "teamB" : null;
  const margin = Math.abs(a - b);
  const holesLeft = 18 - thru;
  const closed = (leader !== null && margin > holesLeft) || thru === 18;
  const dormie = leader !== null && margin === holesLeft && thru < 18;
  const winner = (thru === 18 && a === b) ? "AS" : (leader ?? "AS");
  return {
    holesWonA: a, holesWonB: b, thru, leader, margin, dormie, closed, winner,
    wasTeamADown3PlusBack9, wasTeamAUp3PlusBack9, marginHistory
  };
}
