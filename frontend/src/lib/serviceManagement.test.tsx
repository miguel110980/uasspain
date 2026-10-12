import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';
import { SERVICE_ICONS, SERVICE_ICON_GROUPS, serviceIcon } from './serviceIcons';
import { publicServiceLink, ServicePresentation } from './servicePresentation';
import { validateServiceInput } from './serviceValidation';
import type { ManagedService } from '@/services/contentService';

test('the selectable catalogue, Rust validator and PostgreSQL constraint agree', () => {
  const rust = readFileSync(new URL('../../../backend-rust/src/services.rs', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../../../backend-rust/migrations/0024_service_routes_and_retired_fields.sql', import.meta.url), 'utf8');
  const identifiers = Object.keys(SERVICE_ICONS);
  expect(identifiers.length).toBeGreaterThan(60);
  const offered = SERVICE_ICON_GROUPS.flatMap(group => group.icons.map(icon => icon.id));
  expect([...new Set(offered)].sort()).toEqual(identifiers.sort());
  expect(rust.match(/const SERVICE_ICONS: &[\s\S]*?= &\[([\s\S]*?)\];/)[1].match(/"\w+"/g).map(value => value.slice(1, -1)).sort()).toEqual(identifiers);
  expect(sql.match(/CHECK \(icon IN \((.*?)\)\)/)[1].match(/'\w+'/g).map(value => value.slice(1, -1)).sort()).toEqual(identifiers);
  for (const name of ['constructor', '__proto__', 'javascript:alert(1)', 'missing']) expect(serviceIcon(name)).toBe(SERVICE_ICONS.Shield);
});

test('every original service and a newly created service use the same template', () => {
  const seed = readFileSync(new URL('../../../backend-rust/migrations/0021_managed_services.sql', import.meta.url), 'utf8');
  const originals = [...seed.matchAll(/'(\{"layout":.*?\})','published'/g)].map(match => JSON.parse(match[1]));
  expect(originals).toHaveLength(7);
  for (const presentation of [...originals, {}]) {
    const service = { title: presentation.original_title || 'Nuevo servicio', icon: 'Sprout', short_description: 'Resumen propio', description: presentation.original_description || 'Descripción propia', presentation } as ManagedService;
    const html = renderToStaticMarkup(<MemoryRouter><ServicePresentation service={service} /></MemoryRouter>);
    expect(html.match(/data-service-template="hero"/g)).toHaveLength(1);
    expect(html.match(/data-service-template="content"/g)).toHaveLength(1);
    expect(html).toContain('Resumen propio');
    for (const paragraph of service.description.split(/\r?\n\r?\n/)) expect(html).toContain(paragraph);
    expect(html).not.toContain('w-px h-full');
    expect(html).not.toContain('90deg');
    expect(html).toContain('data-service-icon="Sprout"');
    const collect = (nodes: import('@/services/contentService').ServiceNode[]): string[] => nodes.flatMap(node => typeof node === 'string' ? [] : [...(['h3', 'li', 'motion.li'].includes(node.tag) ? [node.children.map(child => typeof child === 'string' ? child : child.children.filter(value => typeof value === 'string').join('')).join('')] : []), ...collect(node.children)]);
    for (const label of collect(presentation.layout || [])) expect(html).toContain(label);
  }
});

test('plain input blocks markup, invalid order and unsafe slugs without using HTML', () => {
  const valid = { title: 'Fumigación agrícola', icon: 'Sprout', status: 'draft' as const, sort_order: 0, description: 'Primera línea\nSegunda línea' };
  expect(validateServiceInput(valid)).toBeUndefined();
  expect(validateServiceInput({ ...valid, description: 'Primera\r\nSegunda\tcolumna' })).toBeUndefined();
  expect(validateServiceInput({ ...valid, description: 'Control\u0085oculto' })).toBeTruthy();
  expect(validateServiceInput({ ...valid, presentation: { layout: [{ tag: 'section', props: {}, children: ['<script>oculto</script>'] }] } })).toBeTruthy();
  expect(validateServiceInput({ ...valid, presentation: { layout: ['é'.repeat(100000)] } })).toBeTruthy();
  for (const patch of [{ title: '<script>alert(1)</script>' }, { slug: '../admin' }, { slug: '%2e%2e' }, { icon: '__proto__' }, { sort_order: NaN }, { sort_order: 0.5 }, { seo: { title: '<img onerror=x>' } }]) expect(validateServiceInput({ ...valid, ...patch })).toBeTruthy();
  for (const url of ['/admin', '//evil.invalid', '/servicios/../admin', '/servicios/a%2fb', 'javascript:alert(1)']) expect(publicServiceLink(url)).toBe(false);
  expect(publicServiceLink('/servicios/fumigacion')).toBe(true);
});
