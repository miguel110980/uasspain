import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import LiveConnectionActions from './LiveConnectionActions';

test.each([
  ['admin', false, false, 1], ['admin', true, false, 1],
  ['instructor', false, false, 1], ['instructor', true, false, 4],
  ['alumno', true, false, 4], ['alumno', true, true, 1],
  ['instructor', undefined, false, 1],
] as const)('live session actions: role=%s permission=%s readOnly=%s', (rol, allowed, readOnly, buttons) => {
  const noop = () => {};
  const html = renderToStaticMarkup(<LiveConnectionActions record={{ rol, can_manage_session: allowed }}
    readOnly={readOnly} onDetails={noop} onFinish={noop} onFinishAll={noop} onBlock={noop} />);
  expect(html.match(/<button/g)).toHaveLength(buttons);
  expect(html).toContain('aria-label="Ver detalles"');
  expect(html.includes('aria-label="Finalizar sesión"')).toBe(buttons === 4);
  expect(html.includes('aria-label="Finalizar todas"')).toBe(buttons === 4);
  expect(html.includes('aria-label="Bloquear usuario"')).toBe(buttons === 4);
  expect(html).not.toContain('disabled');
});
