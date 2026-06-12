import { describe, expect, it } from "vitest";
import { formToInput, inputToForm } from "./holeInputForm";

describe("inputToForm", () => {
  it("maps singles input", () => {
    expect(inputToForm({ teamAPlayerGross: 4, teamBPlayerGross: null }, "singles")).toEqual({
      aGross: "4", bGross: "", aGross2: "", bGross2: "", aDrive: "", bDrive: "",
    });
  });

  it("maps scramble input incl. drives", () => {
    expect(inputToForm({ teamAGross: 5, teamBGross: 4, teamADrive: 0, teamBDrive: 1 }, "twoManScramble")).toEqual({
      aGross: "5", bGross: "4", aGross2: "", bGross2: "", aDrive: "0", bDrive: "1",
    });
  });

  it("maps best ball / shamble pairs", () => {
    expect(
      inputToForm({ teamAPlayersGross: [4, null], teamBPlayersGross: [5, 6], teamADrive: 1 }, "twoManShamble")
    ).toEqual({ aGross: "4", aGross2: "", bGross: "5", bGross2: "6", aDrive: "1", bDrive: "" });
  });

  it("handles missing input", () => {
    expect(inputToForm(undefined, "singles")).toEqual({
      aGross: "", bGross: "", aGross2: "", bGross2: "", aDrive: "", bDrive: "",
    });
  });
});

describe("formToInput", () => {
  const empty = { aGross: "", bGross: "", aGross2: "", bGross2: "", aDrive: "", bDrive: "" };

  it("builds singles input with nulls for blanks", () => {
    expect(formToInput({ ...empty, aGross: "4" }, "singles")).toEqual({
      teamAPlayerGross: 4,
      teamBPlayerGross: null,
    });
  });

  it("builds scramble input with drives", () => {
    expect(formToInput({ ...empty, aGross: "5", bGross: "4", aDrive: "0", bDrive: "1" }, "fourManScramble")).toEqual({
      teamAGross: 5, teamBGross: 4, teamADrive: 0, teamBDrive: 1,
    });
  });

  it("builds best ball input without drive fields", () => {
    const input = formToInput({ ...empty, aGross: "4", aGross2: "5", bGross: "6" }, "twoManBestBall");
    expect(input).toEqual({
      teamAPlayersGross: [4, 5],
      teamBPlayersGross: [6, null],
    });
  });

  it("includes drives for shamble", () => {
    const input = formToInput({ ...empty, aGross: "4", aDrive: "1" }, "twoManShamble");
    expect(input.teamADrive).toBe(1);
    expect(input.teamBDrive).toBeNull();
  });

  it("round-trips through inputToForm", () => {
    const form = { aGross: "4", aGross2: "5", bGross: "3", bGross2: "", aDrive: "0", bDrive: "", };
    const roundTripped = inputToForm(formToInput(form, "twoManShamble"), "twoManShamble");
    expect(roundTripped).toEqual(form);
  });
});
