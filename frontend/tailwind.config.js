/** @type {import('tailwindcss').Config} */
import animate from 'tailwindcss-animate';
export default {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		screens: {
  			'desktop': '1440px',
  		},
  		fontFamily: {
  			heading: ['var(--font-heading)'],
  			body: ['var(--font-body)'],
  			mono: ['var(--font-mono)'],
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        'border-subtle': 'hsl(var(--border-subtle))',
        'border-strong': 'hsl(var(--border-strong))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        'ring-offset': 'hsl(var(--ring-offset))',
        'surface-subtle': 'hsl(var(--surface-subtle))',
        'surface-muted': 'hsl(var(--surface-muted))',
        surface: 'hsl(var(--surface))',
        'surface-hover': 'hsl(var(--surface-hover))',
        'surface-active': 'hsl(var(--surface-active))',
        'surface-elevated': 'hsl(var(--surface-elevated))',
        'surface-contrast': 'hsl(var(--surface-contrast))',
        copy: {
          primary: 'hsl(var(--text-primary))',
          secondary: 'hsl(var(--text-secondary))',
          muted: 'hsl(var(--text-muted))',
          tertiary: 'hsl(var(--text-tertiary))',
          disabled: 'hsl(var(--text-disabled))',
          inverse: 'hsl(var(--text-inverse))'
        },
        placeholder: 'hsl(var(--placeholder))',
        'brand-cyan': 'hsl(var(--brand-cyan))',
        'brand-cyan-text': 'hsl(var(--brand-cyan-text))',
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          soft: 'hsl(var(--success-soft))',
          border: 'hsl(var(--success-border))'
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          soft: 'hsl(var(--warning-soft))',
          border: 'hsl(var(--warning-border))'
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
          soft: 'hsl(var(--info-soft))',
          border: 'hsl(var(--info-border))'
        },
        danger: {
          DEFAULT: 'hsl(var(--danger))',
          foreground: 'hsl(var(--danger-foreground))',
          soft: 'hsl(var(--danger-soft))',
          border: 'hsl(var(--danger-border))'
        },
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))'
        }
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-md)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)'
      },
  		keyframes: {
  			'accordion-down': {
  				from: { height: '0' },
  				to: { height: 'var(--radix-accordion-content-height)' }
  			},
  			'accordion-up': {
  				from: { height: 'var(--radix-accordion-content-height)' },
  				to: { height: '0' }
  			},
  			'pulse-glow': {
  				'0%, 100%': { opacity: '0.4' },
  				'50%': { opacity: '1' }
  			},
  			'float': {
  				'0%, 100%': { transform: 'translateY(0px)' },
  				'50%': { transform: 'translateY(-10px)' }
  			},
  			'scan': {
  				'0%': { transform: 'translateY(-100%)' },
  				'100%': { transform: 'translateY(100%)' }
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
  			'float': 'float 6s ease-in-out infinite',
  			'scan': 'scan 8s linear infinite'
  		}
  	}
  },
  plugins: [animate],
}
