import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_KEY });

async function listModels() {
  const result = await ai.models.list();
  const models = result.page || result.models || result;
  if (Array.isArray(models)) {
    for (const model of models) {
      console.log(model.name);
    }
  } else {
    console.log("Raw response:", JSON.stringify(result, null, 2).slice(0, 2000));
  }
}

listModels().catch(console.error);
