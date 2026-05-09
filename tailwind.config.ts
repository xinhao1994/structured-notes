import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Inter",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        ink: {
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#dde2ea",
          300: "#bcc5d3",
          400: "#8a96a8",
          500: "#5d6a7e",
          600: "#3f4a5c",
          700: "#2a3344",
          800: "#1a2030",
          900: "#0d111c",
          950: "#070912",
        },
        accent: {
          DEFAULT: "#0a3a66",
          50: "#eaf2fb",
          100: "#cde0f3",
          200: "#9bc1e6",
          300: "#69a2d8",
          400: "#3784cb",
          500: "#0a66bf",
          600: "#0a3a66",
          700: "#082c4d",
          800: "#061f37",
          900: "#031120",
        },
        gold: {
          DEFAULT: "#b48a36",
          400: "#d3aa54",
          500: "#b48a36",
          600: "#8e6c25",
        },
        success: "#137a4a",
        successBg: "#e6f4ec",
        danger: "#b3261e",
        dangerBg: "#fbe9e7",
        warning: "#a4670c",
        warningBg: "#fdf3e3",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,.04), 0 1px 1px rgba(15,23,42,.03)",
        cardLg:
          "0 1px 2px rgba(15,23,42,.06), 0 8px 24px -8px rgba(15,23,42,.10)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
