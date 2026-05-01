import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--ring))',
          foreground: 'hsl(var(--panel))'
        },
        panel: {
          DEFAULT: 'hsl(var(--panel))',
          foreground: 'hsl(var(--panel-foreground))'
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        danger: 'hsl(var(--danger))',
        info: 'hsl(var(--info))',
        extra: 'hsl(var(--extra))'
      },
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        focus: '0 0 0 2px hsl(var(--ring) / 0.25)',
        glow: '0 0 8px hsl(var(--ring) / 0.35)',
        'glow-success': '0 0 8px hsl(var(--success) / 0.3)',
        'glow-danger': '0 0 8px hsl(var(--danger) / 0.3)'
      }
    }
  },
  plugins: []
}

export default config
