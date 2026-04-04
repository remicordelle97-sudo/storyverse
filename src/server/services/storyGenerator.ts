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
}

export interface GeneratedStory {
  title: string;
  pages: StoryPage[];
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

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI for story plan");
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const plan: StoryPlan = JSON.parse(raw);

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
 * Generate a complete story: plan first, then write prose from the plan.
 */
export async function generateStory(
  userPrompt: string,
  ageGroup: string,
  length: "short" | "long" = "long",
  onProgress?: (step: string, detail?: string) => void
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

  return story;
}
