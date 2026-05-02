/**
 * Customer-facing Premium subscription price.
 *
 * Source of truth for what we charge lives in Stripe (the live mode
 * Price ID set via STRIPE_PRICE_ID). This constant is for display
 * only — keep it in sync with the Stripe Price when it changes.
 * Showing the user the price inline (Onboarding plan picker, Account
 * upgrade CTA) avoids the surprise of "click upgrade → suddenly
 * Stripe says $9.99/month."
 */
export const PREMIUM_MONTHLY_DISPLAY = "$4.99/mo";
