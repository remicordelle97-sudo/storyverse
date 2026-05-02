/**
 * Image Style Guide for children's book illustration generation.
 *
 * `ART_STYLE` is shared by every Gemini call (universe style reference,
 * character sheets, per-page story images). The COLOR / COMPOSITION /
 * SIMPLICITY rule blocks only ride along on the per-page story-image
 * setup message via `buildImageStyleGuide()`. Continuity is enforced
 * by the per-page setup wrapper + character reference recall, so it
 * doesn't need its own block here.
 */

export const ART_STYLE = `ART STYLE — Loose handmade watercolor on textured paper.
Transparent washes bleed and bloom into each other; pigment pools in shaded areas, the paper shows through highlights.
NO outlines, ink, or linework — shapes are defined by wet color meeting wet color, with soft feathered edges.
Visible paper grain throughout; uneven washes, water blooms, and granulation are part of the look.
The image fades into the white paper at irregular edges — no rectangular border, no clean-cut frame.
Warm, luminous, limited palette. Loose, expressive, handmade.
NEVER: hard outlines, cel shading, anime, vector art, 3D rendering, photorealism, hard rectangular borders.`;

export const ART_STYLE_REMINDER = `Watercolor style — soft transparent washes, NO outlines, NO linework, visible paper texture. Soft irregular edges that fade into the white paper, NO sharp rectangular borders.`;

const COLOR_RULES = `COLOR:
- 5–7 hues per image, consistent across pages.
- Shadows: cool muted blues / soft purples — never pure black.
- Highlights: bare paper or warm pale yellows — never pure white paint.
- Most saturated colors at the focal point; backgrounds softer and more muted for depth.`;

const COMPOSITION_RULES = `COMPOSITION:
- Main character at a rule-of-thirds intersection, never dead center.
- Characters move or look RIGHT to lead the reader to the next page.
- Use environmental leading lines (paths, branches, rivers, gazes) toward the focal point.
- Leave one area of calm, simple space (sky, ground, soft gradient) for text overlay.
- NO text or letters anywhere in the image.`;

const SIMPLICITY_RULES = `SIMPLICITY:
- A child should instantly grasp WHO is in the scene and WHAT is happening.
- One or two well-chosen background elements, never a busy field of detail.
- Only show objects mentioned in the page beat — no extra props or decorations.
- Large clear shapes over intricate patterns or fine crosshatching.`;

/** Build the complete style guide for the per-page story-image setup. */
export function buildImageStyleGuide(): string {
  return `=== ILLUSTRATION STYLE GUIDE ===

${ART_STYLE}

${COLOR_RULES}

${COMPOSITION_RULES}

${SIMPLICITY_RULES}

`;
}
