import type { ThemeProviderProps } from 'next-themes';

// Shared by the provider, prerenderer and pre-paint initializer. next-themes
// gives a saved light/dark choice priority over the system preference.
export const THEME_OPTIONS = {
  attribute: 'class',
  storageKey: 'theme',
  defaultTheme: 'system',
  enableSystem: true,
  enableColorScheme: true,
} satisfies ThemeProviderProps;

// SVG charts cannot use Tailwind text classes. CSS variables keep their
// strokes, fills and tooltips in the same palette as the rest of each panel.
export const CHART_COLORS = {
  cyan: 'hsl(var(--chart-1))', orange: 'hsl(var(--chart-2))',
  blue: 'hsl(var(--chart-3))', neutral: 'hsl(var(--chart-4))',
  green: 'hsl(var(--chart-5))', red: 'hsl(var(--chart-6))',
};
export const CHART_TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))',
  border: '1px solid hsl(var(--input))', borderRadius: 6, fontSize: 12,
};
