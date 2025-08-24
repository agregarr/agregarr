// eslint-disable-next-line @typescript-eslint/no-var-requires
const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  mode: 'jit',
  content: [
    './node_modules/react-tailwindcss-datepicker-sct/dist/index.esm.js',
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/types/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      transitionProperty: {
        'max-height': 'max-height',
        width: 'width',
      },
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        // Orange on Slate theme colors
        primary: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        accent: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
      },
      typography: (theme) => ({
        DEFAULT: {
          css: {
            color: theme('colors.slate.300'),
            a: {
              color: theme('colors.orange.500'),
              '&:hover': {
                color: theme('colors.orange.400'),
              },
            },

            h1: {
              color: theme('colors.slate.300'),
            },
            h2: {
              color: theme('colors.slate.300'),
            },
            h3: {
              color: theme('colors.slate.300'),
            },
            h4: {
              color: theme('colors.slate.300'),
            },
            h5: {
              color: theme('colors.slate.300'),
            },
            h6: {
              color: theme('colors.slate.300'),
            },

            strong: {
              color: theme('colors.slate.400'),
            },

            code: {
              color: theme('colors.slate.300'),
            },

            figcaption: {
              color: theme('colors.slate.500'),
            },
          },
        },
      }),
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
  ],
};
