import { expect, test } from '@playwright/test';
import { adminClient, apiClient, registerFixture, sql, uuid, mailFiles, backend } from '../../scripts/e2e/auth-fixtures.mjs';
import { createDecipheriv, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

test('account closure in all three panels and persistent student administration', async ({ browser }, testInfo) => {
  test.setTimeout(300000);
  expect(testInfo.project.use.baseURL).toBe('https://localhost:8444');
  const admin = await adminClient();
  const initialJobs = new Set(sql('SELECT id FROM mail_outbox').split('\n').filter(Boolean));
  const initialNotices = new Set(sql('SELECT event_id FROM account_notice').split('\n').filter(Boolean));
  const initialFiles = new Set(mailFiles());
  const fixtures: any[] = [], contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  const errors: string[] = [];
  let courseId = '';
  const key = Buffer.from(process.env.E2E_FIELD_ENCRYPTION_KEY || '', 'base64');
  const decode = (value: string) => { const bytes = Buffer.from(value.slice(3), 'base64url'); const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString(); };
  const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const open = async (email: string, password: string, panel: string) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, ignoreHTTPSErrors: false, viewport: { width: 1440, height: 900 } }); contexts.push(context);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?auth=login'); await page.getByLabel('Correo electrónico *', { exact: true }).fill(email); await page.getByLabel('Contraseña *', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click(); await expect(page).toHaveURL(new RegExp('/' + panel + '$'));
    return page;
  };
  try {
    const rootPage = await open('e2e-admin@test.local', process.env.E2E_ADMIN_PASSWORD || 'E2eAdmin_2026!', 'admin'); // pragma: allowlist secret - isolated fixture
    await rootPage.locator('aside:visible nav').getByRole('button', { name: 'Mi cuenta', exact: true }).click();
    let posted = 0; rootPage.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/account/deactivate/')) posted++; });
    await rootPage.getByRole('button', { name: 'Dar de baja mi cuenta', exact: true }).click();
    const protectedDialog = rootPage.getByRole('dialog', { name: 'Confirmar baja de cuenta', exact: true });
    await expect(protectedDialog).toContainText('último administrador operativo'); await expect(protectedDialog.getByRole('button', { name: 'Confirmar baja', exact: true })).toBeDisabled();
    await protectedDialog.getByRole('button', { name: 'Cancelar', exact: true }).click(); expect(posted).toBe(0);
    for (const role of ['alumno', 'instructor', 'admin']) {
      const fixture = await registerFixture('TEMP Browser Lifecycle'); fixtures.push({ ...fixture, role });
      expect((await apiClient().call('/api/auth/verify-otp/', 'POST', { email: fixture.email, code: fixture.code })).status).toBe(200);
      expect((await admin.call(`/api/profiles/${fixture.id}/`, 'PATCH', { status: 'activo', role, roles: [role] })).status).toBe(200);
    }
    for (const fixture of [...fixtures].reverse()) {
      const page = await open(fixture.email, fixture.password, fixture.role);
      await page.locator('aside:visible nav').getByRole('button', { name: fixture.role === 'instructor' ? 'Cuenta' : 'Mi cuenta', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Confirmar baja de cuenta', exact: true });
      let requests = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/account/deactivate/')) requests++; });
      await page.getByRole('button', { name: 'Dar de baja mi cuenta', exact: true }).click(); await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click(); expect(requests).toBe(0); expect(sql(`SELECT status FROM accounts_userprofile WHERE id='${uuid(fixture.id)}'`)).toBe('activo');
      await page.getByRole('button', { name: 'Dar de baja mi cuenta', exact: true }).click();
      await expect(dialog.getByLabel('Escribe DARME DE BAJA', { exact: true })).toBeEnabled();
      await dialog.getByLabel('Escribe DARME DE BAJA', { exact: true }).fill('BAJA'); await dialog.getByLabel('Contraseña actual para confirmar tu identidad', { exact: true }).fill(fixture.password);
      await expect(dialog.getByRole('button', { name: 'Confirmar baja', exact: true })).toBeDisabled();
      await dialog.getByLabel('Escribe DARME DE BAJA', { exact: true }).fill('DARME DE BAJA');
      for (const theme of ['light', 'dark']) for (const width of [320, 375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 }); await page.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light'); }, theme);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveCSS('opacity', '1');
        await expect(dialog.locator('..')).toHaveCSS('opacity', '1');
        await expect.poll(() => dialog.evaluate(element => getComputedStyle(element).backgroundColor.startsWith('rgb('))).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`baja-${fixture.role}-${theme}-${width}.png`) });
      }
      await page.setViewportSize({ width: 1440, height: 900 }); const response = page.waitForResponse(value => value.url().endsWith('/api/account/deactivate/') && value.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Confirmar baja', exact: true }).click(); expect((await response).status()).toBe(200);
      await expect(page).toHaveURL(/https:\/\/localhost:8444\/(\?.*)?$/); await expect(page.getByText('Tu cuenta ha sido dada de baja. El acceso queda deshabilitado.', { exact: true })).toBeVisible();
      expect(requests).toBe(1); expect(sql(`SELECT status FROM accounts_userprofile WHERE id='${fixture.id}'`)).toBe('baja'); await page.reload(); expect(sql(`SELECT status FROM accounts_userprofile WHERE id='${fixture.id}'`)).toBe('baja');
    }
    const student = fixtures[0];
    await rootPage.locator('aside:visible nav').getByRole('button', { name: 'Gestión de Usuarios', exact: true }).click();
    await rootPage.getByRole('navigation', { name: 'Secciones de usuarios', exact: true }).getByRole('button', { name: 'Alumnos', exact: true }).click();
    const active = rootPage.getByRole('region', { name: 'Alumnos activos', exact: true }), inactive = rootPage.getByRole('region', { name: 'Alumnos dados de baja', exact: true });
    await active.getByLabel('Buscar active', { exact: true }).fill(student.id); await inactive.getByLabel('Buscar deactivated', { exact: true }).fill(student.id);
    await expect(inactive.getByText(student.id, { exact: true })).toBeVisible(); await expect(active.getByText(student.id, { exact: true })).toHaveCount(0);
    for (const theme of ['light', 'dark']) for (const width of [320, 375, 768, 1024, 1440, 1920]) {
      await rootPage.setViewportSize({ width, height: 900 }); await rootPage.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light'); }, theme);
      await expect.poll(() => rootPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await rootPage.screenshot({ path: testInfo.outputPath(`alumnos-${theme}-${width}.png`), fullPage: true });
    }
    await rootPage.setViewportSize({ width: 1440, height: 900 });
    await inactive.getByRole('button', { name: 'Reactivar alumno', exact: true }).click(); let reactivateDialog = rootPage.getByRole('dialog', { name: 'Reactivar alumno', exact: true });
    await reactivateDialog.getByRole('button', { name: 'Cancelar', exact: true }).click(); expect(sql(`SELECT status FROM accounts_userprofile WHERE id='${student.id}'`)).toBe('baja');
    await inactive.getByRole('button', { name: 'Reactivar alumno', exact: true }).click(); reactivateDialog = rootPage.getByRole('dialog', { name: 'Reactivar alumno', exact: true });
    await reactivateDialog.getByRole('button', { name: 'Confirmar reactivación', exact: true }).click(); await expect(reactivateDialog).toHaveCount(0);
    await expect(active.getByText(student.id, { exact: true })).toBeVisible(); await expect(inactive.getByText(student.id, { exact: true })).toHaveCount(0);
    const oldPage = contexts[3].pages()[0]; await oldPage.goto('/alumno'); await expect(oldPage).toHaveURL(/auth=login/);
    const newPage = await open(student.email, student.password, 'alumno'); await expect(newPage).toHaveURL(/\/alumno$/);
    const courseName = 'TEMP Browser Lifecycle Course ' + randomUUID();
    const course = await admin.call('/api/admin/courses', 'POST', { name: courseName, description: 'Synthetic UI fixture', category: 'other', modality: 'online', duration: '1 hora', status: 'upcoming' }); expect(course.status).toBe(201); courseId = uuid(course.body.id);
    await rootPage.reload(); await rootPage.locator('aside:visible nav').getByRole('button', { name: 'Gestión de Usuarios', exact: true }).click(); await rootPage.getByRole('navigation', { name: 'Secciones de usuarios', exact: true }).getByRole('button', { name: 'Alumnos', exact: true }).click();
    await active.getByLabel('Buscar active', { exact: true }).fill(student.id); await expect(active.getByText(student.id, { exact: true })).toBeVisible(); await active.getByRole('button', { name: 'Ver detalles', exact: true }).click();
    const detail = rootPage.getByRole('dialog', { name: 'Detalles del alumno', exact: true }); await expect(detail).toContainText('deactivated'); await expect(detail).toContainText('reactivated');
    await detail.getByLabel(/Asociar curso/).selectOption(courseId); await detail.getByLabel('Confirmo la asociación a este curso desde hoy', { exact: true }).check();
    const associated = rootPage.waitForResponse(value => value.url().endsWith(`/api/admin/students/${student.id}/courses/`) && value.request().method() === 'POST');
    await detail.getByRole('button', { name: 'Registrar curso', exact: true }).click(); expect((await associated).status()).toBe(200);
    await expect.poll(() => sql(`SELECT count(*) FROM student_course_registration WHERE profile_id='${student.id}' AND course_id='${courseId}'`)).toBe('1');
    await expect(detail.getByText(courseName, { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
    const eventIds = sql('SELECT event_id FROM account_notice').split('\n').filter(id => id && !initialNotices.has(id)).map(uuid);
    for (const id of eventIds) sql(`DELETE FROM account_notice WHERE event_id='${id}' AND event_id IN (SELECT id FROM account_lifecycle_event WHERE profile_id IN (${fixtures.map(f => `'${uuid(f.id)}'`).join(',') || 'NULL'}))`);
    for (const id of sql('SELECT id FROM mail_outbox').split('\n').filter(id => id && !initialJobs.has(id)).map(uuid)) { const row = JSON.parse(sql(`SELECT to_jsonb(o) FROM mail_outbox o WHERE id='${id}'`)); const message = JSON.parse(decode(row.payload_ciphertext)); expect(fixtures.some(f => f.email === message.to)).toBe(true); sql(`DELETE FROM mail_outbox WHERE id='${id}'`); }
    for (const path of mailFiles().filter(path => !initialFiles.has(path))) { expect(path).toMatch(/^\/app\/backups\/e2e-mailbox\/[0-9a-f-]+\.enc$/); if (fixtures.some(f => f.email === JSON.parse(decode(docker(['exec', backend, 'cat', path]))).to)) docker(['exec', backend, 'rm', '--', path]); }
    for (const f of fixtures) { sql(`DELETE FROM student_course_registration WHERE profile_id='${uuid(f.id)}'`); sql(`DELETE FROM accounts_userprofile WHERE id='${uuid(f.id)}' AND user_id=${Number(f.userId)}`); sql(`DELETE FROM auth_user WHERE id=${Number(f.userId)} AND NOT EXISTS(SELECT 1 FROM accounts_userprofile WHERE user_id=${Number(f.userId)})`); expect(sql(`SELECT count(*) FROM accounts_userprofile WHERE id='${f.id}'`)).toBe('0'); f.password = ''; }
    if (courseId) sql(`DELETE FROM courses WHERE id='${courseId}'`); key.fill(0);
  }
});
