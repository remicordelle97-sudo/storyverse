import type { Config } from "tailwindcss";

export default {
  content: ["./src/client/**/*.{ts,tsx}"],
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
