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

const AGE_GUIDELINES: Record<string, string> = {
  "2-4": `WRITING LEVEL — Ages 2-4:
- Use very short, simple sentences (5-8 words each)
- Only use words a toddler would know — no abstract concepts
- Repeat key phrases and patterns for comfort ("And Leo walked. Leo walked and walked.")
- Each scene should be 2-3 short paragraphs at most
- No conflict, tension, or scary moments — everything is gentle and safe
- Focus on sensory details: colours, sounds, textures, animals
- Characters express only simple emotions: happy, sad, surprised, sleepy
- End scenes with warmth, hugs, or bedtime cues`,

  "5-7": `WRITING LEVEL — Ages 5-7:
- Use short paragraphs with clear, vivid sentences (8-15 words)
- Introduce some new vocabulary but explain it through context ("a lantern — a special light you can carry")
- Gentle tension is OK (a mild problem to solve) but resolve it quickly within the same scene or the next
- Each scene should be 3-5 paragraphs
- Characters can feel excited, nervous, proud, or disappointed — but nothing overwhelming
- Use light humour, funny sounds, and playful dialogue
- Include moments of wonder and discovery
- Always resolve uncertainty before the story ends`,

  "8-10": `WRITING LEVEL — Ages 8-10:
- Use richer, more varied sentence structure and vocabulary
- Paragraphs can be longer (4-6 sentences) with more descriptive detail
- Real stakes and challenges are OK — characters can struggle, fail, and try again
- Each scene should be 4-7 paragraphs
- Characters can experience complex emotions: embarrassment, jealousy, guilt, determination
- Dialogue can be witty and show distinct character voices
- Subplots and mysteries are welcome — foreshadow and pay off details
- Themes can include fairness, responsibility, and standing up for others
- The ending should feel earned, not handed to the characters`,
};

export function buildSystemPrompt(ageGroup: string): string {
  const guidelines = AGE_GUIDELINES[ageGroup] || AGE_GUIDELINES["5-7"];

  return `You are a gentle, imaginative children's story writer.
You write short, age-appropriate stories that are warm and satisfying.
Always stay true to each character's established personality and appearance.
Never introduce plot threads you cannot resolve within this story.
End every story with a sense of calm, comfort, or small triumph.
Return ONLY valid JSON. No markdown fences, no preamble, no explanation.

${guidelines}`;
}

export interface BuiltPrompt {
  userMessage: string;
  ageGroup: string;
}

export async function buildPrompt(input: PromptInput): Promise<BuiltPrompt> {
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

  return { userMessage: prompt, ageGroup: child.ageGroup };
}
