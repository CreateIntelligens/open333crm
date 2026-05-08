import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // === Figma Design System tokens ===
        neutral: {
          10: '#FCFCFE',
          20: '#F7F9FB',
          30: '#F0F2F7',
          40: '#E8ECF3',
          50: '#E1E5EF',
          60: '#D9DFEB',
          70: '#A3A7B0',
          80: '#6D7076',
          90: '#36383B',
          100: '#000000',
        },
        brand: {
          10: '#EADBEF',
          20: '#D5B7DF',
          30: '#C093CF',
          40: '#AB6FBF',
          50: '#964BAF',
          60: '#8A38F5',
          70: '#6E2DC4',
          80: '#522293',
          90: '#371662',
          100: '#1E0F23',
          DEFAULT: '#8A38F5',
        },
        // Figma colour scales — namespaced with `f-` prefix to avoid clobbering Tailwind defaults.
        // Use these in Figma-aligned components: bg-f-green-10, text-f-red-80, etc.
        'f-red': {
          10: '#F7EDED',
          20: '#EFD5D5',
          30: '#E6BBBB',
          40: '#DD9F9F',
          50: '#D38181',
          60: '#C95F5F',
          70: '#A04848',
          80: '#763131',
          90: '#4D1B1B',
          100: '#230F0F',
        },
        'f-orange': {
          10: '#FBF4EC',
          20: '#F7E5D0',
          30: '#F2D4B0',
          40: '#EDC18C',
          50: '#E7AC60',
          60: '#E0942B',
          70: '#B27521',
          80: '#845818',
          90: '#573A0F',
          100: '#2A1C0C',
        },
        'f-lime': {
          10: '#F7F7E8',
          20: '#EEEFCB',
          30: '#E4E5AA',
          40: '#D8DA86',
          50: '#CACD5E',
          60: '#BABE2D',
          70: '#929523',
          80: '#6C6E1A',
          90: '#474812',
          100: '#232206',
        },
        'f-green': {
          10: '#EAF6EE',
          20: '#CDE8D5',
          30: '#ADD8B9',
          40: '#88C599',
          50: '#5DB075',
          60: '#229A4F',
          70: '#1B7B3F',
          80: '#155C2F',
          90: '#0E3D1F',
          100: '#071E0F',
        },
        'f-irish': {
          10: '#E8F4F1',
          20: '#C9E4DC',
          30: '#A6D2C5',
          40: '#7FBEAB',
          50: '#52A88E',
          60: '#1F906E',
          70: '#187358',
          80: '#125641',
          90: '#0C392C',
          100: '#061C16',
        },
        // 語意色（Figma 中出現的特定 hex）
        link: '#2876C4',
        ink: {
          DEFAULT: '#314158',
          subtle: '#62748E',
          dim: '#000929',
        },
        surface: {
          active: '#EFF6FF',
          line: '#E2E8F0',
          canvas: '#F8FAFC',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // === Figma 圓角 token ===
        card: '12px',
        chip: '8px',
        avatar: '30px',
      },
      fontSize: {
        // === Figma typography (Heading line-height 120%, Body 140-160%) ===
        'h1': ['48px', { lineHeight: '57.6px', fontWeight: '700' }],
        'h2': ['32px', { lineHeight: '38.4px', fontWeight: '700' }],
        'h3': ['28px', { lineHeight: '33.6px', fontWeight: '700' }],
        'h4': ['24px', { lineHeight: '28.8px', fontWeight: '600' }],
        'h5': ['20px', { lineHeight: '24px', fontWeight: '600' }],
        'h6': ['16px', { lineHeight: '19.2px', fontWeight: '600' }],
        'body-xl': ['20px', { lineHeight: '32px', fontWeight: '400' }],
        'body-lg': ['18px', { lineHeight: '28px', fontWeight: '400' }],
        'body-base': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-sm': ['14px', { lineHeight: '20px', fontWeight: '400' }],
      },
      spacing: {
        // Figma 常見間距
        '4.5': '18px',
      },
    },
  },
  plugins: [],
};

export default config;
