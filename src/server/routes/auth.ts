import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import prisma from "../lib/prisma.js";
import { signAccessToken, signRefreshToken, verifyToken } from "../lib/jwt.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

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
        },
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
      },
    });
  } catch (e) {
    console.error("Google auth failed:", e);
    res.status(401).json({ error: "Authentication failed" });
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
