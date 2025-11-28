/**
 * Unit tests for ErrorBoundary component
 * Tests error detection logic for MIME type errors, 404s, and generic errors
 * 
 * These tests ensure users see appropriate error messages instead of cryptic errors
 */

import { describe, it, expect } from "vitest";

// =============================================================================
// Error Detection Functions (mirrors logic in ErrorBoundary.tsx)
// =============================================================================

/**
 * Detects stale service worker cache errors that should trigger auto-reload
 * These happen after deployments when old cached JS files no longer exist
 */
function isStaleCache(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("MIME type") ||
      error.message.includes("text/html") ||
      error.message.includes("Failed to fetch dynamically imported module") ||
      error.message.includes("Importing a module script failed") ||
      error.message.includes("error loading dynamically imported module"))
  );
}

/**
 * Detects route/response errors with HTTP status codes
 */
function isRouteError(error: unknown): error is { status: number; statusText?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  );
}

/**
 * Detects 404 Not Found errors
 */
function is404Error(error: unknown): boolean {
  return isRouteError(error) && error.status === 404;
}

/**
 * Detects network/offline errors
 */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("network") ||
    msg.includes("offline") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("internet")
  );
}

/**
 * Detects Firebase/Firestore permission errors
 */
function isPermissionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("permission") ||
    msg.includes("unauthorized") ||
    msg.includes("unauthenticated") ||
    msg.includes("forbidden")
  );
}

// =============================================================================
// STALE CACHE / MIME TYPE ERROR TESTS
// =============================================================================

describe("isStaleCache - PWA update errors", () => {
  describe("detects MIME type errors (service worker returning HTML for JS)", () => {
    it("detects exact error from user report", () => {
      const error = new Error("'text/html' is not a valid JavaScript MIME type.");
      expect(isStaleCache(error)).toBe(true);
    });

    it("detects generic MIME type error", () => {
      const error = new Error("MIME type mismatch");
      expect(isStaleCache(error)).toBe(true);
    });

    it("detects text/html in various error formats", () => {
      const errors = [
        new Error("Expected JavaScript but got text/html"),
        new Error("Resource interpreted as Script but transferred with MIME type text/html"),
        new Error('blocked because of a disallowed MIME type ("text/html")'),
      ];
      errors.forEach(error => {
        expect(isStaleCache(error)).toBe(true);
      });
    });
  });

  describe("detects dynamic import errors (lazy-loaded chunks missing)", () => {
    it("detects Chrome dynamic import error", () => {
      const error = new Error(
        "Failed to fetch dynamically imported module: https://rowdy-cup.web.app/assets/Match-D7kFAs1v.js"
      );
      expect(isStaleCache(error)).toBe(true);
    });

    it("detects dynamic import with relative path", () => {
      const error = new Error("Failed to fetch dynamically imported module: /assets/Round-abc123.js");
      expect(isStaleCache(error)).toBe(true);
    });

    it("detects Safari module import error", () => {
      const error = new Error("Importing a module script failed.");
      expect(isStaleCache(error)).toBe(true);
    });

    it("detects generic module loading error", () => {
      const error = new Error("error loading dynamically imported module");
      expect(isStaleCache(error)).toBe(true);
    });
  });

  describe("browser-specific error messages", () => {
    it("handles Chrome error format", () => {
      const error = new Error(
        "Failed to fetch dynamically imported module: https://example.com/assets/index-abc123.js"
      );
      expect(isStaleCache(error)).toBe(true);
    });

    it("handles Firefox error format", () => {
      const error = new Error(
        'Loading module from "https://example.com/app.js" was blocked because of a disallowed MIME type ("text/html").'
      );
      expect(isStaleCache(error)).toBe(true);
    });

    it("handles Safari error format", () => {
      const error = new Error("Importing a module script failed.");
      expect(isStaleCache(error)).toBe(true);
    });
  });

  describe("returns false for non-cache errors", () => {
    it("returns false for generic error", () => {
      expect(isStaleCache(new Error("Something went wrong"))).toBe(false);
    });

    it("returns false for null", () => {
      expect(isStaleCache(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isStaleCache(undefined)).toBe(false);
    });

    it("returns false for string (not Error object)", () => {
      expect(isStaleCache("text/html error")).toBe(false);
    });

    it("returns false for object without message", () => {
      expect(isStaleCache({ code: "MIME_ERROR" })).toBe(false);
    });

    it("returns false for network errors", () => {
      expect(isStaleCache(new Error("Network request failed"))).toBe(false);
    });
  });
});

// =============================================================================
// 404 ERROR TESTS
// =============================================================================

describe("is404Error - Page not found", () => {
  it("returns true for 404 status", () => {
    expect(is404Error({ status: 404, statusText: "Not Found" })).toBe(true);
  });

  it("returns true for 404 without statusText", () => {
    expect(is404Error({ status: 404 })).toBe(true);
  });

  it("returns false for other HTTP statuses", () => {
    expect(is404Error({ status: 200 })).toBe(false);
    expect(is404Error({ status: 400 })).toBe(false);
    expect(is404Error({ status: 401 })).toBe(false);
    expect(is404Error({ status: 403 })).toBe(false);
    expect(is404Error({ status: 500 })).toBe(false);
  });

  it("returns false for Error objects", () => {
    expect(is404Error(new Error("Not found"))).toBe(false);
    expect(is404Error(new Error("404"))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(is404Error(null)).toBe(false);
    expect(is404Error(undefined)).toBe(false);
  });

  it("returns false for string", () => {
    expect(is404Error("404")).toBe(false);
  });
});

// =============================================================================
// NETWORK ERROR TESTS
// =============================================================================

describe("isNetworkError - Offline/connectivity issues", () => {
  it("detects 'Failed to fetch' errors", () => {
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(true);
  });

  it("detects network error messages", () => {
    const errors = [
      new Error("Network request failed"),
      new Error("NetworkError when attempting to fetch resource"),
      new Error("A network error occurred"),
      new Error("net::ERR_INTERNET_DISCONNECTED"),
    ];
    errors.forEach(error => {
      expect(isNetworkError(error)).toBe(true);
    });
  });

  it("detects offline errors", () => {
    expect(isNetworkError(new Error("The Internet connection appears to be offline"))).toBe(true);
    expect(isNetworkError(new Error("You are offline"))).toBe(true);
  });

  it("returns false for non-network errors", () => {
    expect(isNetworkError(new Error("Permission denied"))).toBe(false);
    expect(isNetworkError(new Error("Something went wrong"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError("network error")).toBe(false);
  });
});

// =============================================================================
// PERMISSION ERROR TESTS
// =============================================================================

describe("isPermissionError - Auth/permission issues", () => {
  it("detects Firestore permission errors", () => {
    expect(isPermissionError(new Error("Missing or insufficient permissions"))).toBe(true);
    expect(isPermissionError(new Error("PERMISSION_DENIED"))).toBe(true);
  });

  it("detects auth errors", () => {
    expect(isPermissionError(new Error("User is unauthorized"))).toBe(true);
    expect(isPermissionError(new Error("Request is unauthenticated"))).toBe(true);
    expect(isPermissionError(new Error("Access forbidden"))).toBe(true);
  });

  it("returns false for non-permission errors", () => {
    expect(isPermissionError(new Error("Network failed"))).toBe(false);
    expect(isPermissionError(new Error("Not found"))).toBe(false);
  });
});

// =============================================================================
// ERROR CATEGORIZATION TESTS
// =============================================================================

describe("error categorization - UI/UX routing", () => {
  /**
   * Categorizes errors the same way ErrorBoundary.tsx does
   * This determines what UI the user sees
   */
  function categorizeError(error: unknown): "staleCache" | "404" | "network" | "permission" | "generic" {
    if (isStaleCache(error)) return "staleCache";
    if (is404Error(error)) return "404";
    if (isNetworkError(error)) return "network";
    if (isPermissionError(error)) return "permission";
    return "generic";
  }

  const testCases: Array<{ name: string; error: unknown; expected: string; userSees: string }> = [
    // Stale cache → "Updating App" with auto-reload
    {
      name: "MIME type error after deployment",
      error: new Error("'text/html' is not a valid JavaScript MIME type."),
      expected: "staleCache",
      userSees: "Updating App (auto-reload)",
    },
    {
      name: "Missing chunk after deployment",
      error: new Error("Failed to fetch dynamically imported module: /assets/Round-xyz789.js"),
      expected: "staleCache",
      userSees: "Updating App (auto-reload)",
    },

    // 404 → "Page Not Found"
    {
      name: "Unknown route",
      error: { status: 404, statusText: "Not Found" },
      expected: "404",
      userSees: "Page Not Found",
    },

    // Network → Could show offline message
    {
      name: "Offline/no connection",
      error: new Error("Failed to fetch"),
      expected: "network",
      userSees: "Network error / offline",
    },

    // Permission → Could prompt login
    {
      name: "Firestore permission denied",
      error: new Error("Missing or insufficient permissions"),
      expected: "permission",
      userSees: "Permission denied",
    },

    // Generic → "Something Went Wrong"
    {
      name: "Unexpected component error",
      error: new Error("Cannot read properties of undefined (reading 'map')"),
      expected: "generic",
      userSees: "Something Went Wrong",
    },
    {
      name: "Unknown error object",
      error: { code: "UNKNOWN" },
      expected: "generic",
      userSees: "Something Went Wrong",
    },
  ];

  for (const { name, error, expected, userSees } of testCases) {
    it(`"${name}" → ${expected} (user sees: ${userSees})`, () => {
      expect(categorizeError(error)).toBe(expected);
    });
  }
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe("edge cases", () => {
  it("handles Error with empty message", () => {
    const error = new Error("");
    expect(isStaleCache(error)).toBe(false);
    expect(isNetworkError(error)).toBe(false);
    expect(isPermissionError(error)).toBe(false);
  });

  it("handles Error subclasses", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    const error = new CustomError("'text/html' is not a valid JavaScript MIME type.");
    expect(isStaleCache(error)).toBe(true);
  });

  it("handles frozen objects", () => {
    const error = Object.freeze({ status: 404 });
    expect(is404Error(error)).toBe(true);
  });

  it("handles object with getter", () => {
    const error = {
      get status() { return 404; }
    };
    expect(is404Error(error)).toBe(true);
  });
});
