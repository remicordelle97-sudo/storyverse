// AI model configuration
export const CLAUDE_MODEL = "claude-sonnet-4-6";
// Fast model for mechanical / structural rewrites where creative quality
// doesn't change much (e.g. image prompt refinement).
export const CLAUDE_MODEL_FAST = "claude-haiku-4-5";

// Temperature settings
export const TEMPERATURE_STANDARD = 0.75;
export const TEMPERATURE_CREATIVE = 0.85;

// Token limits
export const MAX_TOKENS_SHORT = 4000;
export const MAX_TOKENS_SMALL = 4000;

// Story pages (always 10)
export const STORY_PAGES = 10;

// Moods (randomly picked per story)
export const MOODS = ["gentle", "funny", "exciting", "mysterious"];

// Plan limits. Illustrated and text-only stories count against separate
// monthly buckets so users can keep making plain text stories after they
// burn through the more expensive illustrated quota.
export const PLAN_LIMITS: Record<string, {
  illustratedStoriesPerMonth: number;
  textStoriesPerMonth: number;
  maxUniverses: number;
}> = {
  free: { illustratedStoriesPerMonth: 2, textStoriesPerMonth: 10, maxUniverses: 1 },
  premium: { illustratedStoriesPerMonth: 5, textStoriesPerMonth: 20, maxUniverses: Infinity },
  admin: { illustratedStoriesPerMonth: Infinity, textStoriesPerMonth: Infinity, maxUniverses: Infinity },
};
