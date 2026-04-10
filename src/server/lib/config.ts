// AI model configuration
export const CLAUDE_MODEL = "claude-sonnet-4-6";

// Temperature settings
export const TEMPERATURE_STANDARD = 0.75;
export const TEMPERATURE_CREATIVE = 0.85;

// Token limits
export const MAX_TOKENS_SHORT = 8000;
export const MAX_TOKENS_SMALL = 4000;

// Story pages (always 10)
export const STORY_PAGES = 10;

// Moods (randomly picked per story)
export const MOODS = ["gentle", "funny", "exciting", "mysterious"];

// Plan limits
export const PLAN_LIMITS: Record<string, { storiesPerMonth: number; maxUniverses: number }> = {
  free: { storiesPerMonth: 5, maxUniverses: 1 },
  premium: { storiesPerMonth: Infinity, maxUniverses: Infinity },
  admin: { storiesPerMonth: Infinity, maxUniverses: Infinity },
};
