export function scoreLabel(score: number | null, par: number): string {
  if (score === null) return "";

  // Explicit hole-in-one label
  if (score === 1) return "Hole-in-One";

  const diff = score - par;

  if (diff === 0) return "Par";
  if (diff === -1) return "Birdie";
  if (diff === -2) return "Eagle";
  if (diff === -3) return "Double Eagle";

  if (diff === 1) return "Bogey";
  if (diff === 2) return "Double Bogey";
  if (diff === 3) return "Triple Bogey";
  if (diff === 4) return "Quad Bogey";

  if (diff < -3) return `${Math.abs(diff)} under par`;
  // 5+ over par just show as numeric
  return `${diff} over par`;
}
