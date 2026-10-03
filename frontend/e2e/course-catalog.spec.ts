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
  await page.route('**/api/courses/catalogo-proximo', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(upcoming),
  }));
});

for (const width of [320, 390, 768, 1440]) {
  test(`all courses links both states to the shared template at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    if (width < 1440) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await page.getByRole('button', { name: 'Formación', exact: true }).filter({ visible: true }).click();
    const menu = page.locator(width < 1440 ? '#main-mobile-menu' : '[id^="desktop-menu-"]').filter({ visible: true });
    await expect(menu.getByRole('link', { name: published.name, exact: true })).toBeVisible();
    await expect(menu.getByRole('link', { name: upcoming.name, exact: true })).toHaveCount(0);
    const upcomingEntry = menu.locator('[data-course-status="upcoming"]').filter({ hasText: upcoming.name });
    await upcomingEntry.scrollIntoViewIfNeeded();
    await expect(upcomingEntry).toBeVisible();
    await expect(upcomingEntry).toHaveAttribute('aria-disabled', 'true');
    await expect(upcomingEntry.getByText('Próximamente', { exact: true })).toBeVisible();
    await expect(upcomingEntry.locator('a')).toHaveCount(0);
    if (width >= 1440) expect(await upcomingEntry.evaluate(node => node.previousElementSibling?.textContent?.trim())).toBe('Otros cursos');
    await menu.getByRole('link', { name: 'Todos los cursos', exact: true }).click();
    await expect(page).toHaveURL(/\/formacion$/);
    await expect(page.getByRole('heading', { name: 'Todos los cursos', exact: true })).toBeVisible();
    const publishedCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: published.name, exact: true }) });
    const upcomingCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: upcoming.name, exact: true }) });
    await expect(publishedCard.getByText('Publicado', { exact: true })).toBeVisible();
    await expect(upcomingCard.getByText('Próximamente', { exact: true })).toBeVisible();
    await expect(upcomingCard.getByRole('link', { name: 'Ver curso', exact: true })).toHaveAttribute('href', '/formacion/catalogo-proximo');
    await expect(upcomingCard.getByText(upcoming.short_description, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.reload();
    await expect(publishedCard).toBeVisible();
    await expect(upcomingCard).toBeVisible();
    await upcomingCard.getByRole('link', { name: 'Ver curso', exact: true }).click();
    await expect(page).toHaveURL(/\/formacion\/catalogo-proximo$/);
    await expect(page.getByRole('heading', { name: upcoming.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Próximamente', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: upcoming.name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.goto('/formacion');
    await publishedCard.getByRole('link', { name: 'Ver curso', exact: true }).click();
    await expect(page).toHaveURL(/\/formacion\/catalogo-publicado$/);
    await expect(page.getByRole('heading', { name: published.name, exact: true })).toBeVisible();
    await expect(page.getByText(published.description, { exact: true })).toBeVisible();
  });
}

test('an open Aeromodelismo card and page refresh when publication changes while the tab is hidden', async ({ page }) => {
  const course = { ...published, id: 'aeromodelismo-focus', name: 'Aeromodelismo', slug: 'aeromodelismo', category: 'other' };
  let available = false;
  let description = course.description;
  await page.route('**/api/courses', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([{ ...course, status: available ? 'published' : 'upcoming' }]),
  }));
  await page.route('**/api/courses/aeromodelismo', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ ...course, description }),
  }));
  const visibility = async (value: 'hidden' | 'visible') => page.evaluate(state => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, value);
  await page.goto('/formacion');
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: course.name, exact: true }) });
  await expect(card.getByText('Próximamente', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Ver curso', exact: true })).toHaveAttribute('href', '/formacion/aeromodelismo');
  await visibility('hidden');
  available = true;
  await visibility('visible');
  await expect(card.getByRole('link', { name: 'Ver curso', exact: true })).toHaveAttribute('href', '/formacion/aeromodelismo');
  await expect(card.getByText('Publicado', { exact: true })).toBeVisible();
  await card.getByRole('link', { name: 'Ver curso', exact: true }).click();
  await expect(page.getByRole('heading', { name: course.name, exact: true })).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await visibility('hidden');
  description = 'Descripción actualizada desde el panel de cursos.';
  await visibility('visible');
  await expect(page.getByText(description, { exact: true })).toBeVisible();
});

test('empty catalog is distinct from upcoming courses', async ({ page }) => {
  await page.route('**/api/courses', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto('/formacion');
  await expect(page.getByText('Todavía no hay cursos disponibles.', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});
