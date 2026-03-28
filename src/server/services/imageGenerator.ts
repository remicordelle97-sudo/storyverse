import OpenAI from "openai";
import prisma from "../lib/prisma.js";

const openai = new OpenAI();

interface CharacterVisual {
  name: string;
  appearance: string;
  specialDetail: string;
}

/**
 * Build a character reference sheet that gets prepended to every image prompt.
 * This ensures visual consistency even if the AI's image_prompt is vague.
 */
async function buildCharacterReference(
  universeId: string,
  characterIds: string[]
): Promise<string> {
  const characters = await prisma.character.findMany({
    where: { universeId, id: { in: characterIds } },
  });

  if (characters.length === 0) return "";

  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
  });

  const style = universe?.illustrationStyle || "storybook";

  let ref = `ART STYLE: Children's ${style} illustration, warm and friendly, consistent character designs throughout.\n\n`;
  ref += `CHARACTER REFERENCE SHEET (characters must look exactly like this in every image):\n`;

  for (const char of characters) {
    ref += `- ${char.name}: ${char.appearance}`;
    if (char.specialDetail) {
      ref += `. ${char.specialDetail}`;
    }
    ref += `\n`;
  }

  return ref;
}

export async function generateImage(
  prompt: string,
  universeId?: string,
  characterIds?: string[]
): Promise<string> {
  let fullPrompt = prompt;

  // Prepend character reference if universe context is available
  if (universeId && characterIds?.length) {
    const reference = await buildCharacterReference(universeId, characterIds);
    if (reference) {
      fullPrompt = `${reference}\nSCENE: ${prompt}`;
    }
  } else {
    fullPrompt = `Children's storybook illustration, warm and friendly style: ${prompt}`;
  }

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: fullPrompt,
    n: 1,
    size: "1024x1024",
  });

  return response.data?.[0]?.url || "";
}
