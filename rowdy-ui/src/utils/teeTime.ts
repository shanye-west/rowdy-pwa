import type { FirestoreTimestampLike } from "../types";
import { toDateOrNull } from "../utils";
import { EVENT_TIME_ZONE, isoToZonedInput } from "./timeZone";

/**
 * Tee times are stored as a hard-set wall-clock string ("YYYY-MM-DDTHH:MM", the
 * exact value the datetime-local picker produces, with no timezone). Nothing is
 * converted, so what an admin types is what every viewer sees.
 */

/** datetime-local value ("YYYY-MM-DDTHH:MM") → the value stored on the match. */
export function localInputToStored(value: string): string {
  return value;
}

/** Stored tee time → datetime-local value for pre-filling the admin picker. */
export function storedToLocalInput(teeTime: FirestoreTimestampLike | undefined): string {
  // New data is already a wall-clock string ("YYYY-MM-DDTHH:MM[:SS]").
  if (typeof teeTime === "string" && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(teeTime)) {
    return teeTime.slice(0, 16);
  }
  // Legacy absolute instant (old Timestamp/ISO): render in the venue zone.
  const date = toDateOrNull(teeTime ?? null);
  if (!date) return "";
  return isoToZonedInput(date, EVENT_TIME_ZONE);
}
