import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { OAuth2Client } from "google-auth-library";
import prisma from "../lib/prisma.js";
import { signAccessToken, signRefreshToken, verifyToken } from "../lib/jwt.js";
import { authMiddleware } from "../middleware/auth.js";
import { CLAUDE_MODEL, TEMPERATURE_CREATIVE, MAX_TOKENS_SHORT } from "../lib/config.js";
import { debug } from "../lib/debug.js";
import { generateStyleReference, generateAllCharacterSheets } from "../services/geminiGenerator.js";

const router = Router();
const anthropic = new Anthropic();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const ADMIN_EMAILS = ["remi.cordelle97@gmail.com"];

// Google login
router.post("/google", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: "Missing Google credential" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      return res.status(400).json({ error: "Invalid Google token" });
    }

    let user = await prisma.user.findUnique({
      where: { googleId: payload.sub },
    });

    if (!user) {
      const role = ADMIN_EMAILS.includes(payload.email) ? "admin" : "user";
      user = await prisma.user.create({
        data: {
          googleId: payload.sub,
          email: payload.email,
          name: payload.name || payload.email,
          picture: payload.picture || "",
          role,
          // Admins skip the onboarding flow
          onboardedAt: role === "admin" ? new Date() : null,
        },
      });
    } else if (user.role === "admin" && !user.onboardedAt) {
      // Grandfather existing admins who predate the onboarding flow
      user = await prisma.user.update({
        where: { id: user.id },
        data: { onboardedAt: new Date() },
      });
    }

    const accessToken = signAccessToken(user.id, null);
    const refreshToken = signRefreshToken(user.id);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/api/auth/refresh",
    });

    res.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role,
        plan: user.plan,
        onboardedAt: user.onboardedAt,
      },
    });
  } catch (e) {
    console.error("Google auth failed:", e);
    res.status(401).json({ error: "Authentication failed" });
  }
});

// Complete onboarding: build a custom universe from the user's choices.
// Step 1 (synchronous, ~5-10s): generate the setting description + every
// character's appearance/outfit via Claude, then create the DB rows and
// mark the user as onboarded so they can leave the loading screen.
// Step 2 (background, ~30-50s): generate the style reference image and
// each character's reference sheet via Gemini. The library polls and
// shows a notification when the universe is fully ready.
router.post("/onboard", authMiddleware, async (req, res) => {
  try {
    const { universeName, themes, hero, supporting } = req.body || {};

    const trimmedUniverseName = typeof universeName === "string" ? universeName.trim() : "";
    const themeList = Array.isArray(themes) ? themes.map((t: any) => String(t).trim()).filter(Boolean) : [];
    const heroName = typeof hero?.name === "string" ? hero.name.trim() : "";
    const heroSpecies = typeof hero?.species === "string" ? hero.species.trim() : "";
    const heroTraits = Array.isArray(hero?.traits) ? hero.traits.map((t: any) => String(t).trim()).filter(Boolean) : [];

    if (!trimmedUniverseName) return res.status(400).json({ error: "Universe name is required" });
    if (themeList.length === 0) return res.status(400).json({ error: "At least one theme is required" });
    if (!heroName || !heroSpecies || heroTraits.length === 0) {
      return res.status(400).json({ error: "Hero name, species, and at least one trait are required" });
    }

    // supporting is either the literal string "auto" or an array of {name, species, traits}
    let supportingMode: "auto" | "manual" = "auto";
    let manualSupporting: { name: string; species: string; traits: string[] }[] = [];
    if (Array.isArray(supporting)) {
      supportingMode = "manual";
      manualSupporting = supporting
        .map((s: any) => ({
          name: typeof s?.name === "string" ? s.name.trim() : "",
          species: typeof s?.species === "string" ? s.species.trim() : "",
          traits: Array.isArray(s?.traits) ? s.traits.map((t: any) => String(t).trim()).filter(Boolean) : [],
        }))
        .filter((s) => s.name && s.species && s.traits.length > 0);
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId as string } });
    if (user.onboardedAt) {
      return res.status(400).json({ error: "Already onboarded" });
    }

    // Build the user message describing the cast Claude needs to flesh out.
    const supportingInstruction = supportingMode === "auto"
      ? `Invent 2 supporting characters that fit this universe and complement the hero. Each should be a different species from the hero and from each other. Give each one: name, species, 2-4 personality traits, a relationship_archetype (their role in the hero's life), appearance, and outfit.`
      : `Generate appearance and outfit fields for these supporting characters supplied by the user. Use their given name, species, and traits exactly. Add a relationship_archetype that fits.\n\n${manualSupporting.map((s, i) => `Supporting ${i + 1}: name="${s.name}", species="${s.species}", traits=${JSON.stringify(s.traits)}`).join("\n")}`;

    const userMessage = `Create a children's story universe and its character ensemble.

USER-PROVIDED:
- Universe name: ${trimmedUniverseName}
- Themes: ${themeList.join(", ")}
- Hero name: ${heroName}
- Hero species: ${heroSpecies}
- Hero personality traits: ${heroTraits.join(", ")}

YOUR JOB:
1. Write a 3-4 sentence setting_description that paints this world vividly. The themes are the user's interests — weave them in.
2. Generate the hero's appearance and outfit from the user-supplied species and traits. Keep the user's name, species, and traits exactly as given.
3. ${supportingInstruction}

VISUAL FIELD REQUIREMENTS (for every character):
- "appearance" — BODY ONLY (no clothing). Include BODY (shape, size, primary color with hex), HEAD (shape, color hex), EYES (count, shape, color hex), nose/mouth/snout, EARS, ARMS (with finger count), LEGS, WINGS (or "none"), TAIL (or "none"), ANTENNAE/HORNS (or "none"), MARKINGS (with hex codes). Every color must include a hex code.
- "outfit" — Format: "ALWAYS WEARS AND CARRIES (never remove any item):\\n- #hex item description". One line per item.
- Every character must have a different SILHOUETTE, primary color, and size relative to each other.

Return EXACTLY this JSON:
{
  "setting_description": "...",
  "hero": {
    "name": "${heroName}",
    "species_or_type": "${heroSpecies}",
    "personality_traits": ${JSON.stringify(heroTraits)},
    "appearance": "...",
    "outfit": "...",
    "relationship_archetype": ""
  },
  "supporting": [
    { "name": "...", "species_or_type": "...", "personality_traits": ["..."], "appearance": "...", "outfit": "...", "relationship_archetype": "..." }
  ]
}`;

    const claudeResp = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS_SHORT,
      temperature: TEMPERATURE_CREATIVE,
      system: "You design complete children's story universes — setting and an ensemble cast — with rich enough detail that every character looks identical across many illustrations. Return ONLY valid JSON, no markdown fences.",
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlock = claudeResp.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude");
    }
    let raw = textBlock.text.trim();
    if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    const parsed = JSON.parse(raw) as {
      setting_description: string;
      hero: { name: string; species_or_type: string; personality_traits: string[]; appearance: string; outfit: string; relationship_archetype: string };
      supporting: { name: string; species_or_type: string; personality_traits: string[]; appearance: string; outfit: string; relationship_archetype: string }[];
    };

    // Persist the universe + characters
    const universe = await prisma.universe.create({
      data: {
        userId: user.id,
        name: trimmedUniverseName,
        settingDescription: parsed.setting_description,
        themes: JSON.stringify(themeList),
        avoidThemes: "",
        illustrationStyle: "storybook",
        isPublic: false,
        isTemplate: false,
      },
    });

    await prisma.character.create({
      data: {
        universeId: universe.id,
        name: parsed.hero.name,
        speciesOrType: parsed.hero.species_or_type,
        personalityTraits: JSON.stringify(parsed.hero.personality_traits),
        appearance: parsed.hero.appearance,
        outfit: parsed.hero.outfit || "",
        role: "main",
      },
    });

    // For supporting characters: in auto mode, use Claude's full output. In
    // manual mode, keep the user-supplied name/species/traits and only take
    // appearance/outfit/archetype from Claude — that way Claude can't drift
    // off what the user typed.
    const supportingToCreate = supportingMode === "auto"
      ? (parsed.supporting || []).map((s) => ({
          name: s.name,
          speciesOrType: s.species_or_type,
          personalityTraits: JSON.stringify(s.personality_traits || []),
          appearance: s.appearance,
          outfit: s.outfit || "",
          relationshipArchetype: s.relationship_archetype || "",
        }))
      : manualSupporting.map((u, i) => {
          const claudeOut = parsed.supporting?.[i];
          return {
            name: u.name,
            speciesOrType: u.species,
            personalityTraits: JSON.stringify(u.traits),
            appearance: claudeOut?.appearance || "",
            outfit: claudeOut?.outfit || "",
            relationshipArchetype: claudeOut?.relationship_archetype || "",
          };
        });

    for (const s of supportingToCreate) {
      await prisma.character.create({
        data: {
          universeId: universe.id,
          ...s,
          role: "supporting",
        },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { onboardedAt: new Date() },
    });

    // Return immediately — the frontend will navigate to the library and
    // poll for image readiness while the background work runs.
    res.json({ universeId: universe.id });

    // Fire-and-forget image generation. Errors are swallowed so they don't
    // crash the request; the universe is still usable, just without images.
    (async () => {
      try {
        await generateStyleReference(universe.id);
        await generateAllCharacterSheets(universe.id);
        debug.universe(`Onboarding image generation complete for "${universe.name}"`);
      } catch (e: any) {
        debug.error(`Onboarding image generation failed: ${e?.message || e}`);
      }
    })();
  } catch (e: any) {
    console.error("Onboarding failed:", e);
    res.status(500).json({ error: "Failed to complete onboarding" });
  }
});

// Refresh access token
router.post("/refresh", async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      return res.status(401).json({ error: "No refresh token" });
    }

    const payload = verifyToken(token);
    if (payload.type !== "refresh") {
      return res.status(401).json({ error: "Invalid token type" });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    const accessToken = signAccessToken(user.id, null);
    res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
});

// Get current user
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      plan: user.plan,
      onboardedAt: user.onboardedAt,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// Logout
router.post("/logout", (_req, res) => {
  res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
  res.json({ ok: true });
});

export default router;
