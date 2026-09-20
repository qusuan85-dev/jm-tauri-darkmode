/**
 * The neutral scale and the accent colour are backed by CSS custom properties
 * declared in `src/index.css`. Every `zinc-*` utility therefore resolves through
 * a single set of channels, which lets the `dark` class (and the `data-accent`
 * attribute) on <html> re-map the whole app from one place instead of sprinkling
 * `dark:` variants over ~900 call sites.
 *
 * The channel format ("R G B") keeps Tailwind's `/opacity` modifiers working.
 */
const zinc = (step) => `rgb(var(--jm-zinc-${step}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      /**
       * Noticeably rounder than Tailwind's defaults: cards land on 16px and
       * controls on 12px. Only the steps the app actually uses are overridden;
       * `none` / `full` keep their meaning.
       */
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "32px",
      },
      colors: {
        zinc: {
          50: zinc(50),
          100: zinc(100),
          200: zinc(200),
          300: zinc(300),
          400: zinc(400),
          500: zinc(500),
          600: zinc(600),
          700: zinc(700),
          800: zinc(800),
          900: zinc(900),
          950: zinc(950),
        },
        /** Card / raised surface. `bg-white` is remapped in index.css. */
        surface: "rgb(var(--jm-surface) / <alpha-value>)",
        hairline: "rgb(var(--jm-hairline) / <alpha-value>)",
        /** User-selectable accent. Presets live in index.css. */
        accent: {
          DEFAULT: "rgb(var(--jm-accent) / <alpha-value>)",
          fg: "rgb(var(--jm-accent-fg) / <alpha-value>)",
          strong: "rgb(var(--jm-accent-strong) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
