/**
 * Story prompt evaluation runner.
 *
 * Usage:
 *   npx tsx scripts/eval/run.ts [options]
 *
 * Options:
 *   --count N         Number of stories to generate (default: 3)
 *   --age GROUP       Age group: "2-3", "4-5", "6-8" (default: "4-5")
 *   --structure TYPE  Story structure or "random" (default: "random")
 *   --length SIZE     "short" or "long" (default: "short")
 *   --mood MOOD       Story mood (default: "exciting adventures")
 *   --judge           Run Claude-as-judge evaluation (costs ~$0.02/story)
 *   --universe ID     Use a specific universe ID (otherwise uses first available)
 *   --fresh           Create a fresh universe with new characters for this eval run
 *   --interests LIST  Interests for fresh universe (comma-separated, default: "Dragons,Space")
 *   --hero NAME       Hero name for fresh universe (default: "Spark")
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildPrompt, buildSystemPrompt } from "../../src/server/services/promptBuilder.js";
import { generateSecondaryCharacters } from "../../src/server/services/characterGenerator.js";
import { runAutomatedChecks } from "./checks.js";
import { judgeStory } from "./judge.js";
import Anthropic from "@anthropic-ai/sdk";

const prisma = new PrismaClient();
const anthropic = new Anthropic();

const INTERESTS_MAP: Record<string, { themes: string[]; heroSpecies: string }> = {
  "Dragons": { themes: ["dragons", "fire", "flying"], heroSpecies: "Dragon" },
  "Space": { themes: ["space", "stars", "exploration"], heroSpecies: "Space Explorer" },
  "Ocean": { themes: ["ocean", "sea creatures", "coral"], heroSpecies: "Sea Creature" },
  "Lions": { themes: ["lions", "savanna", "courage"], heroSpecies: "Lion" },
  "Robots": { themes: ["robots", "technology", "invention"], heroSpecies: "Robot" },
  "Dinosaurs": { themes: ["dinosaurs", "prehistoric", "adventure"], heroSpecies: "Dinosaur" },
};

interface EvalResult {
  storyIndex: number;
  title: string;
  structure: string;
  ageGroup: string;
  length: string;
  pageCount: number;
  generationTimeMs: number;
  systemPrompt?: string;
  userPrompt?: string;
  automatedChecks: { name: string; passed: boolean; score: number; detail: string }[];
  automatedScore: number;
  judgeResult?: {
    scores: { category: string; score: number; reasoning: string }[];
    averageScore: number;
    overallNotes: string;
  };
  fullText?: string;
}

const STRUCTURES = ["problem-solution", "rule-of-three", "cumulative", "circular", "journey", "unlikely-friendship"];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
      opts[args[i].slice(2)] = args[i + 1];
      i++;
    } else if (args[i].startsWith("--")) {
      opts[args[i].slice(2)] = "true";
    }
  }
  return {
    count: parseInt(opts.count || "3", 10),
    ageGroup: opts.age || "4-5",
    structure: opts.structure || "random",
    length: (opts.length || "short") as "short" | "long",
    mood: opts.mood || "exciting adventures",
    judge: opts.judge === "true",
    universeId: opts.universe || "",
    fresh: opts.fresh === "true",
    interests: opts.interests || "Dragons,Space",
    heroName: opts.hero || "Spark",
  };
}

async function createFreshUniverse(interests: string, heroName: string, mood: string): Promise<string> {
  const interestList = interests.split(",").map((s) => s.trim());
  const allThemes: string[] = [];
  let heroSpecies = "Adventurer";

  for (const interest of interestList) {
    const info = INTERESTS_MAP[interest];
    if (info) {
      allThemes.push(...info.themes);
      heroSpecies = info.heroSpecies;
    } else {
      allThemes.push(interest.toLowerCase());
    }
  }

  console.log("Creating fresh universe...");

  // Generate universe concept via Claude
  const conceptMsg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    temperature: 0.9,
    system: "You create unique, imaginative worlds for children's stories. Return ONLY valid JSON. No markdown fences.",
    messages: [{
      role: "user",
      content: `Create a unique children's story universe.
INTERESTS: ${JSON.stringify(interestList)}
MOOD: ${mood}
HERO NAME: ${heroName}

Return JSON:
{
  "name": "A unique universe name",
  "settingDescription": "2-3 vivid sentences",
  "heroSpecies": "species for the hero",
  "heroAppearance": "Complete body specification (no clothing)",
  "heroOutfit": "ALWAYS WEARS AND CARRIES:\\n- #hex item..."
}`,
    }],
  });

  const conceptText = conceptMsg.content.find((b) => b.type === "text");
  let conceptRaw = conceptText?.type === "text" ? conceptText.text.trim() : "";
  if (conceptRaw.startsWith("```")) conceptRaw = conceptRaw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  const concept = JSON.parse(conceptRaw);

  console.log(`  Universe: ${concept.name}`);

  // Find or create a user for eval
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: { googleId: "eval-user", email: "eval@test.com", name: "Eval User" },
    });
  }

  // Create universe
  const universe = await prisma.universe.create({
    data: {
      userId: user.id,
      name: concept.name,
      settingDescription: concept.settingDescription,
      themes: JSON.stringify(allThemes),
      mood,
      avoidThemes: "",
    },
  });

  // Create hero
  await prisma.character.create({
    data: {
      universeId: universe.id,
      name: heroName,
      speciesOrType: concept.heroSpecies || heroSpecies,
      personalityTraits: JSON.stringify(["brave", "curious", "funny"]),
      appearance: concept.heroAppearance || `A friendly ${heroSpecies.toLowerCase()} with bright eyes`,
      outfit: concept.heroOutfit || "",
      role: "main",
    },
  });

  console.log(`  Hero: ${heroName} (${concept.heroSpecies || heroSpecies})`);

  // Generate supporting characters
  console.log("  Generating supporting characters...");
  await generateSecondaryCharacters(universe.id);

  const chars = await prisma.character.findMany({ where: { universeId: universe.id } });
  console.log(`  Characters: ${chars.map((c) => c.name).join(", ")}`);
  console.log(`  Universe ready: ${universe.id.slice(0, 8)}\n`);

  return universe.id;
}

async function generateStory(
  universeId: string,
  characterIds: string[],
  ageGroup: string,
  structure: string,
  length: "short" | "long",
  mood: string
): Promise<{ story: any; timeMs: number; systemPrompt: string; userPrompt: string }> {
  const start = Date.now();

  const { userMessage, ageGroup: resolvedAge } = await buildPrompt({
    universeId,
    characterIds,
    mood,
    language: "en",
    ageGroup,
    structure,
    length,
    parentPrompt: "",
  });

  const systemPrompt = buildSystemPrompt(resolvedAge);

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: length === "short" ? 8000 : 16000,
    temperature: 0.75,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No response");
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const story = JSON.parse(raw);
  return { story, timeMs: Date.now() - start, systemPrompt, userPrompt: userMessage };
}

async function main() {
  const opts = parseArgs();
  console.log("\n=== STORYVERSE PROMPT EVAL ===");
  console.log(`Count: ${opts.count} | Age: ${opts.ageGroup} | Structure: ${opts.structure} | Length: ${opts.length} | Mood: ${opts.mood} | Judge: ${opts.judge} | Fresh: ${opts.fresh}\n`);

  // Find or create a universe
  let universeId = opts.universeId;
  if (opts.fresh) {
    universeId = await createFreshUniverse(opts.interests, opts.heroName, opts.mood);
  } else if (!universeId) {
    const universe = await prisma.universe.findFirst({
      include: { characters: true },
    });
    if (!universe) {
      console.error("No universe found. Use --fresh to create one, or create one in the app.");
      process.exit(1);
    }
    universeId = universe.id;
    console.log(`Using universe: ${universe.name} (${universeId.slice(0, 8)})`);
  }

  const universe = await prisma.universe.findUniqueOrThrow({
    where: { id: universeId },
    include: { characters: true },
  });

  const hero = universe.characters.find((c) => c.role === "main");
  const allSupporting = universe.characters.filter((c) => c.role !== "main");
  console.log(`Available: hero=${hero?.name || "none"}, supporting=${allSupporting.map(c => c.name).join(", ") || "none"}\n`);

  const results: EvalResult[] = [];

  for (let i = 0; i < opts.count; i++) {
    const structure = opts.structure === "random"
      ? STRUCTURES[Math.floor(Math.random() * STRUCTURES.length)]
      : opts.structure;

    // Randomly pick 0, 1, or 2 supporting characters
    const supportingCount = Math.floor(Math.random() * 3); // 0, 1, or 2
    const shuffled = [...allSupporting].sort(() => Math.random() - 0.5);
    const selectedSupporting = shuffled.slice(0, supportingCount);
    const selectedChars = hero ? [hero, ...selectedSupporting] : selectedSupporting;
    const characterIds = selectedChars.map((c) => c.id);
    const characterNames = selectedChars.map((c) => c.name);

    console.log(`--- Story ${i + 1}/${opts.count} (${structure}, ${characterNames.length} chars: ${characterNames.join(", ")}) ---`);

    try {
      const { story, timeMs, systemPrompt, userPrompt } = await generateStory(
        universeId,
        characterIds,
        opts.ageGroup,
        structure,
        opts.length,
        opts.mood
      );

      console.log(`  Title: "${story.title}" | Pages: ${story.pages?.length} | Time: ${(timeMs / 1000).toFixed(1)}s`);

      // Automated checks
      const checks = runAutomatedChecks(story, {
        ageGroup: opts.ageGroup,
        length: opts.length,
        structure,
        characterNames,
      });

      const automatedScore = checks.reduce((sum, c) => sum + c.score, 0) / checks.length;
      const failedChecks = checks.filter((c) => !c.passed);

      console.log(`  Automated: ${(automatedScore * 100).toFixed(0)}% (${failedChecks.length} failed)`);
      for (const fail of failedChecks) {
        console.log(`    FAIL: ${fail.name} — ${fail.detail}`);
      }

      const result: EvalResult = {
        storyIndex: i,
        title: story.title,
        structure,
        ageGroup: opts.ageGroup,
        length: opts.length,
        pageCount: story.pages?.length || 0,
        generationTimeMs: timeMs,
        automatedChecks: checks,
        automatedScore,
        systemPrompt,
        userPrompt,
      };

      // Claude-as-judge
      if (opts.judge) {
        console.log("  Running Claude-as-judge...");
        const storyText = story.pages
          .map((p: any) => `[Page ${p.page_number}]\n${p.content}`)
          .join("\n\n");

        const judgeResult = await judgeStory(storyText, {
          ageGroup: opts.ageGroup,
          structure,
          mood: opts.mood,
          characterNames,
        });

        result.judgeResult = judgeResult;
        console.log(`  Judge: ${judgeResult.averageScore.toFixed(1)}/5`);
        for (const s of judgeResult.scores) {
          const bar = "█".repeat(s.score) + "░".repeat(5 - s.score);
          console.log(`    ${bar} ${s.score}/5 ${s.category}: ${s.reasoning}`);
        }
        console.log(`  Notes: ${judgeResult.overallNotes}`);
      }

      // Store full text for reference
      result.fullText = story.pages?.map((p: any) => p.content).join("\n\n");

      results.push(result);
    } catch (e: any) {
      console.error(`  ERROR: ${e.message}`);
    }

    console.log();
  }

  // Summary
  console.log("=== SUMMARY ===");
  console.log(`Stories generated: ${results.length}/${opts.count}`);

  if (results.length > 0) {
    const avgAutoScore = results.reduce((s, r) => s + r.automatedScore, 0) / results.length;
    console.log(`Avg automated score: ${(avgAutoScore * 100).toFixed(0)}%`);

    const avgTime = results.reduce((s, r) => s + r.generationTimeMs, 0) / results.length;
    console.log(`Avg generation time: ${(avgTime / 1000).toFixed(1)}s`);

    if (results.some((r) => r.judgeResult)) {
      const judgedResults = results.filter((r) => r.judgeResult);
      const avgJudge = judgedResults.reduce((s, r) => s + (r.judgeResult?.averageScore || 0), 0) / judgedResults.length;
      console.log(`Avg judge score: ${avgJudge.toFixed(1)}/5`);

      // Per-category averages
      const categories = judgedResults[0]?.judgeResult?.scores.map((s) => s.category) || [];
      console.log("\nPer-category averages:");
      for (const cat of categories) {
        const catScores = judgedResults.map((r) =>
          r.judgeResult?.scores.find((s) => s.category === cat)?.score || 0
        );
        const avg = catScores.reduce((a, b) => a + b, 0) / catScores.length;
        const bar = "█".repeat(Math.round(avg)) + "░".repeat(5 - Math.round(avg));
        console.log(`  ${bar} ${avg.toFixed(1)}/5 ${cat}`);
      }
    }

    // Most common automated failures
    const failCounts: Record<string, number> = {};
    for (const r of results) {
      for (const c of r.automatedChecks) {
        if (!c.passed) {
          failCounts[c.name] = (failCounts[c.name] || 0) + 1;
        }
      }
    }
    if (Object.keys(failCounts).length > 0) {
      console.log("\nMost common failures:");
      for (const [name, count] of Object.entries(failCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count}/${results.length} stories: ${name}`);
      }
    }
  }

  // Save results to file
  const outputPath = `scripts/eval/results-${Date.now()}.json`;
  const fs = await import("fs");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
