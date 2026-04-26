import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./promptBuilder.js";
import { CLAUDE_MODEL, CLAUDE_MODEL_FAST, CLAUDE_MODEL_PLANNER, TEMPERATURE_STANDARD, MAX_TOKENS_SHORT, MAX_TOKENS_SMALL, STORY_PAGES } from "../lib/config.js";
import { debug } from "../lib/debug.js";

// Pass apiKey explicitly + trim so trailing whitespace in the env var
// doesn't poison the auth header (see geminiGenerator.ts for context).
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });

/** Retry a function with exponential backoff on 429 rate limit errors */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const is429 = err?.status === 429 || err?.error?.type === "rate_limit_error";
      if (!is429 || attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
      debug.story(`Rate limited, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Retry exhausted"); // unreachable
}

interface StoryPage {
  page_number: number;
  content: string;
  image_prompt: string;
  characters_in_scene: string[];
}

export interface GeneratedStory {
  title: string;
  pages: StoryPage[];
  /** Raw plan object from the planner step (for debug) */
  plan?: StoryPlan;
}

interface StoryPlan {
  title: string;
  premise: string;
  opening_state: string;
  resolution: string;
  pages: { page: number; beat: string; characters: string[] }[];
}

export const PLANNER_SYSTEM_PROMPT = `You are a children's story planner. Create a detailed story outline that will guide the full story writing.

Your plan must be CONCRETE — no vague hooks or mysteries. Every beat must say specifically what happens, who is involved, and where it takes place. A reader of just the plan should understand the entire story.

THE MOST IMPORTANT RULE — EARLY CLARITY:
The listener must understand what the story is ABOUT within the first 2 pages. By the end of page 2, a child should be able to answer: "What's happening?" and "What's this story going to be about?" — whether that's a problem to solve, a journey beginning, a pattern starting, or two characters meeting. Do NOT spend multiple pages on leisurely scene-setting before the story's engine starts. The core driver can appear on page 1.

RULES:
- "premise": Follow the PREMISE FORMAT specified in the structure guidelines. Each story archetype has its own premise template — use it. Every word must be concrete and specific — no "faces a challenge" or "discovers something unexpected."
- "opening_state": What specifically happens on page 1. Must establish WHO, WHERE, and WHAT IS HAPPENING. The story's core driver should be visible or directly foreshadowed here — not hidden for a reveal later.
- "resolution": How the story specifically ends. Must connect directly to the premise.
- Each page beat must say what CONCRETELY happens — not "something surprising happens" but "the bridge collapses when they're halfway across."
- Characters listed per page must use their full names exactly as provided.

SELF-CHECK before returning:
1. Could a 4-year-old listener explain what the story is about after hearing just pages 1-2?
2. Does every page beat say WHAT happens, not just that something happens?
3. Does the resolution connect directly to the premise?
4. Does the premise follow the PREMISE FORMAT template for this story's archetype?
If any answer is no, revise the plan.

Return ONLY valid JSON. No markdown fences.`;

/**
 * Step 1: Generate a story plan — a structured outline that commits
 * to concrete plot beats before any prose is written. This prevents
 * vague hooks, logical gaps, and orphaned setups.
 */
async function planStory(userPrompt: string): Promise<StoryPlan> {
  const pageCount = STORY_PAGES;

  // Plan step uses Opus: more reliable at the stacked constraints in the
  // planner prompt (archetype templates, early-clarity rule, per-page beats).
  // Worth the extra cost/latency because a bad plan poisons the story.
  // NOTE: Opus 4.7 does not accept the `temperature` parameter, so it's
  // omitted here (unlike the writer and refiner calls below).
  const message = await withRetry(() => anthropic.messages.create({
    model: CLAUDE_MODEL_PLANNER,
    max_tokens: MAX_TOKENS_SMALL,
    system: [{ type: "text" as const, text: PLANNER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
    messages: [
      {
        role: "user",
        content: `${userPrompt}

=== PLAN FORMAT ===
Create a plan for exactly ${pageCount} pages. Return this JSON:
{
  "title": "Story title",
  "premise": "One sentence following the archetype-specific PREMISE FORMAT template from the structure guidelines above. Must be concrete and specific.",
  "opening_state": "Concrete description of page 1: who, where, what is happening, and how the story's core driver appears or is foreshadowed.",
  "resolution": "How the story specifically ends. Must connect to the premise.",
  "pages": [
    { "page": 1, "beat": "What concretely happens on this page", "characters": ["Full Name"] },
    { "page": 2, "beat": "The story's direction becomes clear: [specific event]. The listener now knows what this story is about.", "characters": ["..."] }
  ]
}`,
      },
    ],
  }));

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
  ageGroup: string
): Promise<GeneratedStory> {
  const maxTokens = MAX_TOKENS_SHORT;

  const planContext = `=== STORY PLAN (follow this exactly) ===
Title: ${plan.title}
Premise: ${plan.premise}
Opening: ${plan.opening_state}
Resolution: ${plan.resolution}

Page-by-page beats:
${plan.pages.map((p) => `Page ${p.page}: ${p.beat} [Characters: ${p.characters.join(", ")}]`).join("\n")}

IMPORTANT: Follow the plan above exactly. Each page's content must match its beat. Do not add new plot points not in the plan. Do not skip beats. The plan has already been checked for clarity and logical consistency — your job is to write beautiful prose that brings it to life.

CRITICAL: Obey the SENTENCE COUNT constraint in the output format section. Count sentences on every page. If a beat is too complex for the allowed sentence count, distill it — do not exceed the limit.
=== END PLAN ===

${userPrompt}`;

  const message = await withRetry(() => anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    temperature: TEMPERATURE_STANDARD,
    system: [{ type: "text" as const, text: buildSystemPrompt(ageGroup), cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user", content: planContext }],
  }));

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
  story: GeneratedStory
): Promise<GeneratedStory> {
  const promptList = story.pages.map((p) => ({
    page_number: p.page_number,
    image_prompt: p.image_prompt,
    characters_in_scene: p.characters_in_scene,
  }));

  const refinerSystemPrompt = `You are an art director for a children's picture book. You receive a set of image prompts for an entire book and rewrite them to work as a cohesive visual narrative.

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

Return ONLY valid JSON. No markdown fences.`;

  // Refinement is a mechanical rewrite (structure + style consistency),
  // not a creative task — Haiku does it well and is noticeably faster.
  const message = await withRetry(() => anthropic.messages.create({
    model: CLAUDE_MODEL_FAST,
    max_tokens: MAX_TOKENS_SHORT,
    temperature: TEMPERATURE_STANDARD,
    system: [{ type: "text" as const, text: refinerSystemPrompt, cache_control: { type: "ephemeral" as const } }],
    messages: [
      {
        role: "user",
        content: `Review and rewrite these ${promptList.length} image prompts as a cohesive set for a children's picture book titled "${story.title}":

IMAGE PROMPTS:
${JSON.stringify(promptList, null, 2)}

Return exactly this JSON:
{
  "pages": [
    { "page_number": 1, "image_prompt": "rewritten prompt", "characters_in_scene": ["Character Name"] }
  ]
}`,
      },
    ],
  }));

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
 * Generate a complete story: plan → write → (refine image prompts).
 * The refine pass is skipped for text-only stories since the image
 * prompts it polishes are never rendered.
 */
export async function generateStory(
  planPrompt: string,
  writePrompt: string,
  ageGroup: string,
  options: { generateImages?: boolean; onProgress?: (step: string, detail?: string) => void } = {},
): Promise<GeneratedStory> {
  const { generateImages = true, onProgress } = options;

  // Step 1: Plan
  onProgress?.("planning", "Planning the story...");
  debug.story("Planning story...");
  const planStart = Date.now();
  const plan = await planStory(planPrompt);
  debug.story(`Plan created in ${Date.now() - planStart}ms`, {
    title: plan.title,
    premise: plan.premise,
    pages: plan.pages.length,
  });

  // Step 2: Write
  onProgress?.("writing", `Writing "${plan.title}"...`);
  debug.story("Writing story from plan...");
  const writeStart = Date.now();
  const story = await writeStory(writePrompt, plan, ageGroup);
  debug.story(`Story written in ${Date.now() - writeStart}ms`, {
    title: story.title,
    pages: story.pages.length,
  });

  // Step 3: Refine image prompts — only relevant when images will be drawn.
  if (generateImages) {
    onProgress?.("refining", "Refining illustrations...");
    debug.story("Refining image prompts...");
    const refineStart = Date.now();
    await refineImagePrompts(story);
    debug.story(`Image prompts refined in ${Date.now() - refineStart}ms`);
  } else {
    debug.story("Skipping image prompt refinement (text-only story)");
  }

  story.plan = plan;
  return story;
}
