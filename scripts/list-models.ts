import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_KEY });

async function listModels() {
  const pager = await ai.models.list();
  for (const model of pager) {
    console.log(model.name);
  }
}

listModels().catch(console.error);
