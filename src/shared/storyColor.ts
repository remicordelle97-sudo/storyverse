// Deterministic story-cover colors. Both palettes are kept in 1:1
// order so the same story id maps to the same color slot in the
// Library bookshelf (Tailwind class) and the ReadingMode page-flip
// cover (hex). Touch them together.
const PALETTE_TAILWIND = [
  "bg-red-700",
  "bg-blue-800",
  "bg-emerald-700",
  "bg-purple-800",
  "bg-amber-700",
  "bg-rose-700",
  "bg-indigo-800",
  "bg-teal-700",
  "bg-orange-700",
  "bg-cyan-800",
  "bg-violet-800",
  "bg-sky-700",
];

const PALETTE_HEX = [
  "#b91c1c",
  "#1e40af",
  "#047857",
  "#6b21a8",
  "#b45309",
  "#be123c",
  "#3730a3",
  "#0f766e",
  "#c2410c",
  "#0e7490",
  "#5b21b6",
  "#0369a1",
];

function indexFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % PALETTE_TAILWIND.length;
}

export function storyTailwindColor(id: string): string {
  return PALETTE_TAILWIND[indexFor(id)];
}

export function storyHexColor(id: string): string {
  return PALETTE_HEX[indexFor(id)];
}
