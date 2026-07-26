import { describe, it, expect } from "vitest";
import { teeStyle } from "./teeColors";

describe("teeStyle", () => {
  it("returns null when there is no tee name", () => {
    expect(teeStyle(undefined)).toBeNull();
    expect(teeStyle(null)).toBeNull();
    expect(teeStyle("")).toBeNull();
  });

  it("returns null when no word is a color it knows", () => {
    expect(teeStyle("Championship")).toBeNull();
    expect(teeStyle("Members")).toBeNull();
  });

  it("matches a plain color name", () => {
    expect(teeStyle("Black")?.background).toBe("#111827");
    expect(teeStyle("blue")?.background).toBe("#1d4ed8");
  });

  it("finds the color inside a longer tee name", () => {
    // The real French Lick / Donald Ross tee.
    const style = teeStyle("Bronze Ross");
    expect(style?.background).toBe("#8c6239");
    expect(style?.stripe).toBeUndefined();
  });

  it("keeps both colors of a combo tee, in order", () => {
    const style = teeStyle("Gold/Blue");
    expect(style?.background).toBe("#b8860b");
    expect(style?.stripe).toBe("#1d4ed8");
  });

  it("does not repeat a color that appears twice", () => {
    expect(teeStyle("Blue/Blue")?.stripe).toBeUndefined();
  });

  it("uses light text on dark tees and dark text on light tees", () => {
    expect(teeStyle("Black")?.text).toBe("#ffffff");
    expect(teeStyle("Blue")?.text).toBe("#ffffff");
    expect(teeStyle("Bronze Ross")?.text).toBe("#ffffff");
    expect(teeStyle("White")?.text).toBe("#0f172a");
    expect(teeStyle("Gold")?.text).toBe("#0f172a");
    expect(teeStyle("Silver")?.text).toBe("#0f172a");
  });

  it("derives the divider from the text color", () => {
    expect(teeStyle("Black")?.border).toContain("#ffffff");
    expect(teeStyle("White")?.border).toContain("#0f172a");
  });
});
