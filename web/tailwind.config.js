/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        panel: 'var(--panel)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        gold: 'var(--gold)',
        // module accents (CONTRACT §8)
        'm-tasks': '#b7791f',
        'm-calendar': '#2f7f6f',
        'm-study': '#6b5ba5',
        'm-notes': '#c9a227',
        'm-backlog': '#b0532f',
        'm-watchers': '#33718f',
        'm-habits': '#4a7c43',
      },
      fontFamily: {
        display: ['"Iowan Old Style"', '"Palatino Linotype"', 'Palatino', 'Georgia', 'serif'],
        body: [
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        almanac: '4px 4px 0 0 var(--ink)',
        'almanac-sm': '2px 2px 0 0 var(--ink)',
      },
    },
  },
  plugins: [],
};
