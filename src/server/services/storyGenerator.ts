import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./promptBuilder.js";

const anthropic = new Anthropic();

interface StoryPage {
  page_number: number;
  content: string;
  image_prompt: string;
}

interface StoryTimelineEvent {
  character_name: string;
  event_summary: string;
  significance: "major" | "minor";
}

export interface GeneratedStory {
  title: string;
  pages: StoryPage[];
  timeline_events: StoryTimelineEvent[];
}

export async function generateStory(
  userPrompt: string,
  ageGroup: string
): Promise<GeneratedStory> {
  // 32-page stories need more tokens
  const maxTokens = ageGroup === "2-3" ? 4000 : 8000;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    temperature: 0.75,
    system: buildSystemPrompt(ageGroup),
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI");
  }

  const raw = textBlock.text.trim();

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
