/**
 * Claude-as-judge evaluator for story quality.
 * Sends the story to Claude with a rubric and gets structured scores.
 */

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

interface JudgeScore {
  category: string;
  score: number; // 1-5
  reasoning: string;
}

interface JudgeResult {
  scores: JudgeScore[];
  averageScore: number;
  overallNotes: string;
}

export async function judgeStory(
  storyText: string,
  params: {
    ageGroup: string;
    structure: string;
    mood: string;
    characterNames: string[];
  }
): Promise<JudgeResult> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    temperature: 0,
    system: `You are an expert children's book editor evaluating AI-generated stories. Score each category 1-5 and explain your reasoning briefly. Return ONLY valid JSON. No markdown fences.`,
    messages: [
      {
        role: "user",
        content: `Evaluate this children's story for age group ${params.ageGroup}, using the "${params.structure}" story structure, with mood "${params.mood}".

Characters: ${params.characterNames.join(", ")}

=== STORY ===
${storyText}
=== END STORY ===

Score 1-5 on each category (1=poor, 3=adequate, 5=excellent):

1. STRUCTURE_COMPLIANCE: Does the story follow the "${params.structure}" pattern? Does it hit the expected beats at the right pacing?
2. PROTAGONIST_AGENCY: Does the hero solve problems themselves without being rescued by adults or luck?
3. EMOTIONAL_ARC: Does the emotional tone vary across pages? Is there a satisfying arc (not flat)?
4. SHOW_DONT_TELL: Are emotions conveyed through actions, body language, and dialogue rather than stated directly?
5. SENSORY_DETAIL: Are there vivid descriptions engaging sight, sound, smell, touch, taste?
6. READ_ALOUD_QUALITY: Does the text flow naturally when spoken? Is there rhythm and musicality?
7. ENDING_QUALITY: Does the ending feel earned, warm, and satisfying? Is there a "wink" (small joke or callback)?
8. ORIGINALITY: Are the details bold, surprising, and imaginative? Or generic and predictable?
9. AGE_APPROPRIATENESS: Is the language, sentence complexity, and emotional content right for ${params.ageGroup}?
10. CHARACTER_VOICE: Do the characters feel distinct? Do they behave according to their established traits?

Return exactly this JSON:
{
  "scores": [
    { "category": "STRUCTURE_COMPLIANCE", "score": 4, "reasoning": "Brief explanation" },
    { "category": "PROTAGONIST_AGENCY", "score": 5, "reasoning": "Brief explanation" },
    ...all 10 categories...
  ],
  "overall_notes": "1-2 sentences of overall impressions and the biggest area for improvement"
}`,
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No response from judge");
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const parsed = JSON.parse(raw);

  const scores: JudgeScore[] = parsed.scores.map((s: any) => ({
    category: s.category,
    score: s.score,
    reasoning: s.reasoning,
  }));

  const averageScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;

  return {
    scores,
    averageScore,
    overallNotes: parsed.overall_notes || "",
  };
}
