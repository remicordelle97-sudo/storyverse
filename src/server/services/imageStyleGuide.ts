/**
 * Image Style Guide for children's book illustration generation.
 *
 * Structured similarly to story structure guidelines — age-specific
 * and mood-specific rules injected into every image prompt.
 */

const ART_STYLE = `ART STYLE:
- Medium: Soft digital painting with a handmade watercolor feel. Visible texture and gentle color bleeds at edges. NOT flat vector art, NOT photorealistic.
- Lines: Soft, slightly sketchy outlines in a warm dark brown (not pure black). Lines should feel hand-drawn, not computer-perfect.
- Texture: Subtle paper grain across the entire image. Paint-like texture in filled areas. Gentle noise, not smooth gradients.
- Aesthetic: Warm, inviting, and slightly whimsical. Think Oliver Jeffers meets Jon Klassen. Approachable, not precious.`;

const COLOR_RULES = `COLOR PALETTE:
- Build every image from a limited palette of 5-7 hues. Do not introduce random colors.
- Shadows: Use cool muted blues and soft purples. NEVER use pure black for shadows.
- Highlights: Warm pale yellows and soft pinks. NEVER use pure white for highlights.
- Outlines and details: Warm dark brown, not black.
- Reserve the most saturated, vivid colors for the focal point of the scene (usually the main character or the key action).
- Background colors should be softer and more muted than foreground elements to create natural depth.`;

const COMPOSITION_RULES = `COMPOSITION:
- Place the main character at a rule-of-thirds intersection point, not dead center.
- Characters moving or looking to the RIGHT to guide the reader toward the next page.
- Use leading lines (paths, branches, rivers, gazes) to draw the eye toward the focal point.
- Leave breathing room. Not every inch needs detail. Empty space makes the important elements stronger.
- Leave an area of calm, non-busy space (plain sky, simple ground, soft gradient) where text could be placed. Do NOT generate any text or letters in the image.
- Vary framing across pages: mix close-ups (face and shoulders) with medium shots (full body) and wide shots (character small in a big landscape).
- Frame characters using environmental elements when possible: doorways, tree branches, cave openings, window frames.`;

const CHARACTER_RENDERING = `CHARACTER RENDERING:
- Eyes are the most important feature. Draw them LARGE, expressive, and clearly readable. Eyes communicate the emotion of the scene.
- Facial expressions must match the story text's emotion. Show feelings through the whole body: ears, tail, posture, hand/paw position.
- Each character has identity anchors (listed in the character sheet) that MUST appear in every single image: signature colors, clothing, accessories, distinguishing marks.
- Maintain consistent proportions for each character across all pages. If a character is small and round on page 1, they must be small and round on page 10.
- Characters should be DOING something (running, reaching, looking, building) not standing still and posing. Action beats beauty.
- When multiple characters appear, show their relationship through proximity, body language, and eye direction.`;

const LIGHTING_RULES = `LIGHTING:
- Use consistent lighting direction throughout the story. Pick one and stick with it.
- Default: Warm, soft light from the upper left, as if late afternoon sun is filtering through. Gentle, never harsh.
- Shadows are soft and diffused, not sharp-edged. They use cool blues, never black.
- For night scenes: Deep blues and purples for the sky and shadows. Use warm point light sources (lanterns, campfires, glowing objects) in yellow-orange to create focal points and confirm the darkness.
- For indoor scenes: Warm ambient light with slightly stronger directional light from a window or lamp.
- Avoid dramatic, cinematic lighting. This is a children's book, not a movie poster.`;

const MOOD_PALETTES: Record<string, string> = {
  gentle: `MOOD PALETTE — Gentle & Calming:
- Dominant tones: Soft lavender, dusty rose, pale sage green, warm cream
- Accents: Muted gold, powder blue
- Atmosphere: Hazy, dreamy, low contrast. Soft edges everywhere. Colors feel like they're seen through a warm mist.
- Lighting: Golden hour warmth. Everything bathed in soft amber light.`,

  funny: `MOOD PALETTE — Funny & Silly:
- Dominant tones: Bright teal, warm orange, cheerful yellow, lime green
- Accents: Hot pink, electric purple
- Atmosphere: High energy, punchy contrast. Colors pop and bounce. Slightly exaggerated proportions.
- Lighting: Bright and even, like a sunny cartoon. Minimal dramatic shadows.`,

  exciting: `MOOD PALETTE — Exciting Adventures:
- Dominant tones: Rich gold, deep teal, warm terracotta, forest green
- Accents: Bright red-orange, sunflower yellow
- Atmosphere: Bold and dynamic. Strong value contrast between light and shadow. Rich, saturated environments.
- Lighting: Strong directional light creating depth and drama (but still warm and approachable).`,

  mysterious: `MOOD PALETTE — Mysterious & Magical:
- Dominant tones: Deep indigo, twilight purple, emerald green, midnight blue
- Accents: Glowing gold, silver-white, bioluminescent cyan
- Atmosphere: Rich and atmospheric. Deep shadows with pockets of magical light. Slightly cool overall with warm accents on magical elements.
- Lighting: Low ambient light with strong warm accents from magical sources (glowing crystals, starlight, fireflies).`,
};

const AGE_COMPLEXITY: Record<string, string> = {
  "2-3": `SCENE COMPLEXITY — Ages 2-3:
- Maximum 1-2 characters per image. Never more.
- Backgrounds: Very simple. A single color gradient, a few gentle shapes (hills, clouds). No complex environments.
- Character size: LARGE relative to the frame. The character should fill at least 40-50% of the image.
- Detail level: Minimal. Clear, bold shapes. No tiny intricate details that a toddler can't parse.
- Colors: High contrast between character and background. Bold, primary-leaning colors.
- Expressions: Simple and exaggerated. A big smile, wide surprised eyes. Readable from across a room.`,

  "4-5": `SCENE COMPLEXITY — Ages 4-5:
- Maximum 3-4 characters per image.
- Backgrounds: Moderate detail. Recognizable environments (a forest, a room, a path) with some texture and props, but not overwhelming.
- Character size: Medium-large in the frame. Main character clearly dominant.
- Detail level: Some fun details that reward close looking (a ladybug on a leaf, a funny sign, a hidden mouse). These create re-reading value.
- Colors: Bold and saturated, with more variety than toddler images. Can use 6-8 colors.
- Expressions: Clear and readable, with more nuance than toddler images (nervous smile, curious tilt of the head).`,

  "6-8": `SCENE COMPLEXITY — Ages 6-8:
- Can include 4-5 characters if the scene calls for it.
- Backgrounds: Rich, detailed environments that reward exploration. Texture, depth, atmospheric perspective.
- Character size: Varies by scene. Can be small in a vast landscape for adventure/wonder, or large close-up for emotional moments.
- Detail level: Rich. Hidden details, visual jokes, environmental storytelling (objects that tell a story even without text). Foreshadowing through visual clues.
- Colors: Sophisticated palette. Can include subtle tones alongside bold accents. More color variety and nuance.
- Expressions: Full emotional range conveyed through subtle body language, not just faces. Posture, hand position, eye direction all matter.`,
};

const CONTINUITY_RULES = `CONTINUITY:
- Every image in a story must feel like it belongs to the same book. Same art style, same palette family, same lighting approach, same level of detail.
- Characters must look identical to their reference images. Same proportions, same colors, same distinguishing features. If a character has a blue backpack, it appears in EVERY image where that character appears.
- Recurring locations must look the same each time they appear (same trees, same colors, same layout).
- If the story has a color arc (mood shifts), the shift should be gradual, not jarring. Transition through intermediate tones.`;

/**
 * Build the complete style guide for a specific story context.
 */
export function buildImageStyleGuide(
  mood: string,
  ageGroup: string,
  illustrationStyle?: string
): string {
  const moodKey = mood.toLowerCase().split(" ")[0]; // "exciting adventures" → "exciting"
  const moodPalette = MOOD_PALETTES[moodKey] || MOOD_PALETTES["exciting"];
  const ageComplexity = AGE_COMPLEXITY[ageGroup] || AGE_COMPLEXITY["4-5"];

  let guide = `=== ILLUSTRATION STYLE GUIDE ===\n\n`;

  if (illustrationStyle && illustrationStyle !== "storybook") {
    guide += `ART STYLE OVERRIDE: Use a ${illustrationStyle} illustration style instead of the default.\n\n`;
  } else {
    guide += `${ART_STYLE}\n\n`;
  }

  guide += `${COLOR_RULES}\n\n`;
  guide += `${moodPalette}\n\n`;
  guide += `${ageComplexity}\n\n`;
  guide += `${CHARACTER_RENDERING}\n\n`;
  guide += `${COMPOSITION_RULES}\n\n`;
  guide += `${LIGHTING_RULES}\n\n`;
  guide += `${CONTINUITY_RULES}\n\n`;

  return guide;
}
