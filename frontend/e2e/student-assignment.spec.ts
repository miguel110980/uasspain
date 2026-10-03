import { expect, test, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { adminClient, apiClient, check, registerFixture } from '../../scripts/e2e/auth-fixtures.mjs';

async function openStudents(page: Page, email: string, password: string) {
  await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *', { exact: true }).fill(email);
  await page.getByLabel('Contraseña *', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/instructor$/);
  await page.locator('aside:visible nav').getByRole('button', { name: 'Alumnos', exact: true }).click();
}

test('instructor selectors persist transfers, handle errors and update both scoped lists', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const admin = await adminClient();
  const owner = (await admin.call('/api/profiles/')).body.find(profile => profile.email === 'instructor.e2e@test.local');
  const recipientPassword = `Aa9!${randomBytes(18).toString('hex')}`;
  const suffix = randomUUID();
  const recipient = await admin.call('/api/users/crear-instructor/', 'POST', {
    nombre: owner.nombre, apellidos: owner.apellidos, email: `selector-${suffix}@test.local`, username: `selector-${suffix}`,
    dni_nie: `SEL-${suffix}`, fecha_nacimiento: '1990-01-01', password: recipientPassword, es_admin: false,
  });
  check(recipient.status === 201, 'Recipient fixture creation');
  const student = await registerFixture(`Alumno selector ${Date.now()}`);
  const studentClient = apiClient();
  check((await studentClient.call('/api/auth/verify-otp/', 'POST', { email: student.email, code: student.code })).status === 200, 'Student fixture verification');
  check((await admin.call(`/api/profiles/${student.id}/`, 'PATCH', { status: 'activo', assigned_instructor_id: owner.id })).status === 200, 'Student fixture assignment');
  const studentName = (await admin.call(`/api/profiles/${student.id}/`)).body;
  const fullName = `${studentName.nombre} ${studentName.apellidos}`;
  const recipientContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 } });
  const recipientPage = await recipientContext.newPage();
  let release: (() => void) | undefined;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStudents(page, owner.email, 'E2eInstr_2026!'); // pragma: allowlist secret - isolated fixture
    const table = page.getByRole('table');
    const section = table.locator('../../..');
    const total = section.getByText('Total', { exact: true }).locator('../..').locator('p.font-heading');
    const row = table.locator('tbody tr').filter({ has: page.getByText(fullName, { exact: true }) });
    const selector = row.getByRole('combobox', { name: `Instructor de ${fullName}`, exact: true });
    await expect(selector).toHaveValue(owner.id);
    const initialCount = Number(await total.innerText());
    await expect(selector.locator(`option[value="${recipient.body.id}"]`)).toContainText(`@${recipient.body.username}`);
    await expect(selector.locator('option[value=""]')).toBeDisabled();
    expect((await selector.locator('option').allTextContents()).some(label => label.includes(recipient.body.email))).toBe(false);
    const search = section.getByPlaceholder('Buscar por nombre, email o usuario…');
    await search.fill(studentName.nombre);
    await expect(row).toBeVisible();
    await expect(total).toHaveText(String(initialCount));
    await search.fill('');
    await openStudents(recipientPage, recipient.body.email, recipientPassword);
    const receivingRow = recipientPage.getByRole('table').locator('tbody tr').filter({ has: recipientPage.getByText(fullName, { exact: true }) });
    await expect(receivingRow).toHaveCount(0);
    const path = `**/api/profiles/${recipient.body.id}/assign-alumnos/`;
    await page.route(path, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Error simulado de asignación.' }) }));
    await selector.selectOption(recipient.body.id);
    await expect(row.getByRole('alert')).toHaveText('Error simulado de asignación.');
    await expect(selector).toHaveValue(owner.id);
    expect((await admin.call(`/api/profiles/${student.id}/`)).body.assigned_instructor_id).toBe(owner.id);
    await page.unroute(path);
    const barrier = new Promise<void>(resolve => { release = resolve; });
    await page.route(path, async route => { await barrier; await route.continue(); });
    await selector.selectOption(recipient.body.id);
    await expect(selector).toBeDisabled();
    await expect(row.getByRole('status')).toHaveText('Guardando asignación…');
    release!();
    await expect(row).toHaveCount(0);
    await expect(total).toHaveText(String(initialCount - 1));
    await expect(receivingRow).toBeVisible({ timeout: 20_000 });
    const receivingSelector = receivingRow.getByRole('combobox', { name: `Instructor de ${fullName}`, exact: true });
    await expect(receivingSelector).toHaveValue(recipient.body.id);
    expect((await admin.call(`/api/profiles/${student.id}/`)).body.assigned_instructor_id).toBe(recipient.body.id);
    await recipientPage.reload();
    await recipientPage.locator('aside:visible nav').getByRole('button', { name: 'Alumnos', exact: true }).click();
    await expect(receivingSelector).toHaveValue(recipient.body.id);
    const stateFilter = recipientPage.getByRole('combobox').filter({ has: recipientPage.locator('option[value="todos"]') });
    await stateFilter.selectOption('bloqueado');
    await expect(receivingRow).toHaveCount(0);
    await stateFilter.selectOption('activo');
    await expect(receivingRow).toBeVisible();
    for (const width of [320, 768, 1440]) {
      await recipientPage.setViewportSize({ width, height: 900 });
      await receivingSelector.scrollIntoViewIfNeeded();
      await expect(receivingSelector).toBeInViewport();
      expect(await recipientPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  } finally {
    release?.();
    await recipientContext.close();
    await admin.call(`/api/profiles/${student.id}/`, 'DELETE');
    await admin.call(`/api/profiles/${recipient.body.id}/`, 'DELETE');
  }
});
