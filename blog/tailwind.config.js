/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        paper: token('paper'),
        sunk: token('sunk'),
        ink: token('ink'),
        body: token('body'),
        faint: token('faint'),
        rule: token('rule'),
        accent: token('accent'),
        mark: token('mark'),
      },
      fontFamily: {
        sans: ['var(--font-display)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-text)', 'Georgia', 'serif'],
        mono: ['var(--font-code)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
