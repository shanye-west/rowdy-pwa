/**
 * First-tee dates that drive the Home-page countdown, keyed by tournament id.
 *
 * Value is either a date ("YYYY-MM-DD") — counts down in days ("sleeps") on the
 * viewer's calendar — or a hard-set wall-clock tee time ("YYYY-MM-DDTHH:MM",
 * venue time like match.teeTime), which adds a live hours/minutes clock.
 * The countdown hides itself once the first tee has passed; delete the entry
 * whenever. No entry = no countdown.
 */
export const FIRST_TEE_BY_TOURNAMENT: Record<string, string> = {
  "2026ChristmasClassic": "2026-12-22",
};
