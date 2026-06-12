import type { HoleInputLoose, RoundFormat } from "../types";
import { isDriveTrackingFormat, isScrambleFormat, isSinglesFormat } from "../types";

/** Editable text state for one hole's inputs (all values as strings, "" = null) */
export interface HoleFormState {
  aGross: string;      // singles player gross OR scramble team gross
  bGross: string;
  aGross2: string;     // second player (best ball / shamble)
  bGross2: string;
  aDrive: string;      // "" | "0" | "1"
  bDrive: string;
}

export function inputToForm(input: HoleInputLoose | undefined, format: RoundFormat): HoleFormState {
  const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  if (isSinglesFormat(format)) {
    return { aGross: str(input?.teamAPlayerGross), bGross: str(input?.teamBPlayerGross), aGross2: "", bGross2: "", aDrive: "", bDrive: "" };
  }
  if (isScrambleFormat(format)) {
    return { aGross: str(input?.teamAGross), bGross: str(input?.teamBGross), aGross2: "", bGross2: "", aDrive: str(input?.teamADrive), bDrive: str(input?.teamBDrive) };
  }
  // best ball / shamble
  return {
    aGross: str(input?.teamAPlayersGross?.[0]),
    aGross2: str(input?.teamAPlayersGross?.[1]),
    bGross: str(input?.teamBPlayersGross?.[0]),
    bGross2: str(input?.teamBPlayersGross?.[1]),
    aDrive: str(input?.teamADrive),
    bDrive: str(input?.teamBDrive),
  };
}

export function formToInput(form: HoleFormState, format: RoundFormat): Record<string, unknown> {
  const num = (s: string) => (s === "" ? null : Number(s));
  if (isSinglesFormat(format)) {
    return { teamAPlayerGross: num(form.aGross), teamBPlayerGross: num(form.bGross) };
  }
  if (isScrambleFormat(format)) {
    return {
      teamAGross: num(form.aGross),
      teamBGross: num(form.bGross),
      teamADrive: num(form.aDrive),
      teamBDrive: num(form.bDrive),
    };
  }
  const input: Record<string, unknown> = {
    teamAPlayersGross: [num(form.aGross), num(form.aGross2)],
    teamBPlayersGross: [num(form.bGross), num(form.bGross2)],
  };
  if (isDriveTrackingFormat(format)) {
    input.teamADrive = num(form.aDrive);
    input.teamBDrive = num(form.bDrive);
  }
  return input;
}
