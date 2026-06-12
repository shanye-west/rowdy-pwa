/**
 * Pure validation/decision logic for admin callables. No firebase imports so
 * these can be unit-tested directly (the callables are thin I/O shells).
 */

export interface HoleInfoInput {
  number: number;
  par: number;
  hcpIndex: number;
  yards?: number;
}

export interface CourseInput {
  name: string;
  tees?: string;
  par: number;
  rating: number;
  slope: number;
  holes: HoleInfoInput[];
}

export interface CourseValidationResult {
  ok: boolean;
  errors: string[];
  course?: CourseInput;
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate a full course payload (create or update — courses are always
 * written whole so the 18-hole invariants hold).
 *
 * Rules: exactly 18 holes; hole numbers 1-18 each exactly once; par 3-6 per
 * hole; hcpIndex 1-18 each exactly once; optional yards >= 0; slope 55-155;
 * rating 50-90; course par must equal the sum of hole pars and land in 60-80.
 */
export function validateCourseInput(data: unknown): CourseValidationResult {
  const errors: string[] = [];
  if (typeof data !== "object" || data === null) {
    return { ok: false, errors: ["course payload must be an object"] };
  }
  const d = data as Record<string, unknown>;

  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (!name) errors.push("name is required");

  let tees: string | undefined;
  if (d.tees !== undefined && d.tees !== null && d.tees !== "") {
    if (typeof d.tees !== "string") errors.push("tees must be a string");
    else tees = d.tees.trim();
  }

  if (!isFiniteNumber(d.rating) || d.rating < 50 || d.rating > 90) {
    errors.push("rating must be a number between 50 and 90");
  }
  if (!isFiniteNumber(d.slope) || d.slope < 55 || d.slope > 155) {
    errors.push("slope must be a number between 55 and 155");
  }
  if (!isInt(d.par) || d.par < 60 || d.par > 80) {
    errors.push("par must be an integer between 60 and 80");
  }

  const holes: HoleInfoInput[] = [];
  if (!Array.isArray(d.holes) || d.holes.length !== 18) {
    errors.push("holes must be an array of exactly 18 entries");
  } else {
    const seenNumbers = new Set<number>();
    const seenHcp = new Set<number>();
    d.holes.forEach((raw, i) => {
      const label = `holes[${i}]`;
      if (typeof raw !== "object" || raw === null) {
        errors.push(`${label} must be an object`);
        return;
      }
      const h = raw as Record<string, unknown>;
      if (!isInt(h.number) || h.number < 1 || h.number > 18) {
        errors.push(`${label}.number must be an integer 1-18`);
      } else if (seenNumbers.has(h.number)) {
        errors.push(`${label}.number ${h.number} is duplicated`);
      } else {
        seenNumbers.add(h.number);
      }
      if (!isInt(h.par) || h.par < 3 || h.par > 6) {
        errors.push(`${label}.par must be an integer 3-6`);
      }
      if (!isInt(h.hcpIndex) || h.hcpIndex < 1 || h.hcpIndex > 18) {
        errors.push(`${label}.hcpIndex must be an integer 1-18`);
      } else if (seenHcp.has(h.hcpIndex)) {
        errors.push(`${label}.hcpIndex ${h.hcpIndex} is duplicated`);
      } else {
        seenHcp.add(h.hcpIndex);
      }
      let yards: number | undefined;
      if (h.yards !== undefined && h.yards !== null) {
        if (!isInt(h.yards) || h.yards < 0) {
          errors.push(`${label}.yards must be a non-negative integer`);
        } else {
          yards = h.yards;
        }
      }
      holes.push({
        number: h.number as number,
        par: h.par as number,
        hcpIndex: h.hcpIndex as number,
        ...(yards !== undefined ? { yards } : {}),
      });
    });

    if (errors.length === 0 && isInt(d.par)) {
      const parSum = holes.reduce((sum, h) => sum + h.par, 0);
      if (parSum !== d.par) {
        errors.push(`par (${d.par}) must equal the sum of hole pars (${parSum})`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    errors: [],
    course: {
      name,
      ...(tees ? { tees } : {}),
      par: d.par as number,
      rating: d.rating as number,
      slope: d.slope as number,
      holes: [...holes].sort((a, b) => a.number - b.number),
    },
  };
}

/**
 * deleteRound precondition: a round with matches may only be deleted with
 * force=true (the UI shows the count and re-calls with force).
 * Returns null when deletion may proceed, otherwise the block message.
 */
export function describeRoundDeletionBlock(matchCount: number, force: boolean): string | null {
  if (matchCount > 0 && !force) {
    return `Round has ${matchCount} match${matchCount === 1 ? "" : "es"}. Deleting it removes them and their stats. Confirm to proceed.`;
  }
  return null;
}

interface TournamentTeamRefs {
  rosterByTier?: Record<string, string[] | undefined>;
  handicapByPlayer?: Record<string, number>;
}

export interface TournamentRefs {
  id: string;
  teamA?: TournamentTeamRefs;
  teamB?: TournamentTeamRefs;
}

function teamReferencesPlayer(team: TournamentTeamRefs | undefined, playerId: string): boolean {
  if (!team) return false;
  const inRoster = Object.values(team.rosterByTier ?? {}).some((ids) => ids?.includes(playerId));
  const inHandicaps = Object.prototype.hasOwnProperty.call(team.handicapByPlayer ?? {}, playerId);
  return inRoster || inHandicaps;
}

/**
 * deletePlayer precondition scan: tournaments whose roster or handicap map
 * still reference the player. (Open matches without playerMatchFacts are not
 * queryable by nested playerId — this roster scan is the practical guard.)
 */
export function playerTournamentReferences(playerId: string, tournaments: TournamentRefs[]): string[] {
  return tournaments
    .filter((t) => teamReferencesPlayer(t.teamA, playerId) || teamReferencesPlayer(t.teamB, playerId))
    .map((t) => t.id);
}

/**
 * setPlayerAdmin guard: an admin may not remove their own admin flag
 * (prevents locking everyone out when there is a single admin).
 */
export function isSelfDemotion(callerPlayerId: string, targetPlayerId: string, isAdmin: boolean): boolean {
  return !isAdmin && callerPlayerId === targetPlayerId;
}
