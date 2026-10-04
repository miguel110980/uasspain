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
