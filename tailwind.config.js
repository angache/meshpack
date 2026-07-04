/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,html}"],
  theme: {
    extend: {
      colors: {
        anthracite: {
          950: "rgb(var(--mp-bg) / <alpha-value>)",
          900: "rgb(var(--mp-surface) / <alpha-value>)",
          800: "rgb(var(--mp-elevated) / <alpha-value>)",
          700: "rgb(var(--mp-hover) / <alpha-value>)",
          600: "rgb(var(--mp-border) / <alpha-value>)",
          500: "rgb(var(--mp-text-faint) / <alpha-value>)",
        },
        medical: {
          green: "rgb(var(--mp-green) / <alpha-value>)",
          accent: "rgb(var(--mp-accent) / <alpha-value>)",
        },
        orange: {
          400: "rgb(var(--mp-orange) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Segoe UI", "system-ui", "sans-serif"],
      },
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.4" }],
        sm: ["0.9375rem", { lineHeight: "1.45" }],
      },
      animation: {
        pulseGreen: "pulseGreen 2s ease-in-out infinite",
      },
      keyframes: {
        pulseGreen: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(63, 185, 80, 0.35)" },
          "50%": { boxShadow: "0 0 0 8px rgba(63, 185, 80, 0)" },
        },
      },
      boxShadow: {
        mp: "var(--mp-shadow)",
        "mp-sm": "var(--mp-shadow-sm)",
      },
    },
  },
  plugins: [],
};
