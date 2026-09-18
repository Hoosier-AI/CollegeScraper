/** @type {import('tailwindcss').Config} */
// Tokens are named for what they are on a football pitch at night: the field (surfaces), chalk (text) and
// pitch (the Plaibook teal). Result and verification colours are only ever applied to data, never to chrome.
const field = { 950: '#0A1628', 900: '#10203A', 800: '#182C4E', 700: '#24395F', 600: '#33497A' };
const chalk = { 100: '#EEF3F8', 200: '#D6DFEA', 300: '#B9C6D8', 400: '#98A9C0', 500: '#7F91AA' };
const pitch = { 300: '#5EEAD4', 400: '#2DD4BF', 500: '#14B8A6', 600: '#0F9F8F' };

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' },
    extend: {
      colors: {
        field, chalk, pitch,
        win: '#5EEAD4', loss: '#FCA5A5', draw: '#CBD5E1', note: '#FBBF24',
        // Legacy names used by pages that have not migrated yet; remove once nothing references them.
        navy: { 950: field[950], 900: field[900], 800: field[800], 700: field[700] },
        ink: { 100: chalk[100], 200: chalk[200], 300: chalk[300], 400: chalk[400], 500: chalk[500] },
        teal: { 300: pitch[300], 400: pitch[400], 500: pitch[500] },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['Archivo', '"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1rem' }],
        xs: ['0.8125rem', { lineHeight: '1.125rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.5rem' }],
        xl: ['1.375rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.75rem', { lineHeight: '2rem' }],
        '3xl': ['2.5rem', { lineHeight: '2.5rem' }],
        '4xl': ['3.25rem', { lineHeight: '3.25rem' }],
      },
      maxWidth: { page: '80rem' },
      keyframes: { shimmer: { '0%': { opacity: '0.5' }, '50%': { opacity: '1' }, '100%': { opacity: '0.5' } } },
      animation: { shimmer: 'shimmer 1.6s ease-in-out infinite' },
    },
  },
  plugins: [
    // Touch devices get taller targets without a runtime check: `coarse:min-h-11`.
    function ({ addVariant }) { addVariant('coarse', '@media (pointer: coarse)'); },
  ],
};
