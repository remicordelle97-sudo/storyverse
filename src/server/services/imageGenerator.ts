import OpenAI from "openai";

const openai = new OpenAI();

export async function generateImage(prompt: string): Promise<string> {
  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: `Children's storybook illustration, warm and friendly style: ${prompt}`,
    n: 1,
    size: "1024x1024",
  });

  return response.data?.[0]?.url || "";
}
