/**
 * Image Style Guide for children's book illustration generation.
 *
 * Structured similarly to story structure guidelines — age-specific
 * and mood-specific rules injected into every image prompt.
 */

export const ART_STYLE = `ART STYLE — watercolor on textured paper:
CRITICAL: DO NOT draw outlines. DO NOT draw borders around shapes. DO NOT use linework.
- Medium: Traditional watercolor illustration on cold-pressed watercolor paper. Transparent washes of color that bleed and bloom into each other. Pigment pools in darker areas, paper shows through in highlights.
- Edges: NO hard outlines or drawn borders. Shapes are defined by wet color meeting wet color — soft, feathered, organic edges. Some edges crisp where a wet wash meets dry paper, others blurry where colors bleed together. This variation is natural and beautiful.
- Texture: Visible watercolor paper grain throughout. Uneven washes with water blooms, pigment granulation, and soft cauliflower edges where washes dried unevenly. Nothing digitally smooth.
- Colors: Warm, transparent, luminous. Colors glow because light passes through the paint and bounces off the white paper underneath. Layer transparent washes for depth — never opaque.
- Aesthetic: Loose, expressive, handmade. Think Iwasaki Chihiro, E.H. Shepard, or Beatrix Potter. Warm and tender, with the charming imperfection of real hand-painted watercolor.
- FORBIDDEN: outlines, linework, ink borders, cel shading, anime style, vector art, digital art, 3D rendering, photorealism, sharp drawn contours, opaque flat colors.`;

const COLOR_RULES = `COLOR PALETTE:
- Build every image from a limited palette of 5-7 hues. Do not introduce random colors.
- Shadows: Use cool muted blues and soft purples. NEVER use pure black for shadows.
- Highlights: Let the white of the paper show through. Use warm pale yellows sparingly. NEVER use pure white paint for highlights.
- Reserve the most saturated, vivid colors for the focal point of the scene (usually the main character or the key action).
- Background colors should be softer and more muted than foreground elements to create natural depth.`;

const COMPOSITION_RULES = `COMPOSITION:
- Place the main character at a rule-of-thirds intersection point, not dead center.
- Characters moving or looking to the RIGHT to guide the reader toward the next page.
- Use leading lines (paths, branches, rivers, gazes) to draw the eye toward the focal point.
- Leave breathing room. Not every inch needs detail. Empty space makes the important elements stronger.
- Leave an area of calm, non-busy space (plain sky, simple ground, soft gradient) where text could be placed. Do NOT generate any text or letters in the image.
- Frame characters using environmental elements when possible: doorways, tree branches, cave openings, window frames.

VARIETY ACROSS PAGES:
- Each page should show a different scene from the story. Avoid repeating the same background or character arrangement on consecutive pages.
- Vary how much of the environment is visible — some pages show more of the world, others focus more closely on the characters.
- The reader should feel like they are moving through the story, not looking at the same picture repeated.`;

const CHARACTER_RENDERING = `CHARACTER RENDERING:
- Eyes should be LARGE and expressive but in a stylized, illustrated way — NOT photorealistic or hyper-detailed. Simple round eyes with clear pupils, matching the soft painterly style. No photorealistic reflections, no complex iris detail, no Disney-style sparkle effects. Eyes should feel drawn/painted, not rendered.
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

const SIMPLICITY_RULES = `SIMPLICITY:
- Every image should read clearly at a glance. A child should instantly understand WHO is in the scene and WHAT is happening.
- Use simple, uncluttered backgrounds. A few well-chosen elements (one tree, a path, a hill) are better than a dense forest of details. Let the watercolor paper breathe.
- Limit objects in each scene to what the story text mentions. Do not fill empty space with extra props, decorations, or background clutter.
- Characters are the focal point. The background supports them, it does not compete with them.
- Prefer large, clear shapes over intricate patterns. A single bold flower is better than a field of tiny detailed ones.
- Avoid busy textures, complex patterns on clothing or surfaces, and fine crosshatching. Keep surfaces soft and simple.
- When in doubt, leave it out. Negative space and soft washes are more beautiful than noise.`;

const CONTINUITY_RULES = `CONTINUITY:
- Every image in a story must feel like it belongs to the same book. Same art style, same palette family, same lighting approach, same level of detail.
- Characters must look identical to their reference images. Same proportions, same colors, same distinguishing features. If a character has a blue backpack, it appears in EVERY image where that character appears.
- Recurring locations must look the same each time they appear (same trees, same colors, same layout).
- If the story has a color arc (mood shifts), the shift should be gradual, not jarring. Transition through intermediate tones.`;

/**
 * Build the complete style guide for a specific story context.
 */
export const ART_STYLE_REMINDER = `Watercolor style — soft transparent washes, NO outlines, NO linework, visible paper texture.`;

export function buildImageStyleGuide(
  mood: string,
  illustrationStyle?: string
): string {
  const moodKey = mood.toLowerCase().split(" ")[0]; // "exciting adventures" → "exciting"
  const moodPalette = MOOD_PALETTES[moodKey] || MOOD_PALETTES["exciting"];

  let guide = `=== ILLUSTRATION STYLE GUIDE ===\n\n`;

  if (illustrationStyle && illustrationStyle !== "storybook") {
    guide += `ART STYLE OVERRIDE: Use a ${illustrationStyle} illustration style instead of the default.\n\n`;
  } else {
    guide += `${ART_STYLE}\n\n`;
  }

  guide += `${COLOR_RULES}\n\n`;
  guide += `${moodPalette}\n\n`;
  guide += `${CHARACTER_RENDERING}\n\n`;
  guide += `${COMPOSITION_RULES}\n\n`;
  guide += `${SIMPLICITY_RULES}\n\n`;
  guide += `${LIGHTING_RULES}\n\n`;
  guide += `${CONTINUITY_RULES}\n\n`;

  return guide;
}
