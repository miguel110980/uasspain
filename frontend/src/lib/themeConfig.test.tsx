/// <reference types="node" />
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runInNewContext } from 'node:vm';
import { ThemeProvider } from 'next-themes';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { THEME_OPTIONS } from './themeConfig';
import HeroSection from '@/components/sections/HeroSection';
import { IMAGES } from './images';

const markup = renderToStaticMarkup(<ThemeProvider {...THEME_OPTIONS} />);
const initializer = markup.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];

function initialize(saved: string | null, system: 'light' | 'dark') {
  const classes = new Set(['light', 'dark', 'unrelated']);
  const root = { classList: {
    remove: (...names: string[]) => names.forEach(name => classes.delete(name)),
    add: (name: string) => classes.add(name),
  }, style: { colorScheme: '' } };
  runInNewContext(initializer, {
    document: { documentElement: root },
    localStorage: { getItem: (key: string) => {
      expect(key).toBe('theme'); return saved;
    } },
    window: { matchMedia: () => ({ matches: system === 'dark' }) },
  });
  return { classes: [...classes].sort(), scheme: root.style.colorScheme };
}

describe('shared pre-paint theme policy', () => {
  it.each([
    ['light', 'light', 'light'], ['dark', 'dark', 'dark'],
    ['light', 'dark', 'light'], ['dark', 'light', 'dark'],
    [null, 'light', 'light'], [null, 'dark', 'dark'],
    ['system', 'light', 'light'], ['system', 'dark', 'dark'],
  ] as const)('saved %s / system %s resolves to %s', (saved, system, expected) => {
    expect(initialize(saved, system)).toEqual({ classes: [expected, 'unrelated'].sort(), scheme: expected });
  });

  it.each(['light', 'dark'] as const)('reload preserves saved %s without stale classes', theme => {
    expect(initialize(theme, 'dark')).toEqual(initialize(theme, 'light'));
  });
});

describe('canonical hero background', () => {
  function picture(theme: 'light' | 'dark') {
    return renderToStaticMarkup(<ThemeProvider {...THEME_OPTIONS} forcedTheme={theme}>
      <MemoryRouter><HeroSection /></MemoryRouter>
    </ThemeProvider>).match(/<picture>[\s\S]*?<\/picture>/)?.[0];
  }

  it('uses the identical image and responsive variants in both themes', () => {
    expect(picture('light')).toBe(picture('dark'));
    expect(picture('light')).toContain(`src="${IMAGES.hero}"`);
    expect(picture('light')).toContain('/images/hero-claro-portrait-320.webp');
    expect(picture('light')).not.toContain('hero-oscuro');
    expect(picture('light')).not.toContain('prefers-color-scheme');
  });
});
