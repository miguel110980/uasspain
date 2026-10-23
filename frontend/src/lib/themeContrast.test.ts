import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const tokens = (selector: string) => Object.fromEntries([...css.match(new RegExp(selector + '\\s*\\{([\\s\\S]*?)\\n  \\}'))[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2]]));
const light = tokens(':root'), dark = { ...light, ...tokens('\\.dark') };
function luminance(value: string, palette: Record<string, string>): number {
  if (value.startsWith('var(')) return luminance(palette[value.slice(6, -1)], palette);
  const [h, percentS, percentL] = value.split(' ').map(parseFloat), s = percentS / 100, l = percentL / 100;
  const channel = (n: number) => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [channel(0), channel(8), channel(4)].reduce((sum, c, i) => sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i], 0);
}
function contrast(fg: string, bg: string, palette: Record<string, string>) {
  const [a, b] = [luminance(palette[fg], palette), luminance(palette[bg], palette)].sort((a, b) => b - a);
  return (a + .05) / (b + .05);
}
for (const [mode, palette] of Object.entries({ light, dark })) describe(`${mode} shared token contrast`, () => {
  for (const surface of ['background', 'card', 'surface', 'surface-subtle', 'surface-muted', 'popover']) {
    for (const text of ['foreground', 'muted-foreground', 'text-secondary', 'text-tertiary', 'placeholder', 'brand-cyan-text'])
      it(`${text} on ${surface} meets normal text AA`, () => expect(contrast(text, surface, palette)).toBeGreaterThanOrEqual(4.5));
    it(`control boundary on ${surface} meets non-text AA`, () => expect(contrast('input', surface, palette)).toBeGreaterThanOrEqual(3));
  }
  for (const state of ['success', 'danger', 'warning', 'info'])
    it(`${state} on its soft surface meets normal text AA`, () => expect(contrast(state, `${state}-soft`, palette)).toBeGreaterThanOrEqual(4.5));
  for (const state of ['success', 'danger', 'primary', 'warning', 'info', 'accent', 'destructive', 'secondary'])
    it(`filled ${state} text meets AA`, () => expect(contrast(`${state}-foreground`, state, palette)).toBeGreaterThanOrEqual(4.5));
  for (let index = 1; index <= 6; index++)
    it(`chart series ${index} on card meets non-text AA`, () => expect(contrast(`chart-${index}`, 'card', palette)).toBeGreaterThanOrEqual(3));
});
