import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./promptBuilder.js";
import { CLAUDE_MODEL, TEMPERATURE_STANDARD, TEMPERATURE_CREATIVE, MAX_TOKENS_SHORT, MAX_TOKENS_LONG, MAX_TOKENS_SMALL } from "../lib/config.js";
import { debug } from "../lib/debug.js";

const anthropic = new Anthropic();

interface StoryPage {
  page_number: number;
  content: string;
  image_prompt: string;
  characters_in_scene: string[];
  location: string;
}

export interface GeneratedStory {
  title: string;
  pages: StoryPage[];
  characterAnchors?: Record<string, string>;
}

interface StoryPlan {
  title: string;
  premise: string;
  opening_state: string;
  resolution: string;
  pages: { page: number; beat: string; characters: string[]; location: string }[];
}

/**
 * Step 1: Generate a story plan — a structured outline that commits
 * to concrete plot beats before any prose is written. This prevents
 * vague hooks, logical gaps, and orphaned setups.
 */
async function planStory(
  userPrompt: string,
  ageGroup: string,
  length: "short" | "long"
): Promise<StoryPlan> {
  const pageCount = length === "short" ? 10 : 32;

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS_SMALL,
    temperature: TEMPERATURE_CREATIVE,
    system: `You are a children's story planner. Create a detailed story outline that will guide the full story writing.

Your plan must be CONCRETE — no vague hooks or mysteries. Every beat must say specifically what happens, who is involved, and where it takes place. A reader of just the plan should understand the entire story.

RULES:
- "premise": One sentence that captures the entire story. Must name specific characters and the core conflict.
- "opening_state": What specifically happens on page 1. Must establish WHO, WHERE, and WHAT IS HAPPENING. No teasing.
- "resolution": How the story ends. Must be specific and satisfying.
- Each page beat must say what CONCRETELY happens — not "something surprising happens" but "the bridge collapses when they're halfway across."
- Characters listed per page must use their full names exactly as provided.
- Locations must be specific named places from the universe.

Return ONLY valid JSON. No markdown fences.`,
    messages: [
      {
        role: "user",
        content: `${userPrompt}

=== PLAN FORMAT ===
Create a plan for exactly ${pageCount} pages. Return this JSON:
{
  "title": "Story title",
  "premise": "One sentence: [character] must [do what] because [why], but [obstacle].",
  "opening_state": "Concrete description of page 1: who, where, what is happening right now.",
  "resolution": "How the story specifically ends.",
  "pages": [
    { "page": 1, "beat": "What concretely happens on this page", "characters": ["Full Name"], "location": "Specific Place" },
    { "page": 2, "beat": "...", "characters": ["..."], "location": "..." }
  ]
}`,
      },
    ],
  });

  if (message.stop_reason === "max_tokens") {
    throw new Error("Story plan was truncated — response exceeded token limit.");
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI for story plan");
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  let plan: StoryPlan;
  try {
    plan = JSON.parse(raw);
  } catch {
    debug.error(`Failed to parse story plan. Raw response (first 500 chars): ${raw.slice(0, 500)}`);
    throw new Error("Failed to parse story plan as JSON");
  }

  if (!plan.premise || !plan.pages?.length) {
    throw new Error("Invalid story plan");
  }

  return plan;
}

/**
 * Step 2: Generate the full story prose from the plan.
 */
async function writeStory(
  userPrompt: string,
  plan: StoryPlan,
  ageGroup: string,
  length: "short" | "long"
): Promise<GeneratedStory> {
  const maxTokens = length === "short" ? MAX_TOKENS_SHORT : MAX_TOKENS_LONG;

  const planContext = `=== STORY PLAN (follow this exactly) ===
Title: ${plan.title}
Premise: ${plan.premise}
Opening: ${plan.opening_state}
Resolution: ${plan.resolution}

Page-by-page beats:
${plan.pages.map((p) => `Page ${p.page}: ${p.beat} [Characters: ${p.characters.join(", ")}] [Location: ${p.location}]`).join("\n")}

IMPORTANT: Follow the plan above exactly. Each page's content must match its beat. Do not add new plot points not in the plan. Do not skip beats. The plan has already been checked for clarity and logical consistency — your job is to write beautiful prose that brings it to life.

CRITICAL: Obey the SENTENCE COUNT constraint in the output format section. Count sentences on every page. If a beat is too complex for the allowed sentence count, distill it — do not exceed the limit.
=== END PLAN ===

${userPrompt}`;

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    temperature: TEMPERATURE_STANDARD,
    system: buildSystemPrompt(ageGroup),
    messages: [{ role: "user", content: planContext }],
  });

  if (message.stop_reason === "max_tokens") {
    throw new Error("Story generation was truncated — the story was too long for the token limit. Try a shorter story.");
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI");
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  let parsed: GeneratedStory;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse AI response as JSON: ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    throw new Error("AI response missing pages array");
  }

  return parsed;
}

/**
 * Step 3: Review and refine all image prompts as a set.
 * Claude sees all prompts together and rewrites them for:
 * - Visual variety (no two scenes should have similar composition)
 * - Character consistency (same character described the same way)
 * - Narrative flow (visual journey that builds and varies)
 * - Specificity (concrete visual details, not vague descriptions)
 */
async function refineImagePrompts(
  story: GeneratedStory,
  characterData?: { name: string; appearance: string; outfit: string; specialDetail: string }[]
): Promise<GeneratedStory> {
  const promptList = story.pages.map((p) => ({
    page_number: p.page_number,
    image_prompt: p.image_prompt,
    characters_in_scene: p.characters_in_scene,
    location: p.location,
  }));

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS_SHORT,
    temperature: TEMPERATURE_STANDARD,
    system: `You are an art director for a children's picture book. You receive a set of image prompts for an entire book and rewrite them to work as a cohesive visual narrative.

RULES:
- Each prompt should describe a SCENE (setting, action, emotion, atmosphere) — NOT character bodies or anatomy. Character identity comes from reference images provided separately.
- Name each character present using their full name.
- Describe their expression, body language, and what they are doing.
- Describe the environment, lighting, time of day, and atmosphere in detail.
- Vary the scenes across pages — different backgrounds, different character arrangements. Some pages show more of the world, others focus more on the characters.
- Ensure visual VARIETY: different backgrounds, different character positions, different moods. If two prompts sound similar, make them dramatically different.
- Build a visual ARC: the images should feel like a journey, not the same scene repeated.
- Keep prompts to 2-3 sentences each. Be specific and concrete, not vague.
- Consecutive pages should describe different character poses and body language — if a character is running on one page, they should be sitting, climbing, reaching, or turning on the next.
- Do NOT describe character bodies, species details, clothing, or physical features — only name, expression, action, and setting.

ALSO: For each character that appears in the story, write a comprehensive IDENTITY ANCHOR — a complete visual checklist that an illustrator can use to draw the character consistently on every page. Include ALL of the following:

1. BODY: species/type, body shape, size/proportions (tall/short, round/slim, large/small), posture
2. COLORS: exact hex codes for ALL body colors (skin/fur/scales, hair/mane, markings, patterns). Use the hex codes from the character data provided.
3. FACE: eye color (hex) and shape, nose/beak/snout shape, mouth style, any facial markings or features
4. OUTFIT: every clothing item with exact hex color codes, style details (collar type, sleeve length, buttons vs zipper, etc.)
5. ACCESSORIES: every accessory with exact hex color codes, size, where it's worn/carried
6. DISTINGUISHING MARKS: scars, patterns, missing features, unique textures, special details

Write each anchor as a detailed comma-separated list. Be specific enough that two different illustrators would draw the same character.

Return ONLY valid JSON. No markdown fences.`,
    messages: [
      {
        role: "user",
        content: `Review and rewrite these ${promptList.length} image prompts as a cohesive set for a children's picture book titled "${story.title}":

${characterData && characterData.length > 0 ? `CHARACTER VISUAL DATA (use exact hex codes from outfits):\n${characterData.map((c) => `${c.name}:\n  Appearance: ${c.appearance}\n  Outfit: ${c.outfit}\n  Detail: ${c.specialDetail}`).join("\n\n")}\n\n` : ""}IMAGE PROMPTS:
${JSON.stringify(promptList, null, 2)}

Return exactly this JSON:
{
  "characterAnchors": {
    "Character Full Name": "small round rabbit, soft brown fur (#8B6F47), long floppy ears with pink inner (#F4B8C1), large round amber eyes (#D4A017), blue denim jacket (#2B5DAE) with silver zipper, orange rubber boots (#E87B35), tan satchel (#C4A882) with star patches, slightly chipped left front tooth"
  },
  "pages": [
    { "page_number": 1, "image_prompt": "rewritten prompt", "characters_in_scene": ["Character Name"] }
  ]
}`,
      },
    ],
  });

  if (message.stop_reason === "max_tokens") {
    debug.error("Image prompt refinement was truncated, using original prompts");
    return story;
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    debug.error("No response from image prompt refinement, using original prompts");
    return story;
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  try {
    const refined = JSON.parse(raw);
    if (!Array.isArray(refined.pages)) throw new Error("No pages array");

    // Store character anchors
    if (refined.characterAnchors) {
      story.characterAnchors = refined.characterAnchors;
      debug.story("Character anchors generated", Object.keys(refined.characterAnchors));
    }

    // Merge refined prompts back into the story
    for (const refinedPage of refined.pages) {
      const original = story.pages.find((p) => p.page_number === refinedPage.page_number);
      if (original) {
        original.image_prompt = refinedPage.image_prompt;
        if (refinedPage.characters_in_scene) {
          original.characters_in_scene = refinedPage.characters_in_scene;
        }
      }
    }
  } catch (e: any) {
    debug.error(`Failed to parse refined prompts, using originals: ${e.message}`);
  }

  return story;
}

/**
 * Generate a complete story: plan → write → refine image prompts.
 */
export async function generateStory(
  userPrompt: string,
  ageGroup: string,
  length: "short" | "long" = "long",
  onProgress?: (step: string, detail?: string) => void,
  characterData?: { name: string; appearance: string; outfit: string; specialDetail: string }[]
): Promise<GeneratedStory> {
  // Step 1: Plan
  onProgress?.("planning", "Planning the story...");
  debug.story("Planning story...");
  const planStart = Date.now();
  const plan = await planStory(userPrompt, ageGroup, length);
  debug.story(`Plan created in ${Date.now() - planStart}ms`, {
    title: plan.title,
    premise: plan.premise,
    pages: plan.pages.length,
  });

  // Step 2: Write
  onProgress?.("writing", `Writing "${plan.title}"...`);
  debug.story("Writing story from plan...");
  const writeStart = Date.now();
  const story = await writeStory(userPrompt, plan, ageGroup, length);
  debug.story(`Story written in ${Date.now() - writeStart}ms`, {
    title: story.title,
    pages: story.pages.length,
  });

  // Step 3: Refine image prompts as a set
  onProgress?.("refining", "Refining illustrations...");
  debug.story("Refining image prompts...");
  const refineStart = Date.now();
  const refined = await refineImagePrompts(story, characterData);
  debug.story(`Image prompts refined in ${Date.now() - refineStart}ms`);

  return refined;
}
