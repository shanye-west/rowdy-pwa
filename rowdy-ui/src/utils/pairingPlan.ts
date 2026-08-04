/**
 * Helpers for a captain's private pairing plan — the pre-draft sandbox where
 * one team lays out how they intend to pair their own side.
 *
 * The plan is only a plan: nothing here writes to the draft, and the real
 * validation still happens server-side when picks are made. These functions
 * mirror the same A/A + D/D tier rule so a captain can't spend the pre-round
 * hours on a board that the draft would refuse.
 */

import { isPairableRemainder, pairTierViolation } from "./pairingDraft";

export type TierMapLookup = Record<string, "A" | "B" | "C" | "D">;

/**
 * Fit a stored pair list to the round's shape: exactly `slotCount` slots, each
 * holding at most `perSide` ids. Availability can change between saves (a
 * player gets benched, the format changes), so a loaded plan is always squared
 * up against the current round rather than trusted as-is.
 */
export function normalizePairs(
  pairs: string[][] | undefined,
  slotCount: number,
  perSide: number,
  allowedIds?: Set<string>
): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < slotCount; i++) {
    const raw = pairs?.[i] ?? [];
    const slot: string[] = [];
    for (const pid of raw) {
      if (slot.length >= perSide) break;
      if (seen.has(pid)) continue;
      if (allowedIds && !allowedIds.has(pid)) continue;
      seen.add(pid);
      slot.push(pid);
    }
    out.push(slot);
  }
  return out;
}

/** Available players not yet placed in a slot, in the given order. */
export function unassignedIds(available: string[], pairs: string[][]): string[] {
  const placed = new Set(pairs.flat());
  return available.filter((id) => !placed.has(id));
}

/** Reason a slot is illegal (A/A or D/D), or null. Full slots only. */
export function slotViolation(slot: string[], perSide: number, tiers: TierMapLookup): string | null {
  if (slot.length !== perSide) return null;
  return pairTierViolation(slot, tiers);
}

/**
 * Reason adding `candidateId` to `slot` would be illegal, or null. Lets the
 * pool pre-disable a second A (or second D) for the slot being filled, the
 * same way the live draft's pick panel does.
 */
export function cannotAddToSlot(
  slot: string[],
  candidateId: string,
  perSide: number,
  tiers: TierMapLookup
): string | null {
  if (slot.length >= perSide) return "That matchup is full";
  if (perSide !== 2) return null;
  const tier = tiers[candidateId];
  if (tier !== "A" && tier !== "D") return null;
  if (!slot.some((id) => tiers[id] === tier)) return null;
  return tier === "A" ? "Can't pair two A-tier players" : "Can't pair two D-tier players";
}

/**
 * Advisory warning when the players still on the bench can't legally fill the
 * slots that still have room — e.g. three A-tier left for two open matchups.
 * Soft by design: individual illegal drops are already blocked, so this only
 * flags a plan that's painted itself into a corner.
 */
export function planStrandWarning(
  pairs: string[][],
  available: string[],
  perSide: number,
  tiers: TierMapLookup
): string | null {
  if (perSide !== 2) return null;
  const left = unassignedIds(available, pairs);
  if (left.length === 0) return null;
  const slotsWithRoom = pairs.filter((s) => s.length < perSide).length;
  if (isPairableRemainder(left, slotsWithRoom, tiers)) return null;
  return "The players you have left can't be paired legally — no two A-tier and no two D-tier can go together.";
}

/** True when the two plans differ (order-sensitive within a slot is ignored). */
export function pairsEqual(a: string[][], b: string[][]): boolean {
  if (a.length !== b.length) return false;
  return a.every((slot, i) => {
    const other = b[i];
    if (slot.length !== other.length) return false;
    const s1 = [...slot].sort();
    const s2 = [...other].sort();
    return s1.every((id, j) => id === s2[j]);
  });
}
