import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import prisma from "../lib/prisma.js";
import { signAccessToken, signRefreshToken, verifyToken } from "../lib/jwt.js";
import { authMiddleware } from "../middleware/auth.js";
import { buildCustomUniverse, clonePresetUniverse, startUniverseImageGeneration } from "../services/universeBuilder.js";

const router = Router();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Admin identity is configured via the ADMIN_EMAILS env var (comma-
// separated, case-insensitive). Empty/unset means no new accounts will
// be auto-promoted; existing admins keep their role from the DB.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const isAdminEmail = (email: string) => ADMIN_EMAILS.includes(email.toLowerCase());

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
      const role = isAdminEmail(payload.email) ? "admin" : "user";
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
// Synchronous: generate the setting description + every character's
// appearance/outfit via Claude, then create the DB rows and mark the
// user as onboarded so they can leave the loading screen.
// Background: generate the style reference + character sheets via
// Gemini. The library polls and shows a notification when the
// universe is fully ready.
router.post("/onboard", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId as string } });
    if (user.onboardedAt) {
      return res.status(400).json({ error: "Already onboarded" });
    }

    const built = await buildCustomUniverse(user.id, req.body || {});

    await prisma.user.update({
      where: { id: user.id },
      data: { onboardedAt: new Date() },
    });

    res.json({ universeId: built.id });

    startUniverseImageGeneration(built.id, built.name);
  } catch (e: any) {
    const msg = e?.message || "Failed to complete onboarding";
    console.error("Onboarding failed:", e);
    // Surface validation errors as 400 so the client can show them; everything
    // else is 500.
    const isValidation =
      typeof msg === "string" && /required/i.test(msg);
    res.status(isValidation ? 400 : 500).json({ error: msg });
  }
});

// Alternate onboarding path: clone a preset (admin-curated) universe
// instead of building a custom one. Same outcome — user lands in the
// library with a usable universe and onboardedAt set — but skips the
// 3-step wizard and reuses the preset's existing style reference + sheet
// images, so there's no background image generation to wait on.
router.post("/onboard-preset", authMiddleware, async (req, res) => {
  try {
    const { templateUniverseId } = req.body || {};
    if (!templateUniverseId || typeof templateUniverseId !== "string") {
      return res.status(400).json({ error: "templateUniverseId is required" });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId as string } });
    if (user.onboardedAt) {
      return res.status(400).json({ error: "Already onboarded" });
    }

    const built = await clonePresetUniverse(user.id, templateUniverseId);

    await prisma.user.update({
      where: { id: user.id },
      data: { onboardedAt: new Date() },
    });

    res.json({ universeId: built.id });
  } catch (e: any) {
    const msg = e?.message || "Failed to complete onboarding";
    console.error("Preset onboarding failed:", e);
    const status = /not found/i.test(msg) ? 404 : 500;
    res.status(status).json({ error: msg });
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
