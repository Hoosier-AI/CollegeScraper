/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#0A1628', 900: '#0F1D33', 800: '#16264a', 700: '#1E2D47' },
        ink: { 100: '#F1F5F9', 300: '#CBD5E1', 400: '#9FB0C7', 500: '#64748B' },
        teal: { 400: '#2DD4BF', 500: '#14B8A6' },
      },
    },
  },
  plugins: [],
};
