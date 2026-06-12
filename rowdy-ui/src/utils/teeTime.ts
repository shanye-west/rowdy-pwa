import type { FirestoreTimestampLike } from "../types";
import { toDateOrNull } from "../utils";

/**
 * Tee times are entered and displayed as Pacific Time. The datetime-local
 * input has no timezone, so we pin the offset when converting.
 * Note: hardcodes -08:00 (PST) like the original admin pages — known
 * follow-up for PDT events.
 */

/** datetime-local value ("YYYY-MM-DDTHH:MM") → ISO string for the callables. */
export function localInputToIso(value: string): string {
  return new Date(value + "-08:00").toISOString();
}

/** Stored tee time → datetime-local value rendered in Pacific Time ("" if unset). */
export function teeTimeToLocalInput(teeTime: FirestoreTimestampLike | undefined): string {
  const date = toDateOrNull(teeTime ?? null);
  if (!date) return "";
  const pacificDate = new Date(date.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const year = pacificDate.getFullYear();
  const month = String(pacificDate.getMonth() + 1).padStart(2, "0");
  const day = String(pacificDate.getDate()).padStart(2, "0");
  const hours = String(pacificDate.getHours()).padStart(2, "0");
  const minutes = String(pacificDate.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
