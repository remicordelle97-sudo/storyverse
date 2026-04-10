import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";

interface PromptInput {
  universeId: string;
  characterIds: string[];
  mood: string;
  language: string;
  ageGroup: string;
  structure: string;
  length: "short" | "long";
  parentPrompt: string;
}

const AGE_GUIDELINES: Record<string, string> = {
  "2-3": `WRITING LEVEL — Ages 2-3 (Toddler):
- Each page has 1-2 short sentences (3-6 words each).
- No conflict, tension, or scary moments — everything is gentle and safe.
- Repeat key phrases throughout the story as a refrain the child can anticipate and join in on. For example: "And off they went, step by step!" should appear at least 3 times.
- Focus on sensory details: describe colours, sounds, textures, smells ("the warm sand", "the red flower").
- Characters express only simple emotions: happy, sad, surprised, sleepy. SHOW emotions through actions ("Leo's tail wagged") not labels ("Leo felt happy").
- End with warmth, hugs, or bedtime cues.

SENTENCE STRUCTURE — Ages 2-3:
- ONE clause per sentence. No compound sentences. No "and then" joining two actions.
- Pattern: Subject + Verb, or Subject + Verb + Object. That is it.
- Maximum ONE adjective per noun. "The big rock." NOT "the big round smooth rock."
- No subordinate clauses. No "while," "because," "although," "when," "before," "after," "which," "that."
- No commas except in lists of exactly 2 items.
- GOOD sentences: "Leo sat down." "The rock was red." "Zuri found a stick." "The water was cold."
- BAD sentences: "Leo sat down on the warm, soft sand near the big tree." "While looking at the sky, Zuri noticed a bird flying over the hill."

VOCABULARY — Ages 2-3:
- Use ONLY words a toddler hears in daily life. One or two syllable words almost exclusively.
- Animal names, colors, sounds, actions, body parts, food, and feelings are fine.
- No abstract concepts (no "courage", "loyalty", "wisdom", "journey").
- No adult literary words. Use "big" not "enormous." Use "happy" not "delighted." Use "ran" not "dashed." Use "said" not "exclaimed."
- BANNED words for this age: magnificent, enormous, glistened, endeavored, peculiar, exclaimed, whispered, murmured, pondered, gazed, glimmered, spectacular, extraordinary, remarkable, determined, cautiously, approached, discovered, adventure, realized, suddenly, certainly, absolutely, particularly, gently.
- VOCABULARY CHECK: Before writing each sentence, ask yourself: would a 2-year-old understand every single word? If ANY word might be unfamiliar, replace it with a simpler one.`,

  "4-5": `WRITING LEVEL — Ages 4-5 (Early Reader):
- Each page has 2-3 sentences.
- Include a recurring phrase or refrain that appears at key moments — something the child can predict and say along with the reader.
- Gentle tension is OK (a lost item, a small misunderstanding) but resolve it within a few pages.
- SHOW emotions through actions, body language, and dialogue — never state them. Write "Zuri's ears went flat" not "Zuri felt scared."
- Include at least 2-3 sensory details per page: what things look, sound, smell, feel, or taste like.
- Use light humour, funny sounds, and playful dialogue.
- Be bold and surprising — children love the outrageous and unexpected. Think big: a puddle that leads to an underground garden, a tree that grows a new door every morning, a rock that's warm like a sleeping animal.
- Always resolve uncertainty before the story ends.

SENTENCE STRUCTURE — Ages 4-5:
- Maximum ONE clause per sentence for most sentences.
- Occasionally TWO clauses joined by "and" or "but" — no more than once per page.
- No "while," "although," "however," "meanwhile," "furthermore." Only "and," "but," "so" to join clauses.
- Maximum TWO adjectives per noun.
- 6-12 words per sentence.
- Keep Subject-Verb-Object order. Do NOT start sentences with prepositional phrases or subordinate clauses.
- GOOD sentences: "Leo picked up the blue stone." "Zuri ran fast, but she stopped at the river." "The cave was dark and cold."
- BAD sentences: "While walking through the meadow, Leo noticed something shiny between the roots of the old oak tree." "The soft, warm, golden light that filtered through the ancient canopy made everything glow."

VOCABULARY — Ages 4-5:
- Prefer simple, punchy, concrete words over fancy ones. "Big" not "enormous." "Ran" not "dashed." "Tried" not "endeavored." "Looked" not "gazed."
- ONE new or interesting word per page is OK IF the meaning is completely obvious from the sentence around it.
- No adult literary vocabulary. No words a parent would need to explain.
- BANNED words for this age: endeavored, contemplated, magnificent, glistened, murmured, pondered, peculiar, extraordinary, spectacle, remarkable, commenced, exclaimed, approached cautiously, determination, reluctantly, presumably, consequently, nevertheless.
- VOCABULARY CHECK: Before writing each sentence, ask: would a 4-year-old understand this on first hearing, without any explanation? If not, use a simpler word. The story is read aloud — there is no time to stop and explain.`,

  "6-8": `WRITING LEVEL — Ages 6-8 (Confident Reader):
- Each page has 3-4 sentences.
- SHOW every emotion through actions, body language, and dialogue — never state them directly. Write "Leo clenched his paws and stared at the ground" not "Leo felt frustrated."
- Real stakes and challenges are OK — characters can struggle, fail, and try again.
- Characters can experience complex emotions: embarrassment, jealousy, guilt, determination — conveyed through their actions and words.
- Dialogue should be witty and show distinct character voices — each character should sound different.
- Include at least 2-3 sensory details per page across different senses.
- Be surprising and imaginative — the more inventive and unexpected the world-building details, the more memorable the story. Don't settle for the obvious.
- Subplots and mysteries are welcome — foreshadow and pay off details.
- Themes can include fairness, responsibility, and standing up for others — but NEVER state a moral lesson. Let the reader draw their own conclusions from the characters' experiences.
- The ending should feel earned, not handed to the characters.

SENTENCE STRUCTURE — Ages 6-8:
- Mix of simple sentences (one clause) and compound sentences (two clauses joined by "and," "but," "so").
- Maximum ONE complex sentence per page (using "because," "when," "before," "after").
- No sentence may have more than TWO clauses.
- 8-15 words per sentence.
- Vary sentence length deliberately: short for impact, medium for description.
- GOOD sentences: "Leo climbed the rock and looked out over the valley." "The cave was dark because the sun had set." "Zuri laughed. She could not help it."
- BAD sentences: "Although Leo had been nervous about entering the cave, which was darker than any place he had ever visited before, he took a deep breath and stepped inside." "The ancient, weathered, moss-covered stone archway that marked the entrance to the forgotten tunnels beneath the mountain stood silent in the fading light."

VOCABULARY — Ages 6-8:
- Richer vocabulary is welcome, but prefer strong, vivid, specific words over fancy, literary ones. "Stomped" is better than "proceeded." "Huge" is better than "magnificent."
- If a word might be new to a 6-year-old, the sentence around it MUST make the meaning completely clear without stopping.
- No dictionary words — nothing that sounds like it belongs in an adult novel.
- BANNED words for this age: endeavored, contemplated, commenced, nevertheless, consequently, presumably, furthermore, henceforth, subsequently, wherein, albeit, moreover.
- VOCABULARY CHECK: Read each sentence as if you are hearing it for the first time at age 6. Is every word either already known or immediately clear from context? If you have to think about a word, replace it.`,
};

const STRUCTURE_GUIDELINES: Record<string, string> = {
  "rule-of-three": `STORY STRUCTURE — Rule of Three:
The protagonist must attempt to solve the central problem THREE times. This is one of the oldest and most satisfying patterns in children's storytelling. Think: "The Three Little Pigs" (straw, sticks, bricks), "Goldilocks and the Three Bears" (too hot, too cold, just right), "The Three Billy Goats Gruff" (small, medium, big).

PACING:
- Pages 1-2 (short) / 1-5 (long): Set the scene. Introduce the protagonist in their world. Establish the problem clearly — make it concrete and visual, not abstract.
- First attempt (~25% of pages): The protagonist tries the most obvious solution. It seems to work at first, building hope — then fails in a small, slightly funny way. The failure should reveal something the protagonist didn't know.
- Second attempt (~25% of pages): A completely different approach. The protagonist is more determined. Build tension higher. This attempt fails bigger or in a surprising, unexpected way. The failure should be more emotional — show the protagonist's frustration or doubt through body language and actions.
- Third attempt (~25% of pages): The protagonist pauses. Reflects on what went wrong before. Combines a lesson or detail from BOTH previous failures into a new, creative solution that neither attempt alone could have produced. The success should feel clever and earned.
- Final pages: Celebrate the win. Show how the world or the protagonist has changed. End with warmth and a "wink."

KEY RULES:
- Each attempt must use a genuinely DIFFERENT strategy — not just "try harder."
- The failures must teach something specific that feeds into the final solution.
- Escalate the emotional stakes with each attempt: curiosity → determination → doubt → triumph.
- The third success must feel inevitable in hindsight but surprising in the moment.
- Sprinkle humour into the failures — children love when things go amusingly wrong.`,

  "cumulative": `STORY STRUCTURE — Cumulative (Snowball):
Each new event, character, or detail builds on everything before it, creating a chain that grows and grows until it reaches a satisfying peak or playful collapse. Think: "The House That Jack Built," "If You Give a Mouse a Cookie," "There Was an Old Lady Who Swallowed a Fly."

PACING:
- Page 1: Start with ONE simple action, encounter, or object. Make it vivid and specific.
- Each subsequent page: Introduce ONE new element (a character, object, problem, or event) that connects directly to what came before. The new element should be surprising or funny.
- Middle pages: The chain grows. Each page should briefly reference or callback to earlier elements before adding the new one. The list gets longer and more delightful each time.
- ~75% through: The chain reaches its peak — everything is tangled, stacked, or connected in the most complex, absurd, or wonderful way possible.
- Final pages: The chain either resolves in a satisfying cascade (everything untangles in a pleasing way) or a gentle, humorous collapse (it all comes tumbling down, but everyone is fine and laughing).

KEY RULES:
- The chain must have a clear PATTERN or RHYTHM. Each addition should follow a recognizable format that children can anticipate and join in on.
- Use a recurring phrase or sentence structure that grows with each page ("And THEN..." / "Because of the [X], the [Y]...").
- Each new element should be more unexpected or funnier than the last — escalate the absurdity.
- Never lose track of earlier elements — the whole point is that everything stays connected.
- The resolution should reference the very first element, bringing the chain full circle.
- Keep each individual addition simple enough to remember — the complexity comes from the accumulation, not from any single event.`,

  "circular": `STORY STRUCTURE — Circular:
The story ends where it began — same place, same situation — but the protagonist sees it completely differently because of what they experienced. Think: "Where the Wild Things Are" (bedroom → wild things → bedroom, but Max has processed his anger), "Owl Moon" (goes out → experience → returns home, transformed by wonder).

PACING:
- Pages 1-2 (short) / 1-4 (long): THE ANCHOR SCENE. Describe the protagonist in a very specific place, doing a specific thing, feeling a specific way. Make this scene rich with sensory detail — the reader must REMEMBER it vividly because they will see it again at the end. Include a specific object, phrase, or sensory detail that will return later with new meaning.
- Early pages: Something disrupts the anchor scene or calls the protagonist away. They leave — physically or emotionally — driven by a want, a curiosity, or an event.
- Middle pages: The adventure. New places, encounters, challenges. The protagonist experiences things that gradually shift how they feel or what they understand. Plant at least 2-3 moments that will echo or contrast with the opening.
- ~75% through: The turning point. Something happens — a realization, a connection, a quiet moment — that changes the protagonist's perspective. This doesn't need to be dramatic. Sometimes the most powerful shift is subtle.
- Final pages: THE RETURN. The protagonist is back in the anchor scene — same place, same situation. But now the specific details from the opening carry different weight. The object means something new. The familiar place feels different. Show the change through the protagonist's actions and body language, NOT through narration.

KEY RULES:
- The opening and closing scenes must MIRROR each other closely — same setting, similar actions, echoed phrases or details.
- The difference between opening and closing should be FELT, not explained. Never write "and now they understood..." Show the change.
- The middle journey must contain specific moments that recontextualize the opening.
- At least one phrase, object, or sensory detail from page 1 must reappear on the final page with transformed meaning.
- The emotional arc is: contentment/restlessness → departure → experience → quiet transformation → return with new eyes.`,

  "journey": `STORY STRUCTURE — Journey & Return:
The protagonist leaves the safe and familiar, ventures into unknown territory, faces challenges that change them, and returns home transformed. This is the oldest story structure in human history. Think: "We're Going on a Bear Hunt," "The Snowy Day," "Rosie's Walk."

PACING:
- Pages 1-2 (short) / 1-4 (long): THE KNOWN WORLD. Establish the protagonist's home, routine, or comfort zone with warm, sensory detail. Show what they love about it — but also hint at what pulls them outward (curiosity, a sound, a discovery, a dare, a need).
- Early pages: THE DEPARTURE. The protagonist crosses a threshold — leaves the familiar behind. This can be physical (crossing a river, entering a forest) or emotional (trying something new). Mark the moment clearly so the reader feels the shift.
- Middle pages: THE UNKNOWN. Each new location or encounter should feel progressively MORE different from home. Introduce at least 3 distinct "waypoints" — places, characters, or challenges the protagonist passes through. Each waypoint should test a different quality of the protagonist and teach them something they didn't know.
- ~65% through: THE FURTHEST POINT. This is the moment farthest from home — geographically, emotionally, or both. The biggest challenge or most important discovery happens here. The protagonist must face something that requires them to use everything they've gathered from the journey.
- ~80% through: THE TURN HOMEWARD. The protagonist decides to return — or realizes they must. The return journey should feel different from the outward one. Things that seemed scary on the way out now feel familiar. The protagonist moves with more confidence.
- Final pages: THE HOMECOMING. The protagonist arrives home, but they are not the same. They bring something back — a new friend, a treasure, a skill, a memory, or simply a new way of seeing their old world. Home feels both the same and different.

KEY RULES:
- The journey must have a clear DIRECTION — outward and then back. The reader should feel the distance from home growing and then shrinking.
- Each waypoint should be vivid and distinct — different sights, sounds, smells, textures.
- The furthest point must be the emotional climax, not just the geographical one.
- The protagonist must be visibly changed by the journey — show it through their actions on the return, not through narration.
- The homecoming should echo the opening but with subtle, meaningful differences.
- What the protagonist brings back (literal or metaphorical) should connect to what they were missing or wanting at the start.`,

  "problem-solution": `STORY STRUCTURE — Problem & Solution:
A clear, concrete problem is introduced early. The protagonist works through it with ingenuity, effort, and help from their unique qualities. The solution is earned, not given. Think: "Corduroy" (missing button), "Knuffle Bunny" (lost toy), "Dragons Love Tacos" (the wrong salsa).

PACING:
- Pages 1-2 (short) / 1-4 (long): THE WORLD BEFORE. Show the protagonist in their normal life. Establish their personality, their quirks, what they care about. Everything is fine — or almost fine. Plant a small detail that will become important later.
- Early pages: THE PROBLEM ARRIVES. Something goes wrong, goes missing, shows up unexpectedly, or needs to be done. Make the problem concrete and visual — something the reader can picture and care about. The problem should feel urgent to the protagonist even if it seems small to an adult.
- Middle pages: THE WORKING-THROUGH. This is the heart of the story. The protagonist tries to solve the problem. Show them:
  * First noticing and reacting to the problem (body language, not labels)
  * Thinking about what to do (show them looking around, gathering things, talking to friends)
  * Making an attempt that partially works or doesn't work
  * Adjusting their approach based on what they learned
  * Possibly getting help from a friend — but the protagonist must drive the solution, not the helper
- ~75% through: THE BREAKTHROUGH. The protagonist has an idea — or notices something — that changes everything. This moment should connect to their established personality traits or to a detail planted earlier. The reader should feel "of course!" not "where did that come from?"
- Final pages: THE RESOLUTION. The problem is solved. Show the relief, the joy, the satisfaction through actions and reactions. Then show how things have settled into a new normal — slightly better than before because of what happened.

KEY RULES:
- The problem must be introduced clearly and early. The reader should be able to state in one sentence what the protagonist needs to do.
- The protagonist must solve the problem using their OWN qualities, skills, or personality traits — never rescued by an adult or random luck.
- Show the PROCESS of problem-solving, not just the result. Children learn from watching characters think, try, fail, and adapt.
- The solution should connect to something established earlier in the story — a detail, a skill, a relationship. No deus ex machina.
- Friends can help, but the protagonist must be the one who figures out the key insight or takes the decisive action.
- The emotional arc is: normal → disruption → concern → effort → frustration → insight → triumph → new normal.`,

  "unlikely-friendship": `STORY STRUCTURE — Unlikely Friendship:
Two characters who seem incompatible, different, or even opposed discover a genuine connection. The story is about how they move from distance to closeness. Think: "Charlotte's Web" (a pig and a spider become inseparable), "The Fox and the Hound" (natural enemies become best friends), "Frog and Toad" (an adventurous frog and a cautious toad find balance), "Stellaluna" (a bat raised by birds discovers belonging), "Enemy Pie" (a boy tries to defeat his enemy and accidentally makes a friend).

PACING:
- Pages 1-2 (short) / 1-4 (long): THE TWO WORLDS. Introduce the two characters separately. Show how different they are — different habitats, different habits, different temperaments, different ways of seeing the world. Make each character vivid and sympathetic in their own right. The reader should like both of them individually before they meet.
- Early pages: THE ENCOUNTER. The two characters meet — by accident, by necessity, or by circumstance. First impressions are wrong or awkward. There may be suspicion, confusion, a misunderstanding, or simply not knowing what to make of each other. Neither character is a villain — they are just different.
- Middle pages: THE FRICTION AND THE FINDING. The characters are thrown together by circumstance (stuck in the same place, given the same task, caught in the same problem). Through spending time together, they discover surprising things they have in common, or they find that their differences complement each other. Show specific small moments of connection: a shared laugh, a moment of unexpected help, a discovery that the other is not what they assumed.
- ~60% through: THE TEST. Something happens that threatens the budding friendship. A misunderstanding, an outside pressure, a moment where one character's instincts clash with the other's. One character may pull away or say something hurtful. This is the emotional low point.
- ~75% through: THE CHOICE. One or both characters must actively choose the friendship. This is not automatic — it requires vulnerability, courage, or sacrifice. One character reaches out, apologizes, shows up when it matters, or puts the other's needs first. The choice must come from who the character IS, not from external pressure.
- Final pages: THE NEW NORMAL. The two characters are together, and the world feels different because of it. They have not become the same — they are still different — but those differences now feel like strengths. End with a warm, specific moment that shows the friendship is real: a shared ritual, a private joke, a quiet comfort.

KEY RULES:
- Neither character should be wrong or bad for being who they are. The story is not about one character "fixing" the other. It is about two complete individuals finding unexpected connection.
- The differences between the characters must be SPECIFIC and VISUAL, not abstract. Show it through behavior, habits, and reactions — not through narration.
- The moments of connection must feel earned and organic. Do not rush from "strangers" to "best friends." Let the relationship develop through concrete shared experiences.
- The emotional low point (The Test) must come from the characters' genuine differences, not from a contrived external villain or misunderstanding.
- Show, don't tell, the growing closeness. Use proximity, mirroring behavior, and shared language to show the characters becoming friends without saying "they became friends."
- The ending should honor both characters' identities. They do not merge — they complement. The frog is still a frog, the toad is still a toad, and that is what makes it beautiful.
- The emotional arc is: separation → curiosity → friction → small connections → rupture → choice → belonging.`,
};

export function buildSystemPrompt(ageGroup: string): string {
  const guidelines = AGE_GUIDELINES[ageGroup] || AGE_GUIDELINES["4-5"];

  return `You are a gentle, imaginative children's story writer.
You write age-appropriate stories that are warm, vivid, and satisfying.
Always stay true to each character's established personality and appearance.
Never introduce plot threads you cannot resolve within this story.
End every story with a sense of calm, comfort, or small triumph — followed by a small "wink": a tiny joke, warm callback, or playful final line that makes the ending linger.

CRITICAL RULES:
- The protagonist must solve their own problems. NEVER have an adult, parent, or outside force save the day.
- SHOW emotions through actions and body language. NEVER write "felt happy/sad/scared." Instead show: tail wagging, ears drooping, fists clenching, eyes widening.
- Vary emotional tone across pages. Alternate excitement, tenderness, worry, wonder, and triumph. Never stay at one emotional register.
- Write for read-aloud. The text must sound natural and musical when spoken. Use rhythm, natural pauses, and flow.
- Be bold, surprising, and imaginative. The more inventive and unexpected the details, the more memorable the story.
- NEVER state a moral or lesson. Do NOT write "and Leo learned that..." or "the moral of the story is..." Let the reader draw their own conclusions from the characters' experiences and choices.
- NEVER use the em dash character (—). Use commas, periods, or "and" instead.
- Use exclamation marks sparingly. Most sentences should end with periods. Reserve ! for genuine surprise, outcries, or single emphatic moments (like "Help!" or "Look!"). Never use more than one ! per page. Let word choice and sentence rhythm convey excitement, not punctuation.

CLARITY RULES:
- The problem must be obvious by page 2. After hearing pages 1 and 2, a child must be able to answer "what does the character want?" and "what's stopping them?" If the listener doesn't know what the story is about by page 2, you have failed.
- Don't tease, deliver. If page 1 mentions a job, task, secret, or mystery, the SAME page or the NEXT page must make it concrete. Never leave the reader wondering "what job?" or "what secret?" for more than one page turn. Vague hooks frustrate young listeners.
- Every pronoun must have an obvious referent. "It", "the thing", "the secret" can only be used if the reader already knows EXACTLY what it refers to from the same page or the previous page. When in doubt, use the specific noun.
- Page 1 must ground the reader. The opening page should establish WHO the character is, WHERE they are, and WHAT IS HAPPENING right now. Do not open with a mystery or tease. Save surprises for after the reader is oriented.
- No orphaned setups. If you introduce a detail, question, or problem, it must connect to the story within 2 pages. If it doesn't, cut it.

- Return ONLY valid JSON. No markdown fences, no preamble, no explanation.

${guidelines}`;
}

export interface BuiltPrompt {
  planMessage: string;
  writeMessage: string;
  ageGroup: string;
}

export async function buildPrompt(input: PromptInput): Promise<BuiltPrompt> {
  const universe = await prisma.universe.findUniqueOrThrow({
    where: { id: input.universeId },
  });

  const characters = await prisma.character.findMany({
    where: { id: { in: input.characterIds } },
  });

  const pageCount = input.length === "short" ? 10 : 32;

  // Fetch locations for the universe
  const locations = await prisma.location.findMany({
    where: { universeId: input.universeId },
    orderBy: { createdAt: "asc" },
  });

  // Story structure
  const structureGuide =
    STRUCTURE_GUIDELINES[input.structure] ||
    STRUCTURE_GUIDELINES["problem-solution"];

  // === PLAN PROMPT: universe + characters + locations + structure + request ===
  let planPrompt = `=== UNIVERSE ===
Name: ${universe.name}
Setting: ${universe.settingDescription}
${universe.sensoryDetails ? `Sensory details: ${universe.sensoryDetails}` : ""}
${universe.worldRules ? `World rules: ${universe.worldRules}` : ""}
${universe.scaleAndGeography ? `Scale & geography: ${universe.scaleAndGeography}` : ""}
Themes: ${universe.themes}
Avoid: ${universe.avoidThemes}

IMPORTANT: The universe details above are BACKDROP, not plot. Use them to COLOR the setting (sprinkle in sensory details, mention landmarks in passing, let the world rules affect things naturally) but do NOT build the main story around any single universe detail. The story's plot should come from the CHARACTERS and the PARENT'S REQUEST below, not from the setting description. A child re-reading many stories in this universe should experience different adventures each time, not variations on the same world feature.

=== CHARACTERS (for storytelling) ===
Characters are complex — don't try to demonstrate every personality trait in a single story. Pick 1-2 traits that fit the plot naturally and let the others stay in the background. Special details are fun touches, not plot devices — a character's quirk might appear once in passing, not in every scene.
`;

  for (const char of characters) {
    planPrompt += `Name: ${char.name} (${char.speciesOrType})`;
    planPrompt += `\nPersonality: ${char.personalityTraits}`;
    if (char.relationshipArchetype && char.role !== "main") planPrompt += `\nArchetype: ${char.relationshipArchetype}`;
    if (char.specialDetail) planPrompt += `\nSpecial detail: ${char.specialDetail}`;
    planPrompt += `\nRole: ${char.role}\n\n`;
  }

  if (locations.length > 0) {
    planPrompt += `=== LOCATIONS ===
Use ONLY these locations in the story. Do not invent new locations. Reference them by name.\n\n`;
    for (const loc of locations) {
      planPrompt += `${loc.name} (${loc.role}): ${loc.description}`;
      if (loc.landmarks) {
        planPrompt += ` Key landmarks: ${loc.landmarks}`;
      }
      planPrompt += `\n`;
    }
    planPrompt += `\n`;
  }

  planPrompt += `${structureGuide}

=== STORY REQUEST ===
Reading level: ${input.ageGroup}
Language: ${input.language}
Mood: ${input.mood}
Total pages: ${pageCount}
Parent's request: "${input.parentPrompt}"`;

  // === WRITE PROMPT: sentence count + output format only (plan is prepended by storyGenerator) ===
  const sentenceRule: Record<string, string> = {
    "2-3": "EXACTLY 1-2 sentences per page. Each sentence must be 3-6 words. This is a HARD LIMIT — if a page has 3 or more sentences, you have failed.",
    "4-5": "EXACTLY 2-3 sentences per page. Each sentence must be 6-12 words. This is a HARD LIMIT — if a page has 4 or more sentences, you have failed.",
    "6-8": "EXACTLY 3-4 sentences per page. Each sentence must be 8-15 words. This is a HARD LIMIT — if a page has 5 or more sentences, you have failed.",
  };
  const sentenceConstraint = sentenceRule[input.ageGroup] || sentenceRule["4-5"];

  const writePrompt = `=== SENTENCE COUNT (HARD CONSTRAINT) ===
${sentenceConstraint}
Count your sentences on EVERY page before finalizing. If any page exceeds the limit, split it or cut words. This is the single most important formatting rule.

=== OUTPUT FORMAT ===
Return exactly this JSON structure and nothing else.
The "pages" array must contain exactly ${pageCount} page objects.

IMAGE PROMPT RULES:
The image_prompt should describe the SCENE, not the characters' bodies. Character reference images are provided separately to the illustrator. For each image_prompt:
- Name each character present (use their full name, e.g., "Leo the Lion")
- Describe their EXPRESSION and BODY LANGUAGE (e.g., "looking excited, leaning forward", "sitting sadly with head down")
- Describe the SETTING and ENVIRONMENT in detail (location, time of day, weather, key objects)
- Describe the ACTION — what is happening in this moment
- Describe the MOOD and ATMOSPHERE of the scene
- Do NOT describe characters' physical bodies, species details, or clothing — the illustrator already has reference images for that
- Keep image_prompts to 2-3 sentences focused on scene, action, and emotion
- "location" must be the EXACT name of a location from the story plan. Use the same name every time a location recurs

{
  "title": "Story title",
  "pages": [
    {
      "page_number": 1,
      "content": "Page text here...",
      "image_prompt": "Scene description focused on setting, action, and emotion.",
      "characters_in_scene": ["Leo the Lion", "Zuri the Zebra"],
      "location": "The Savanna"
    }
  ]
}`;

  debug.prompt("Prompt assembled", {
    universe: universe.name,
    characters: characters.map((c) => c.name).join(", "),
    structure: input.structure,
    ageGroup: input.ageGroup,
    pageCount,
    planChars: planPrompt.length,
    writeChars: writePrompt.length,
  });

  return { planMessage: planPrompt, writeMessage: writePrompt, ageGroup: input.ageGroup };
}
