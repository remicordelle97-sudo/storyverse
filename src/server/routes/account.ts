/**
 * Account management endpoints — currently the user's saved shipping
 * address, used as the default when adding books to the print cart.
 *
 *   GET  /api/account            — current name + shipping address
 *   PUT  /api/account/address    — replace the saved shipping address
 *   DELETE /api/account/address  — clear the saved shipping address
 *
 * Onboarding can also set the shipping address via /api/auth/onboard
 * or /api/auth/onboard-preset (Phase-2 cart UX); editing later happens
 * here.
 */

import { Router } from "express";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import {
  validateShippingAddress,
  parseStoredAddress,
} from "../lib/shippingAddress.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId as string },
      select: { id: true, name: true, email: true, shippingAddress: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      shippingAddress: parseStoredAddress(user.shippingAddress),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to load account" });
  }
});

router.put("/address", async (req, res) => {
  try {
    let address;
    try {
      address = validateShippingAddress(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    await prisma.user.update({
      where: { id: req.userId as string },
      data: { shippingAddress: JSON.stringify(address) },
    });
    debug.story("User updated shipping address", { userId: req.userId });
    res.json({ shippingAddress: address });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to save address" });
  }
});

router.delete("/address", async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.userId as string },
      data: { shippingAddress: "" },
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to clear address" });
  }
});

export default router;
