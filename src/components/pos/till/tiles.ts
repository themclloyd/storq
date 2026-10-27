// Solid counter tiles, the way Square for Retail paints an item without a
// photo: one flat saturated block per item, white type, a two-letter monogram.
// The tone is derived from the name so an item keeps its colour between
// renders, devices and reloads without a stored field.

const TONES = ["bg-tile-1", "bg-tile-2", "bg-tile-3", "bg-tile-4", "bg-tile-5", "bg-tile-6"];

export function tileTone(seed: string): string {
  let sum = 0;
  for (const ch of seed) sum += ch.charCodeAt(0);
  return TONES[sum % TONES.length]!;
}

/** Up to two initials: "Sugar 1kg" → "S1", "Milk" → "MI". */
export function tileInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "•";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
