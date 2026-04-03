import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./promptBuilder.js";

const anthropic = new Anthropic();

interface StoryPage {
  page_number: number;
  content: string;
  image_prompt: string;
}

export interface GeneratedStory {
  title: string;
  pages: StoryPage[];
}

export async function generateStory(
  userPrompt: string,
  ageGroup: string,
  length: "short" | "long" = "long"
): Promise<GeneratedStory> {
  const maxTokens = length === "short" ? 8000 : 16000;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    temperature: 0.75,
    system: buildSystemPrompt(ageGroup),
    messages: [{ role: "user", content: userPrompt }],
  });

  // Check if the response was truncated
  if (message.stop_reason === "max_tokens") {
    throw new Error("Story generation was truncated — the story was too long for the token limit. Try a shorter story.");
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI");
  }

  // Strip markdown fences if the model wraps the JSON
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
