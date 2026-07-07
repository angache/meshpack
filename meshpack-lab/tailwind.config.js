/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,html}"],
  theme: {
    extend: {
      colors: {
        lab: {
          bg: "rgb(var(--lab-bg) / <alpha-value>)",
          surface: "rgb(var(--lab-surface) / <alpha-value>)",
          elevated: "rgb(var(--lab-elevated) / <alpha-value>)",
          border: "rgb(var(--lab-border) / <alpha-value>)",
          text: "rgb(var(--lab-text) / <alpha-value>)",
          muted: "rgb(var(--lab-muted) / <alpha-value>)",
          accent: "rgb(var(--lab-accent) / <alpha-value>)",
          green: "rgb(var(--lab-green) / <alpha-value>)",
          orange: "rgb(var(--lab-orange) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
