import { describe, expect, it } from "vitest";
import { FirebaseError } from "firebase/app";
import { getErrorMessage } from "./errors";

describe("getErrorMessage", () => {
  it("unwraps FirebaseError messages (callable HttpsError)", () => {
    const err = new FirebaseError("functions/failed-precondition", "round has 4 matches");
    expect(getErrorMessage(err)).toBe("round has 4 matches");
  });

  it("unwraps plain Error messages", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("passes through non-empty strings", () => {
    expect(getErrorMessage("oops")).toBe("oops");
  });

  it("falls back for unknown values", () => {
    expect(getErrorMessage(undefined)).toBe("Something went wrong");
    expect(getErrorMessage(null, "custom fallback")).toBe("custom fallback");
    expect(getErrorMessage({ weird: true })).toBe("Something went wrong");
    expect(getErrorMessage("   ")).toBe("Something went wrong");
  });

  it("falls back when an Error has an empty message", () => {
    expect(getErrorMessage(new Error(""), "fallback")).toBe("fallback");
  });
});
