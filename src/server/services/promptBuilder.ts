import prisma from "../lib/prisma.js";

interface PromptInput {
  universeId: string;
  childId: string;
  characterIds: string[];
  mood: string;
  language: string;
  length: "short" | "medium" | "long";
  parentPrompt: string;
}

export const SYSTEM_PROMPT = `You are a gentle, imaginative children's story writer.
You write short, age-appropriate stories that are warm and satisfying.
Always stay true to each character's established personality and appearance.
Never introduce plot threads you cannot resolve within this story.
End every story with a sense of calm, comfort, or small triumph.
Return ONLY valid JSON. No markdown fences, no preamble, no explanation.`;

export async function buildPrompt(input: PromptInput): Promise<string> {
  const universe = await prisma.universe.findUniqueOrThrow({
    where: { id: input.universeId },
  });

  const characters = await prisma.character.findMany({
    where: { id: { in: input.characterIds } },
    include: {
      relationshipsA: { include: { characterB: true } },
      relationshipsB: { include: { characterA: true } },
    },
  });

  const child = await prisma.child.findUniqueOrThrow({
    where: { id: input.childId },
  });

  // Fetch timeline: all major events + last 8 overall, deduplicated
  const recentEvents = await prisma.timelineEvent.findMany({
    where: { universeId: input.universeId },
    orderBy: { storyDate: "desc" },
    take: 8,
    include: { character: true },
  });

  const majorEvents = await prisma.timelineEvent.findMany({
    where: { universeId: input.universeId, significance: "major" },
    orderBy: { storyDate: "desc" },
    include: { character: true },
  });

  // Merge and deduplicate
  const eventMap = new Map<string, (typeof recentEvents)[0]>();
  for (const e of [...recentEvents, ...majorEvents]) {
    eventMap.set(e.id, e);
  }
  const allEvents = Array.from(eventMap.values()).sort(
    (a, b) => b.storyDate.getTime() - a.storyDate.getTime()
  );

  // Build the featured character IDs set for relationship filtering
  const featuredIds = new Set(input.characterIds);

  // Collect relationships between featured characters
  const relationships: string[] = [];
  for (const char of characters) {
    for (const rel of char.relationshipsA) {
      if (featuredIds.has(rel.characterBId)) {
        relationships.push(
          `${char.name} and ${rel.characterB.name}: ${rel.description}`
        );
      }
    }
  }

  const lengthMap = { short: 3, medium: 5, long: 7 };

  let prompt = `=== UNIVERSE ===
Name: ${universe.name}
Setting: ${universe.settingDescription}
Themes: ${universe.themes}
Mood: ${universe.mood}
Avoid: ${universe.avoidThemes}

=== CHARACTERS ===
`;

  for (const char of characters) {
    prompt += `Name: ${char.name} (${char.speciesOrType})
Personality: ${char.personalityTraits}
Appearance: ${char.appearance}
Special detail: ${char.specialDetail}
Role: ${char.role}

`;
  }

  if (relationships.length > 0) {
    prompt += `=== RELATIONSHIPS ===\n`;
    for (const rel of relationships) {
      prompt += `${rel}\n`;
    }
    prompt += `\n`;
  }

  if (allEvents.length > 0) {
    prompt += `=== RECENT HISTORY (do not contradict these events) ===\n`;
    for (const event of allEvents) {
      prompt += `[${event.character.name}] ${event.eventSummary} (${event.significance})\n`;
    }
    prompt += `\n`;
  }

  prompt += `=== STORY REQUEST ===
Child: ${child.name}, age ${child.age}
Reading level: ${child.ageGroup}
Language: ${input.language}
Mood: ${input.mood}
Length: ${input.length} (short=3 scenes, medium=5 scenes, long=7 scenes)
Parent's request: "${input.parentPrompt}"

=== OUTPUT FORMAT ===
Return exactly this JSON structure and nothing else:
{
  "title": "Story title",
  "scenes": [
    {
      "scene_number": 1,
      "content": "Full scene text here...",
      "image_prompt": "Detailed visual description for illustration generation"
    }
  ],
  "timeline_events": [
    {
      "character_name": "Leo",
      "event_summary": "Leo found an ancient map hidden behind the waterfall",
      "significance": "major"
    }
  ]
}`;

  return prompt;
}
