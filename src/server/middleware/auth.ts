import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/jwt.js";
import prisma from "../lib/prisma.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Check if the user is admin directly
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (user?.role === "admin") return next();

  // Check if this is an impersonation token from an admin
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const payload = verifyToken(header.slice(7));
    if (payload.impersonatedBy) {
      const admin = await prisma.user.findUnique({ where: { id: payload.impersonatedBy } });
      if (admin?.role === "admin") return next();
    }
  }

  return res.status(403).json({ error: "Admin access required" });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
