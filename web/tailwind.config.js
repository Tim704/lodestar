/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        panel: 'var(--panel)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        edge: 'var(--edge)',
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
        gold: 'var(--gold)', // alias of --accent (CONTRACT §8.1)
        // module accents — theme-invariant (CONTRACT §8.1)
        'm-tasks': '#b7791f',
        'm-calendar': '#2f7f6f',
        'm-study': '#6b5ba5',
        'm-notes': '#c9a227',
        'm-backlog': '#b0532f',
        'm-watchers': '#33718f',
        'm-habits': '#4a7c43',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        almanac: 'var(--shadow-card)',
        'almanac-sm': 'var(--shadow-btn)',
      },
      borderRadius: {
        sm: 'var(--radius)',
      },
      borderWidth: {
        // border-2 (checkboxes, section dividers, the mobile bar…) follows the
        // theme's control weight (CONTRACT §8.1)
        2: 'var(--control-w)',
      },
    },
  },
  plugins: [],
};
