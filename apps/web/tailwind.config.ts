import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
      },
      colors: {
        housing: {
          DEFAULT: "var(--housing)",
          raised: "var(--housing-raised)",
          line: "var(--housing-line)",
          muted: "var(--housing-muted)",
          rule: "var(--housing-rule)",
        },
        stock: {
          DEFAULT: "var(--stock)",
          edge: "var(--stock-edge)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          muted: "var(--ink-muted)",
        },
        live: { lamp: "var(--live-lamp)", ink: "var(--live-ink)" },
        filling: { lamp: "var(--filling-lamp)", ink: "var(--filling-ink)" },
        closing: { lamp: "var(--closing-lamp)", ink: "var(--closing-ink)" },
        pending: { lamp: "var(--pending-lamp)", ink: "var(--pending-ink)" },
        focus: "var(--focus)",
      },
    },
  },
};

export default config;
