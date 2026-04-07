import { Router, raw } from "express";
import Stripe from "stripe";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { authMiddleware } from "../middleware/auth.js";

const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? new Stripe(stripeKey) : null;

const PRICE_ID = process.env.STRIPE_PRICE_ID || "";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

const router = Router();

// Create a Stripe Checkout session for upgrading to premium
router.post("/create-checkout", authMiddleware, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Billing not configured" });
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.userId as string },
    });

    if (user.plan === "premium" || user.role === "admin") {
      return res.status(400).json({ error: "Already on premium" });
    }

    // Create or reuse Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${APP_URL}/library?upgraded=true`,
      cancel_url: `${APP_URL}/library`,
      metadata: { userId: user.id },
    });

    res.json({ url: session.url });
  } catch (e: any) {
    debug.error(`Checkout session failed: ${e.message}`);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Create a Stripe Customer Portal session for managing subscription
router.post("/create-portal", authMiddleware, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Billing not configured" });
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.userId as string },
    });

    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: "No billing account found" });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${APP_URL}/library`,
    });

    res.json({ url: session.url });
  } catch (e: any) {
    debug.error(`Portal session failed: ${e.message}`);
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

// Stripe webhook — handles subscription lifecycle
router.post(
  "/webhook",
  raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe) return res.status(503).json({ error: "Billing not configured" });
    const sig = req.headers["stripe-signature"] as string;
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (e: any) {
      debug.error(`Webhook signature verification failed: ${e.message}`);
      return res.status(400).json({ error: "Invalid signature" });
    }

    debug.story(`Stripe webhook: ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        if (userId) {
          await prisma.user.update({
            where: { id: userId },
            data: { plan: "premium" },
          });
          debug.story(`User ${userId} upgraded to premium`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const user = await prisma.user.findUnique({
          where: { stripeCustomerId: customerId },
        });
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { plan: "free" },
          });
          debug.story(`User ${user.id} downgraded to free (subscription cancelled)`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const user = await prisma.user.findUnique({
          where: { stripeCustomerId: customerId },
        });
        if (user) {
          debug.error(`Payment failed for user ${user.id} (${user.email})`);
        }
        break;
      }
    }

    res.json({ received: true });
  }
);

export default router;
