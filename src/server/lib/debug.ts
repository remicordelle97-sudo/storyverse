/**
 * Simple structured logger for debugging the story generation pipeline.
 * Prefixes all messages with a context tag and timestamp.
 */

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(
  context: string,
  color: string,
  message: string,
  data?: Record<string, any>
) {
  const prefix = `${COLORS.dim}${timestamp()}${COLORS.reset} ${color}[${context}]${COLORS.reset}`;
  if (data) {
    const formatted = Object.entries(data)
      .map(([k, v]) => {
        const val = typeof v === "string" && v.length > 100 ? v.slice(0, 100) + "..." : v;
        return `${COLORS.dim}${k}=${COLORS.reset}${JSON.stringify(val)}`;
      })
      .join(" ");
    console.log(`${prefix} ${message} ${formatted}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export const debug = {
  universe: (msg: string, data?: Record<string, any>) =>
    log("UNIVERSE", COLORS.cyan, msg, data),

  character: (msg: string, data?: Record<string, any>) =>
    log("CHARACTER", COLORS.green, msg, data),

  story: (msg: string, data?: Record<string, any>) =>
    log("STORY", COLORS.magenta, msg, data),

  prompt: (msg: string, data?: Record<string, any>) =>
    log("PROMPT", COLORS.blue, msg, data),

  image: (msg: string, data?: Record<string, any>) =>
    log("IMAGE", COLORS.yellow, msg, data),

  lora: (msg: string, data?: Record<string, any>) =>
    log("LORA", COLORS.cyan, msg, data),

  error: (msg: string, data?: Record<string, any>) =>
    log("ERROR", COLORS.red, msg, data),
};
