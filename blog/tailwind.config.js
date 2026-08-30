/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      screens: {
        xs: '475px',
      },
      colors: {
        background: "#09090b",
        foreground: "#fafafa",
        muted: "#71717a",
        border: "#27272a",
        card: {
          DEFAULT: "#18181b",
          foreground: "#fafafa",
        },
        accent: {
          DEFAULT: "#27272a",
          foreground: "#fafafa",
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
