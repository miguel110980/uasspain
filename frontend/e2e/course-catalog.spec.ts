import { expect, test } from '@playwright/test';

const published = {
  id: 'catalog-published', name: 'Curso publicado de catálogo', slug: 'catalogo-publicado',
  short_description: 'Programa disponible.', description: 'Descripción completa.',
  category: 'easa', modality: 'online', duration: '40 horas', status: 'published', cover_image_url: '',
  sections: [{ id: 'topic', title: 'Temario publicado', body: 'Contenido', sort_order: 0 }],
};
const upcoming = {
  id: 'catalog-upcoming', name: 'Curso próximo de catálogo', slug: 'catalogo-proximo',
  short_description: 'Próxima convocatoria.', description: '', content_available: false,
  category: 'other', modality: 'presencial', duration: '3 semanas', status: 'upcoming', cover_image_url: '',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/**', route => route.fulfill({
    status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Sin sesión' }),
  }));
  await page.route('**/api/courses', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([upcoming, published]),
  }));
  await page.route('**/api/courses/catalogo-publicado', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(published),
  }));
});

for (const width of [320, 390, 768, 1440]) {
  test(`all courses lists both states and opens published content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    if (width < 1440) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await page.getByRole('button', { name: 'Formación', exact: true }).filter({ visible: true }).click();
    const menu = page.locator(width < 1440 ? '#main-mobile-menu' : '[id^="desktop-menu-"]').filter({ visible: true });
    await expect(menu.getByRole('link', { name: published.name, exact: true })).toBeVisible();
    await expect(menu.getByRole('link', { name: upcoming.name, exact: true })).toHaveCount(0);
    await menu.getByRole('link', { name: 'Todos los cursos', exact: true }).click();
    await expect(page).toHaveURL(/\/formacion$/);
    await expect(page.getByRole('heading', { name: 'Todos los cursos', exact: true })).toBeVisible();
    const publishedCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: published.name, exact: true }) });
    const upcomingCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: upcoming.name, exact: true }) });
    await expect(publishedCard.getByText('Publicado', { exact: true })).toBeVisible();
    await expect(upcomingCard.getByText('Próximamente', { exact: true })).toBeVisible();
    await expect(upcomingCard.getByRole('link')).toHaveCount(0);
    await expect(upcomingCard.getByText(upcoming.short_description, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.reload();
    await expect(publishedCard).toBeVisible();
    await expect(upcomingCard).toBeVisible();
    await publishedCard.getByRole('link', { name: 'Ver curso', exact: true }).click();
    await expect(page).toHaveURL(/\/formacion\/catalogo-publicado$/);
    await expect(page.getByRole('heading', { name: published.name, exact: true })).toBeVisible();
    await expect(page.getByText(published.description, { exact: true })).toBeVisible();
  });
}

test('empty catalog is distinct from upcoming courses', async ({ page }) => {
  await page.route('**/api/courses', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto('/formacion');
  await expect(page.getByText('Todavía no hay cursos disponibles.', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});
