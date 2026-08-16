import type { Config } from "tailwindcss";

// Sovereign design tokens: navy field, gold primary, teal sovereign indicator,
// Playfair Display for display type, Outfit for everything else.
const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#eef2f9",
          100: "#dfe6f2",
          200: "#c3cee3",
          300: "#a3b1cc",
          400: "#8494b3",
          500: "#66779a",
          600: "#4d5d7e",
          700: "#243456",
          800: "#142442",
          900: "#0c182f",
          950: "#07101f",
        },
        gold: {
          50: "#fbf6e6",
          100: "#f6ebc4",
          200: "#efdc98",
          300: "#e8cd6f",
          400: "#dfb954",
          500: "#d4a843",
          600: "#b88d2e",
          700: "#946f22",
          800: "#6f531a",
          900: "#4a3711",
        },
        teal: {
          300: "#5fe8d5",
          400: "#33ddc6",
          500: "#00d4b8",
          600: "#00b39c",
          700: "#008f7d",
        },
        ink: "#ece7dc",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      keyframes: {
        pulseDot: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(0, 212, 184, 0.55)" },
          "70%": { boxShadow: "0 0 0 7px rgba(0, 212, 184, 0)" },
        },
      },
      animation: {
        "pulse-dot": "pulseDot 1.8s ease-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
