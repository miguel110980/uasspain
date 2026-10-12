import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ServicePresentation } from './servicePresentation';
import type { ManagedService } from '@/services/contentService';

test('Windows line endings preserve separate imported paragraphs and extra edited content', () => {
  const service = {
    title: 'Service', description: 'First edited paragraph\r\n\r\nSecond edited paragraph\r\n\r\nAdditional paragraph',
    presentation: { original_description: 'First original paragraph\n\nSecond original paragraph', layout: [
      { tag: 'p', props: {}, children: ['First original paragraph'] },
      { tag: 'p', props: {}, children: ['Second original paragraph'] },
    ] },
  } as ManagedService;
  const html = renderToStaticMarkup(<MemoryRouter><ServicePresentation service={service} /></MemoryRouter>);
  expect(html).toContain('First edited paragraph</p><p');
  expect(html).toContain('Second edited paragraph');
  expect(html.match(/<p\b/g)).toHaveLength(3);
  expect(html).toContain('Additional paragraph');
});
