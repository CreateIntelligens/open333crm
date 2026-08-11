import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // 由 next/font 注入的 CSS 變數；英數走 Inter、中文走 Noto Sans TC
        sans: ['var(--font-sans)', 'var(--font-zh)', 'system-ui', 'sans-serif'],
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
          hover: 'hsl(var(--primary-hover))',
          subtle: 'hsl(var(--primary-subtle))',
          border: 'hsl(var(--primary-border))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          subtle: 'hsl(var(--destructive-subtle))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          subtle: 'hsl(var(--success-subtle))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          subtle: 'hsl(var(--warning-subtle))',
        },
        ai: {
          DEFAULT: 'hsl(var(--ai))',
          foreground: 'hsl(var(--ai-foreground))',
          subtle: 'hsl(var(--ai-subtle))',
          border: 'hsl(var(--ai-border))',
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
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',  // 16px 聊天泡泡/卡片
        lg: 'var(--radius)',              // 12px 主力
        md: 'calc(var(--radius) - 4px)',  // 8px 按鈕/輸入框
        sm: 'calc(var(--radius) - 6px)',  // 6px 小元件
      },
      boxShadow: {
        // 對齊 Figma effect tokens (柔和低透明度)
        xs: '0 1px 2px rgba(0,0,0,0.05)',
        soft: '0 0 4px rgba(0,0,0,0.1)',
        bubble: '0 0 6px rgba(0,0,0,0.15)',
        dropdown: '0 4px 10px rgba(0,0,0,0.1)',
        'glow-primary': '0 0 12px rgba(55,138,221,0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
