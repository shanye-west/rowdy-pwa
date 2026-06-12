import { FirebaseError } from "firebase/app";

/**
 * Extract a human-readable message from an unknown error.
 * Callable HttpsErrors arrive as FirebaseError with the server's message;
 * plain Errors use their message; anything else gets the fallback.
 */
export function getErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof FirebaseError) {
    return err.message || fallback;
  }
  if (err instanceof Error) {
    return err.message || fallback;
  }
  if (typeof err === "string" && err.trim()) {
    return err;
  }
  return fallback;
}
