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
- Image border: The illustration should have SOFT, IRREGULAR edges that fade naturally into the white paper — like a real watercolor painting where the paint thins out at the margins. Do NOT create a sharp rectangular border, a ruled frame, or a clean-cut edge. Let the color bleed unevenly into the paper at the edges.
- FORBIDDEN: outlines, linework, ink borders, cel shading, anime style, vector art, digital art, 3D rendering, photorealism, sharp drawn contours, opaque flat colors, hard rectangular image borders.`;

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
- Frame characters using environmental elements when possible: doorways, tree branches, cave openings, window frames.`;


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
- If the story has a color arc (mood shifts), the shift should be gradual, not jarring. Transition through intermediate tones.`;

/**
 * Build the complete style guide for a specific story context.
 */
export const ART_STYLE_REMINDER = `Watercolor style — soft transparent washes, NO outlines, NO linework, visible paper texture. Soft irregular edges that fade into the white paper, NO sharp rectangular borders.`;

export function buildImageStyleGuide(): string {
  let guide = `=== ILLUSTRATION STYLE GUIDE ===\n\n`;
  guide += `${ART_STYLE}\n\n`;
  guide += `${COLOR_RULES}\n\n`;
  guide += `${COMPOSITION_RULES}\n\n`;
  guide += `${SIMPLICITY_RULES}\n\n`;
  guide += `${CONTINUITY_RULES}\n\n`;
  return guide;
}
