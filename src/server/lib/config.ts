// AI model configuration
export const CLAUDE_MODEL = "claude-sonnet-4-6";

// Temperature settings
export const TEMPERATURE_STANDARD = 0.75;
export const TEMPERATURE_CREATIVE = 0.85;

// Token limits
export const MAX_TOKENS_SHORT = 8000;
export const MAX_TOKENS_LONG = 16000;
export const MAX_TOKENS_SMALL = 2000;

// Story lengths
export const STORY_PAGES = {
  short: 10,
  long: 32,
} as const;

// Moods (randomly picked per story)
export const MOODS = ["gentle", "funny", "exciting", "mysterious"];
