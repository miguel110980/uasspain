import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { Course } from '@/services/contentService';

vi.mock('@/components/layout/Navbar', () => ({ default: () => <nav>navegación</nav> }));
vi.mock('@/components/layout/Footer', () => ({ default: () => <footer>pie</footer> }));

import CourseTemplate from './CourseTemplate';

const baseCourse: Course = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Curso dinámico',
  slug: 'curso-dinamico',
  short_description: 'Resumen público',
  description: 'Descripción privada',
  introduction: 'Introducción privada',
  syllabus: 'Temario privado',
  cover_image_url: '',
  modality: 'online',
  category: 'other',
  duration: '40 horas',
  status: 'upcoming',
  sort_order: 0,
  sections: [],
};

function render(course: Course) {
  return renderToStaticMarkup(
    <MemoryRouter><CourseTemplate course={course} /></MemoryRouter>,
  );
}

describe('CourseTemplate', () => {
  it('muestra Próximamente y no renderiza contenido privado', () => {
    const html = render({ ...baseCourse, content_available: false });
    expect(html).toContain('Próximamente');
    expect(html).not.toContain('Descripción privada');
    expect(html).not.toContain('Introducción privada');
    expect(html).not.toContain('Temario privado');
  });

  it('renderiza el contenido y las secciones de un curso publicado', () => {
    const html = render({
      ...baseCourse,
      status: 'published',
      content_available: true,
      sections: [{
        id: '00000000-0000-0000-0000-000000000002',
        course_id: baseCourse.id,
        title: 'Operaciones STS',
        body: 'Contenido de la sección',
        sort_order: 0,
      }],
    });
    expect(html).toContain('Descripción privada');
    expect(html).toContain('Operaciones STS');
    expect(html).toContain('Contenido de la sección');
    expect(html).not.toContain('El curso aparecerá disponible');
  });

  it('escapa texto no confiable y muestra modalidad y duración sin HTML ejecutable', () => {
    const html = render({ ...baseCourse, status: 'published', modality: 'presencial', duration: '3 semanas', description: '<img src=x onerror=alert(1)>', introduction: '', syllabus: '' });
    expect(html).toContain('Presencial');
    expect(html).toContain('3 semanas');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src="x"');
  });
});
