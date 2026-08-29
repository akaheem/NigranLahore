/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        lux: {
          bg: {
            primary: 'var(--bg-primary)',
            secondary: 'var(--bg-secondary)',
            tertiary: 'var(--bg-tertiary)',
          },
          text: {
            primary: 'var(--text-primary)',
            secondary: 'var(--text-secondary)',
            muted: 'var(--text-muted)',
          },
          gold: {
            DEFAULT: 'var(--accent-gold)',
            dark: 'var(--accent-gold-dark)',
            light: 'var(--accent-gold-light)',
          },
          border: {
            light: 'var(--border-light)',
            medium: 'var(--border-medium)',
          },
        },
        // Semantic risk hues — derived to harmonize with the plum/gold palette
        risk: {
          safe: 'var(--risk-safe)',
          moderate: 'var(--risk-moderate)',
          high: 'var(--risk-high)',
          severe: 'var(--risk-severe)',
          info: 'var(--risk-info)',
        },
      },
      fontFamily: {
        editorial: ['var(--font-editorial)', 'Georgia', 'serif'],
        ui: ['var(--font-ui)', 'system-ui', 'sans-serif'],
        accent: ['var(--font-accent)', 'sans-serif'],
      },
      transitionTimingFunction: {
        lux: 'var(--transition-lux)',
      },
      boxShadow: {
        premium: 'var(--shadow-premium)',
        'premium-hover': 'var(--shadow-premium-hover)',
      },
    },
  },
  plugins: [],
}
