/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ringo: {
          50:  '#FBF6EE',
          100: '#F5EFE6',
          200: '#EDE2CE',
          300: '#E0CCAA',
          400: '#C9A07A',
          500: '#C75B47',
          600: '#B04634',
          700: '#A0432B',
          800: '#7E3322',
          900: '#5C2418',
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
        warmgray: {
          400: '#9E8E84',
          500: '#7E6E64',
          600: '#6B5E54',
          700: '#4E4540',
          800: '#3D3530',
          900: '#2A2520',
        },
        // Neutral for modern surfaces
        surface: {
          0:   '#FFFFFF',
          50:  '#FAFAFA',
          100: '#F4F4F5',
          200: '#E4E4E7',
          300: '#D4D4D8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', 'sans-serif'],
      },
      boxShadow: {
        xs:          '0 1px 2px rgba(0,0,0,0.05)',
        sm:          '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
        card:        '0 1px 4px rgba(60,40,20,0.07), 0 0 0 1px rgba(60,40,20,0.05)',
        'card-hover':'0 4px 16px rgba(60,40,20,0.11), 0 0 0 1px rgba(60,40,20,0.07)',
        focus:       '0 0 0 3px rgba(199,91,71,0.18)',
      },
      borderRadius: {
        xl:  '0.75rem',
        '2xl': '1rem',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.4,0,0.2,1)',
      },
    },
  },
  plugins: [],
};
