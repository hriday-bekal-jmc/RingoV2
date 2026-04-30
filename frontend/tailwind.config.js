/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // RINGO warm palette — terracotta/coral/cream
        ringo: {
          50:  '#FBF6EE',  // lightest cream
          100: '#F5EFE6',  // main bg cream
          200: '#EDE2CE',  // card border
          300: '#E0CCAA',  // muted tan
          400: '#C9A07A',  // soft tan
          500: '#C75B47',  // primary coral red (main CTA)
          600: '#B04634',  // hover coral
          700: '#A0432B',  // sidebar bg deep terracotta
          800: '#7E3322',  // dark terracotta
          900: '#5C2418',  // deepest brick
        },
        cream: {
          50:  '#FFFAF2',
          100: '#FAF3E8',
          200: '#F5EFE6',
          300: '#EDE2CE',
        },
        mustard: {
          400: '#D4B33A',
          500: '#C9A227',
          600: '#B8941F',
        },
        teal: {
          accent: '#5A8A87',
        },
        warmgray: {
          600: '#6B5E54',
          800: '#3D3530',
          900: '#2A2520',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(60, 40, 20, 0.08), 0 1px 2px rgba(60, 40, 20, 0.04)',
        'card-hover': '0 4px 12px rgba(60, 40, 20, 0.10)',
      },
    },
  },
  plugins: [],
};
