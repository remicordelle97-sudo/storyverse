/**
 * Automated rule-based checks for story quality.
 * These are instant, free, and deterministic.
 */

interface PageData {
  page_number: number;
  content: string;
  image_prompt: string;
}

interface StoryData {
  title: string;
  pages: PageData[];
}

interface CheckResult {
  name: string;
  passed: boolean;
  score: number; // 0-1
  detail: string;
}

export function runAutomatedChecks(
  story: StoryData,
  params: {
    ageGroup: string;
    length: "short" | "long";
    structure: string;
    characterNames: string[];
  }
): CheckResult[] {
  const results: CheckResult[] = [];
  const expectedPages = params.length === "short" ? 10 : 32;

  // 1. Page count
  results.push({
    name: "Page count",
    passed: story.pages.length === expectedPages,
    score: story.pages.length === expectedPages ? 1 : Math.max(0, 1 - Math.abs(story.pages.length - expectedPages) / expectedPages),
    detail: `Expected ${expectedPages}, got ${story.pages.length}`,
  });

  // 2. No em dashes
  const emDashPages = story.pages.filter((p) => p.content.includes("—"));
  results.push({
    name: "No em dashes",
    passed: emDashPages.length === 0,
    score: 1 - emDashPages.length / story.pages.length,
    detail: emDashPages.length === 0
      ? "No em dashes found"
      : `Found em dashes on ${emDashPages.length} pages: ${emDashPages.map((p) => p.page_number).join(", ")}`,
  });

  // 3. Exclamation marks per page (max 1)
  const excessExclamation = story.pages.filter((p) => {
    const count = (p.content.match(/!/g) || []).length;
    return count > 1;
  });
  results.push({
    name: "Exclamation marks (≤1 per page)",
    passed: excessExclamation.length === 0,
    score: 1 - excessExclamation.length / story.pages.length,
    detail: excessExclamation.length === 0
      ? "All pages have ≤1 exclamation mark"
      : `${excessExclamation.length} pages have >1: ${excessExclamation.map((p) => `p${p.page_number}(${(p.content.match(/!/g) || []).length})`).join(", ")}`,
  });

  // 4. No "felt happy/sad/scared" phrases
  const tellPhrases = /\b(felt|feeling)\s+(happy|sad|scared|angry|nervous|excited|worried|proud|disappointed|frustrated|jealous|embarrassed)\b/gi;
  const tellPages = story.pages.filter((p) => tellPhrases.test(p.content));
  // Reset regex lastIndex
  tellPhrases.lastIndex = 0;
  const allTells: string[] = [];
  for (const p of story.pages) {
    const matches = p.content.match(tellPhrases);
    if (matches) allTells.push(...matches);
    tellPhrases.lastIndex = 0;
  }
  results.push({
    name: 'Show don\'t tell (no "felt X")',
    passed: allTells.length === 0,
    score: Math.max(0, 1 - allTells.length * 0.2),
    detail: allTells.length === 0
      ? 'No "felt [emotion]" phrases found'
      : `Found ${allTells.length} tell phrases: ${allTells.slice(0, 5).join(", ")}`,
  });

  // 5. Sentence length for age group
  const sentenceLengths = story.pages.flatMap((p) => {
    const sentences = p.content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    return sentences.map((s) => s.trim().split(/\s+/).length);
  });
  const avgSentenceLength = sentenceLengths.length > 0
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0;

  const ageRanges: Record<string, { min: number; max: number }> = {
    "2-3": { min: 3, max: 10 },
    "4-5": { min: 5, max: 18 },
    "6-8": { min: 6, max: 25 },
  };
  const range = ageRanges[params.ageGroup] || ageRanges["4-5"];
  const sentenceScore = avgSentenceLength >= range.min && avgSentenceLength <= range.max
    ? 1
    : avgSentenceLength < range.min
      ? avgSentenceLength / range.min
      : Math.max(0, 1 - (avgSentenceLength - range.max) / range.max);

  results.push({
    name: "Sentence length for age",
    passed: avgSentenceLength >= range.min && avgSentenceLength <= range.max,
    score: sentenceScore,
    detail: `Avg ${avgSentenceLength.toFixed(1)} words/sentence (target: ${range.min}-${range.max} for age ${params.ageGroup})`,
  });

  // 6. Characters referenced
  const allText = story.pages.map((p) => p.content).join(" ");
  const referencedChars = params.characterNames.filter((name) => {
    const firstName = name.split(" ")[0];
    return allText.includes(firstName);
  });
  results.push({
    name: "Characters referenced",
    passed: referencedChars.length === params.characterNames.length,
    score: params.characterNames.length > 0 ? referencedChars.length / params.characterNames.length : 1,
    detail: `${referencedChars.length}/${params.characterNames.length} characters appear: ${referencedChars.join(", ")}`,
  });

  // 8. Image prompts present
  const pagesWithPrompts = story.pages.filter((p) => p.image_prompt && p.image_prompt.length > 20);
  results.push({
    name: "Image prompts present",
    passed: pagesWithPrompts.length === story.pages.length,
    score: story.pages.length > 0 ? pagesWithPrompts.length / story.pages.length : 0,
    detail: `${pagesWithPrompts.length}/${story.pages.length} pages have image prompts`,
  });

  // 9. No moral/lesson stated
  const moralPhrases = /\b(learned that|the moral|the lesson|and so .+ learned|realized that the most important)\b/gi;
  const moralMatches: string[] = [];
  for (const p of story.pages) {
    const matches = p.content.match(moralPhrases);
    if (matches) moralMatches.push(...matches);
    moralPhrases.lastIndex = 0;
  }
  results.push({
    name: "No stated moral/lesson",
    passed: moralMatches.length === 0,
    score: moralMatches.length === 0 ? 1 : Math.max(0, 1 - moralMatches.length * 0.3),
    detail: moralMatches.length === 0
      ? "No explicit moral/lesson found"
      : `Found: ${moralMatches.slice(0, 3).join(", ")}`,
  });

  // 10. Title exists and is reasonable
  results.push({
    name: "Title quality",
    passed: story.title.length >= 3 && story.title.length <= 60,
    score: story.title.length >= 3 && story.title.length <= 60 ? 1 : 0.5,
    detail: `"${story.title}" (${story.title.length} chars)`,
  });

  // 10. Banned vocabulary check
  const bannedByAge: Record<string, string[]> = {
    "2-3": ["magnificent", "enormous", "glistened", "endeavored", "peculiar", "exclaimed", "whispered", "murmured", "pondered", "gazed", "glimmered", "spectacular", "extraordinary", "remarkable", "determined", "cautiously", "approached", "discovered", "adventure", "realized", "suddenly", "certainly", "absolutely", "particularly", "gently"],
    "4-5": ["endeavored", "contemplated", "magnificent", "glistened", "murmured", "pondered", "peculiar", "extraordinary", "spectacle", "remarkable", "commenced", "exclaimed", "determination", "reluctantly", "presumably", "consequently", "nevertheless"],
    "6-8": ["endeavored", "contemplated", "commenced", "nevertheless", "consequently", "presumably", "furthermore", "henceforth", "subsequently", "wherein", "albeit", "moreover"],
  };
  const banned = bannedByAge[params.ageGroup] || bannedByAge["4-5"];
  const foundBanned: string[] = [];
  const lowerText = allText.toLowerCase();
  for (const word of banned) {
    if (lowerText.includes(word.toLowerCase())) {
      foundBanned.push(word);
    }
  }
  results.push({
    name: "Banned vocabulary",
    passed: foundBanned.length === 0,
    score: Math.max(0, 1 - foundBanned.length * 0.15),
    detail: foundBanned.length === 0
      ? `No banned words found for age ${params.ageGroup}`
      : `Found ${foundBanned.length} banned words: ${foundBanned.join(", ")}`,
  });

  return results;
}
