import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import prisma from "../lib/prisma.js";
import { signAccessToken, signRefreshToken, verifyToken } from "../lib/jwt.js";
import { authMiddleware } from "../middleware/auth.js";
import { clonePresetUniverse } from "../services/universeBuilder.js";
import {
  validateUniverseInput,
  createUniversePlaceholder,
  type UniverseBuildJobPayload,
} from "../services/universePipeline.js";
import { createJob } from "../lib/jobs.js";
import { JOB_KINDS } from "../lib/queues.js";
import { serializeUser } from "../lib/serializeUser.js";

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
    } else if (user.role !== "admin" && isAdminEmail(payload.email)) {
      // Email is in ADMIN_EMAILS but DB role is still "user" — happens
      // when an existing account predates the env var being set, or
      // when the env list is updated after a user already signed up.
      // Promote on login and skip onboarding.
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: "admin", onboardedAt: user.onboardedAt || new Date() },
      });
    } else if (user.role === "admin" && !user.onboardedAt) {
      // Grandfather existing admins who predate the onboarding flow.
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

    res.json({ accessToken, user: serializeUser(user) });
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

    // Validate up front so a bad payload returns 400 cleanly instead
    // of trickling into the worker as a job failure.
    let validated;
    try {
      validated = validateUniverseInput(req.body || {});
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    const universe = await createUniversePlaceholder({
      userId: user.id,
      universeName: validated.universeName,
      themes: validated.themes,
    });

    // Mark the user onboarded as soon as the placeholder exists so a
    // page refresh during the build doesn't loop them back to
    // onboarding. Failures surface in the library as a "failed"
    // universe placeholder.
    await prisma.user.update({
      where: { id: user.id },
      data: { onboardedAt: new Date() },
    });

    const job = await createJob({
      kind: JOB_KINDS.universeBuild,
      ownerId: user.id,
      universeId: universe.id,
      payload: { input: req.body } satisfies UniverseBuildJobPayload as any,
    });

    res.status(202).json({ universeId: universe.id, jobId: job.id });
  } catch (e: any) {
    console.error("Onboarding failed:", e);
    res.status(500).json({ error: e?.message || "Failed to start onboarding" });
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

// Admin-only escape hatch: mark the current user as onboarded without
// creating a universe. Defense-in-depth — the existing route guards
// already auto-skip onboarding for role=admin, but this gives the
// admin a manual button if role detection ever drifts (e.g. an admin
// is testing as themselves and got reset).
router.post("/skip-onboarding", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId as string } });
    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admins only" });
    }
    if (user.onboardedAt) {
      return res.json({ ok: true, alreadyOnboarded: true });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { onboardedAt: new Date() },
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to skip" });
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
    res.json(serializeUser(user));
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
