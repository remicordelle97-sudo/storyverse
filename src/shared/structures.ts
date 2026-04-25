// Single source of truth for the story-structure archetypes. Both the
// server (validation + random selection in routes/stories.ts and the
// prompt body lookup in services/promptBuilder.ts) and the client
// (admin picker in pages/StoryBuilder.tsx) consume this.
//
// Adding a new archetype: append an entry here and TypeScript will
// force you to add its prompt body to STRUCTURE_GUIDELINES in
// services/promptBuilder.ts.

export const STRUCTURE_LIST = [
  {
    id: "problem-solution",
    label: "Problem & Solution",
    description: "A clear problem the hero works to solve",
  },
  {
    id: "rule-of-three",
    label: "Rule of Three",
    description: "Three attempts, fail, fail, succeed",
  },
  {
    id: "cumulative",
    label: "Cumulative",
    description: "Each event builds on the last, snowball style",
  },
  {
    id: "circular",
    label: "Circular",
    description: "Ends where it began, but the hero has changed",
  },
  {
    id: "journey",
    label: "Journey & Return",
    description: "Leave home, adventure, return transformed",
  },
  {
    id: "unlikely-friendship",
    label: "Unlikely Friendship",
    description: "Two different characters discover an unexpected bond",
  },
] as const;

export type StructureId = (typeof STRUCTURE_LIST)[number]["id"];

export const STRUCTURE_IDS: StructureId[] = STRUCTURE_LIST.map((s) => s.id);

export function isStructureId(value: unknown): value is StructureId {
  return typeof value === "string" && (STRUCTURE_IDS as string[]).includes(value);
}
