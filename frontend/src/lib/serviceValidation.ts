import type { ServiceInput } from '@/services/contentService';
import type { ServiceNode } from '@/services/contentService';
import { SERVICE_ICONS } from './serviceIcons';

const plain = (value: string) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value);
export function validateServiceInput(input: ServiceInput): string | undefined {
  for (const [key, max] of [['title', 180], ['short_description', 600], ['description', 100000]] as const) {
    const value = input[key] || '';
    if ([...value].length > max || !plain(value) || key === 'title' && !value.trim()) return 'Revisa el título y las descripciones: utiliza texto sin HTML y respeta sus límites.';
  }
  if (input.slug && ([...input.slug].length > 180 || !/^[a-zA-Z0-9À-ÿ -]+$/.test(input.slug) || !input.slug.trim())) return 'El slug admite letras, números, espacios y guiones.';
  if (!Object.hasOwn(SERVICE_ICONS, input.icon || 'Shield')) return 'Selecciona un icono del catálogo.';
  if (!Number.isInteger(input.sort_order) || input.sort_order < 0 || input.sort_order > 2147483647) return 'El orden debe ser un entero positivo o cero.';
  if (!['draft', 'published'].includes(input.status || 'draft')) return 'Selecciona un estado válido.';
  if (Object.values(input.seo || {}).some(value => typeof value !== 'string' || [...value].length > 600 || !plain(value))) return 'Revisa los textos SEO: máximo 600 caracteres, sin HTML.';
  if (input.presentation) {
    let remaining = 2000;
    const validTextNodes = (nodes: ServiceNode[], depth: number): boolean => depth <= 30 && Array.isArray(nodes) && nodes.every(node => --remaining >= 0 && (typeof node === 'string' ? [...node].length <= 100000 && plain(node) : node && Array.isArray(node.children) && validTextNodes(node.children, depth + 1)));
    const { layout = [], ...originals } = input.presentation;
    if (new TextEncoder().encode(JSON.stringify(input.presentation)).length > 150000 || Object.values(originals).some(value => typeof value !== 'string' || [...value].length > 100000 || !plain(value)) || !validTextNodes(layout, 0)) return 'Revisa el contenido complementario: utiliza texto sin HTML y reduce su tamaño si supera el límite.';
  }
  return undefined;
}
