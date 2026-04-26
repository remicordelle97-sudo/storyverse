import type { Config } from "tailwindcss";

export default {
  // src/shared is included so the JIT picks up class names defined in
  // shared modules (e.g. the bg-* palette in shared/storyColor.ts that
  // backs the Library bookshelf covers).
  content: ["./src/client/**/*.{ts,tsx}", "./src/shared/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#534AB7",
        secondary: "#0F6E56",
      },
    },
  },
  plugins: [],
} satisfies Config;
