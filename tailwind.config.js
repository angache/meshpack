/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,html}"],
  theme: {
    extend: {
      colors: {
        anthracite: {
          950: "#0d1117",
          900: "#161b22",
          800: "#1c2128",
          700: "#21262d",
          600: "#30363d",
          500: "#484f58",
        },
        medical: {
          green: "#3fb950",
          accent: "#58a6ff",
        },
      },
      fontFamily: {
        sans: ["Segoe UI", "system-ui", "sans-serif"],
      },
      animation: {
        pulseGreen: "pulseGreen 2s ease-in-out infinite",
      },
      keyframes: {
        pulseGreen: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(63, 185, 80, 0.4)" },
          "50%": { boxShadow: "0 0 0 8px rgba(63, 185, 80, 0)" },
        },
      },
    },
  },
  plugins: [],
};
