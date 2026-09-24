/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // "Midnight Ledger" design system
        bg: '#0B1220',
        surface: '#131C2E',
        surfaceHigh: '#1C2740',
        border: '#24334F',
        primary: '#2DD4BF', // aurora teal
        profit: '#4ADE80',
        loss: '#F87171',
        accent: '#8B5CF6',
        amber: '#FBBF24',
        textPrimary: '#E7EEF9',
        textSecondary: '#8FA3BF',
        textMuted: '#5A6B87',
      },
      borderRadius: {
        card: '16px',
      },
    },
  },
  plugins: [],
};
