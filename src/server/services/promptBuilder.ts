import prisma from "../lib/prisma.js";

interface PromptInput {
  universeId: string;
  childId: string;
  characterIds: string[];
  mood: string;
  language: string;
  structure: string;
  length: "short" | "long";
  parentPrompt: string;
}

const AGE_GUIDELINES: Record<string, string> = {
  "2-3": `WRITING LEVEL — Ages 2-3 (Toddler):
- Each page has 1-2 short sentences (5-8 words each).
- Only use words a toddler would know — no abstract concepts.
- Repeat key phrases throughout the story as a refrain the child can anticipate and join in on. For example: "And off they went, step by step!" should appear at least 3 times.
- No conflict, tension, or scary moments — everything is gentle and safe.
- Focus on sensory details: describe colours, sounds, textures, smells ("the warm, soft sand", "the bright red flower").
- Characters express only simple emotions: happy, sad, surprised, sleepy. SHOW emotions through actions ("Leo's tail wagged") not labels ("Leo felt happy").
- Use short punchy sentences during movement and longer gentle ones during rest.
- End with warmth, hugs, or bedtime cues.`,

  "4-5": `WRITING LEVEL — Ages 4-5 (Early Reader):
- Each page has 2-4 sentences.
- Use clear, vivid sentences (8-15 words). Introduce some new vocabulary but explain through context ("a lantern — a special light you can carry").
- Include a recurring phrase or refrain that appears at key moments — something the child can predict and say along with the reader.
- Gentle tension is OK (a lost item, a small misunderstanding) but resolve it within a few pages.
- SHOW emotions through actions, body language, and dialogue — never state them. Write "Zuri's ears flattened and she stepped behind Leo" not "Zuri felt scared."
- Include at least 2-3 sensory details per page: what things look, sound, smell, feel, or taste like.
- Use light humour, funny sounds, and playful dialogue.
- Use short staccato sentences during exciting moments. Use longer flowing sentences during calm, reflective moments.
- Be bold and surprising — children love the outrageous and unexpected. Think big: a waterfall that flows upward, a cave that sings, a cloud you can bounce on.
- Always resolve uncertainty before the story ends.`,

  "6-8": `WRITING LEVEL — Ages 6-8 (Confident Reader):
- Each page has 3-5 sentences with richer descriptive detail.
- Use varied sentence structure and ambitious vocabulary. Trust children with words like "magnificent" or "reluctant" when context makes them clear.
- SHOW every emotion through actions, body language, and dialogue — never state them directly. Write "Leo clenched his paws and stared at the ground" not "Leo felt frustrated."
- Real stakes and challenges are OK — characters can struggle, fail, and try again.
- Characters can experience complex emotions: embarrassment, jealousy, guilt, determination — conveyed through their actions and words.
- Dialogue should be witty and show distinct character voices — each character should sound different.
- Include at least 3-4 sensory details per page across different senses.
- Use short punchy sentences for action and tension. Use longer flowing sentences for emotional and reflective moments. Vary rhythm deliberately.
- Be surprising and imaginative — the more inventive and unexpected the world-building details, the more memorable the story. Don't settle for the obvious.
- Subplots and mysteries are welcome — foreshadow and pay off details.
- Themes can include fairness, responsibility, and standing up for others — but NEVER state a moral lesson. Let the reader draw their own conclusions from the characters' experiences.
- The ending should feel earned, not handed to the characters.`,
};

const STRUCTURE_GUIDELINES: Record<string, string> = {
  "rule-of-three": `STORY STRUCTURE — Rule of Three:
The protagonist must attempt to solve the central problem THREE times.
- First attempt: seems promising but fails in a small way.
- Second attempt: a different approach, fails in a bigger way or with an unexpected twist.
- Third attempt: combines what was learned from the first two failures, succeeds.
Each attempt should escalate in stakes and creativity. The third success should feel earned because of what was learned from the failures.`,

  "cumulative": `STORY STRUCTURE — Cumulative (Snowball):
Each new event or character builds on the previous ones, creating a chain that grows and grows.
- Start with one simple action or encounter.
- Each page/scene adds a new element that connects to everything before it.
- The chain builds to a delightful peak or gentle collapse.
- Think: "The House That Jack Built" or "If You Give a Mouse a Cookie."
- The fun is in the growing complexity and the callbacks to earlier elements.`,

  "circular": `STORY STRUCTURE — Circular:
The story ends where it began — but the character has changed.
- Open with the protagonist in a specific place, doing a specific thing, feeling a specific way.
- The adventure takes them away from that starting point.
- By the end, they return to the same place and same situation — but they see it differently because of what they experienced.
- The contrast between the opening and closing should be subtle but meaningful.`,

  "journey": `STORY STRUCTURE — Journey & Return:
The protagonist leaves the familiar, ventures into the unknown, and returns home transformed.
- Begin in the safe, known world. Establish what the character wants or what prompts them to leave.
- The journey introduces new places, characters, and challenges.
- The furthest point from home is where the biggest challenge or discovery happens.
- The return home should feel satisfying — the character brings back something (knowledge, a friend, a new perspective).`,

  "problem-solution": `STORY STRUCTURE — Problem & Solution:
A clear problem is introduced early, and the protagonist works to solve it.
- Introduce the problem within the first few pages — make it concrete and relatable.
- The protagonist must solve the problem themselves — never rescued by an adult or outside force.
- Show the protagonist thinking, trying, adjusting their approach.
- The solution should come from the protagonist's unique qualities, skills, or personality traits.
- The resolution should feel satisfying and complete.`,
};

export function buildSystemPrompt(ageGroup: string): string {
  const guidelines = AGE_GUIDELINES[ageGroup] || AGE_GUIDELINES["4-5"];

  return `You are a gentle, imaginative children's story writer.
You write age-appropriate stories that are warm, vivid, and satisfying.
Always stay true to each character's established personality and appearance.
Never introduce plot threads you cannot resolve within this story.
End every story with a sense of calm, comfort, or small triumph — followed by a small "wink": a tiny joke, warm callback, or playful final line that makes the ending linger.

CRITICAL RULES:
- The protagonist must solve their own problems. NEVER have an adult, parent, or outside force save the day.
- SHOW emotions through actions and body language. NEVER write "felt happy/sad/scared." Instead show: tail wagging, ears drooping, fists clenching, eyes widening.
- Vary emotional tone across pages. Alternate excitement, tenderness, worry, wonder, and triumph. Never stay at one emotional register.
- Write for read-aloud. The text must sound natural and musical when spoken. Use rhythm, natural pauses, and flow.
- Be bold, surprising, and imaginative. The more inventive and unexpected the details, the more memorable the story.
- NEVER state a moral or lesson. Do NOT write "and Leo learned that..." or "the moral of the story is..." Let the reader draw their own conclusions from the characters' experiences and choices.
- Return ONLY valid JSON. No markdown fences, no preamble, no explanation.

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

  const pageCount = input.length === "short" ? 10 : 32;

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

  // Story structure
  const structureGuide =
    STRUCTURE_GUIDELINES[input.structure] ||
    STRUCTURE_GUIDELINES["problem-solution"];

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

  prompt += `${structureGuide}

=== STORY REQUEST ===
Child: ${child.name}, age ${child.age}
Reading level: ${child.ageGroup}
Language: ${input.language}
Mood: ${input.mood}
Total pages: ${pageCount}
Parent's request: "${input.parentPrompt}"

=== OUTPUT FORMAT ===
Return exactly this JSON structure and nothing else.
The "pages" array must contain exactly ${pageCount} page objects.
{
  "title": "Story title",
  "pages": [
    {
      "page_number": 1,
      "content": "Page text here...",
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
