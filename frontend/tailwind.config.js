/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Apple red — primary brand color (#ED3A33, slightly deeper than coral)
        ringo: {
          50:  '#FFF1F0',
          100: '#FFD9D7',
          200: '#FFB0AB',
          300: '#FF867F',
          400: '#F85850',
          500: '#ED3A33',   // primary — apple red
          600: '#D02A24',
          700: '#B82820',
          800: '#3A1812',   // sidebar dark surface (unchanged for contrast)
          900: '#2A1512',   // darkest — login gradient
        },
        // Warm mustard — accent color
        mustard: {
          50:  '#FBF6E1',
          100: '#F7ECC0',
          200: '#EFD986',
          300: '#E2C24F',
          400: '#D4AC2E',
          500: '#C9A227',
          600: '#9B7917',
          700: '#74590C',
        },
        // Warm neutral gray
        warmgray: {
          50:  '#F8F6F2',
          100: '#EFEBE3',
          200: '#DBD3C4',
          300: '#BAAE99',
          400: '#8B7E6A',
          500: '#6B5E4D',
          600: '#4F4538',
          700: '#3A3127',
          800: '#28211A',
          900: '#1A140F',
        },
        // Cream tones — base bg is #FEFBFB
        cream: {
          50:  '#FEFBFB',
          100: '#FBF6F6',
          200: '#F5EDED',
          300: '#EDE3E3',
        },
        // Neutral surfaces (cool/white)
        surface: {
          0:   '#FFFFFF',
          50:  '#FAFAFA',
          100: '#F4F4F5',
          200: '#E4E4E7',
          300: '#D4D4D8',
        },
        // Teal for settlement stage
        teal: {
          50:  '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E',
        },
      },
      fontFamily: {
        sans: [
          'Inter Tight',
          'Noto Sans JP',
          'Hiragino Sans',
          'Yu Gothic',
          'Meiryo',
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        xs:           '0 1px 2px rgba(0,0,0,0.05)',
        sm:           '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
        card:         '0 1px 4px rgba(60,40,20,0.07), 0 0 0 1px rgba(60,40,20,0.05)',
        'card-hover': '0 4px 16px rgba(60,40,20,0.11), 0 0 0 1px rgba(60,40,20,0.07)',
        focus:        '0 0 0 3px rgba(255,70,64,0.20)',
      },
      borderRadius: {
        xl:   '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.4,0,0.2,1)',
        spring: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
