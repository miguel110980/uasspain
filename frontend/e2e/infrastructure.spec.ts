import { expect, test } from '@playwright/test';
import { adminClient, sql } from '../../scripts/e2e/auth-fixtures.mjs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

test('infrastructure wizard persists progress and never invents external readiness', async ({ page }, testInfo) => {
  expect(testInfo.project.use.baseURL).toBe('https://localhost:8444');
  const admin = await adminClient();
  const before = sql('SELECT to_jsonb(c) FROM infrastructure_config c WHERE id=1');
  const schemaBefore = sql('SELECT MAX(version) FROM _sqlx_migrations WHERE success');
  const namespace = 'TEMP Browser Infrastructure ' + randomUUID();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const q = value => "'" + String(value).replaceAll("'", "''") + "'";
  let temporarilyDisabled = false;
  const configure = enabled => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/e2e/infrastructure-runtime.ps1', '-Enabled', String(enabled)], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await page.goto('/?auth=login');
    await page.getByLabel('Correo electrónico *', { exact: true }).fill('e2e-admin@test.local');
    await page.getByLabel('Contraseña *', { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD || 'E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
    await page.locator('aside:visible nav').getByRole('button', { name: 'Configuración inicial', exact: true }).click();
    const scene = page.locator('[aria-label="Configuración inicial de infraestructura"]');
    await expect(scene.getByRole('navigation', { name: 'Pasos de configuración' }).getByRole('button')).toHaveCount(6);
    const firstStep = scene.getByRole('button', { name: '1. Sistema operativo', exact: true });
    await firstStep.focus(); await page.keyboard.press('Tab');
    await expect(scene.getByRole('button', { name: '2. Infraestructura', exact: true })).toBeFocused();
    await scene.getByRole('button', { name: '1. Sistema operativo', exact: true }).click();
    await scene.getByLabel('Sistema confirmado por el técnico').selectOption('windows');
    await scene.getByRole('button', { name: '2. Infraestructura', exact: true }).click();
    await scene.getByLabel('Nombre del servidor', { exact: true }).fill(namespace);
    await scene.getByLabel('Dirección IP o dominio', { exact: true }).fill('infrastructure-fixture.test');
    await scene.getByLabel('Zona horaria IANA', { exact: true }).fill('Europe/Madrid');
    await scene.getByLabel('Tipo de instalación').selectOption('unknown');
    await scene.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
    await expect(scene.getByRole('status')).toContainText('Configuración guardada');
    expect((await admin.call('/api/infrastructure/')).body.config.server_name).toBe(namespace);
    await page.reload(); await page.locator('aside:visible nav').getByRole('button', { name: 'Configuración inicial', exact: true }).click();
    await expect(scene.getByLabel('Nombre del servidor', { exact: true })).toHaveValue(namespace);
    for (const step of [0, 1, 2, 3, 4, 5]) {
      await scene.getByRole('button', { name: new RegExp(`^${step + 1}\\.`) }).click();
      for (const theme of ['light', 'dark']) for (const width of [320, 375, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light'); }, theme);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await expect.poll(() => scene.evaluate(element => {
          const reference = document.createElement('span'); reference.style.backgroundColor = 'hsl(var(--surface-muted))'; document.body.append(reference);
          const expected = getComputedStyle(reference).backgroundColor; reference.remove();
          return Array.from(element.querySelectorAll('input,select,textarea')).filter(control => control.classList.contains('bg-surface-muted')).every(control => getComputedStyle(control).backgroundColor === expected);
        })).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`infrastructure-${step}-${theme}-${width}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await scene.getByRole('button', { name: 'Guardar y ejecutar comprobaciones', exact: true }).click();
    await expect(scene.getByText('Estado de configuración: Configuración pendiente o servicio no disponible.', { exact: true })).toBeVisible();
    await expect(scene.getByRole('region', { name: 'Evidencias de preparación' })).toContainText('Configuración pendiente o servicio no disponible.');
    await page.locator('aside:visible nav').getByRole('button', { name: 'Conexiones VPN', exact: true }).click();
    const download = page.waitForEvent('download'); await page.getByRole('region', { name: 'Configuración de conexión VPN', exact: true }).getByRole('button', { name: 'Descargar configuración de conexión', exact: true }).click();
    const exported = await download; expect(exported.suggestedFilename()).toBe('UASSpain-infraestructura-publica.json');
    const data = await exported.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of data!) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString()); expect(payload.secrets_included).toBe(false); expect(payload.config.server_name).toBe(namespace);
    expect(Object.keys(payload.config.vpn)).not.toContain('private_key'); expect(errors).toEqual([]);
    expect(sql('SELECT MAX(version) FROM _sqlx_migrations WHERE success')).toBe(schemaBefore);
    configure(false); temporarilyDisabled = true;
    await page.reload(); await page.locator('aside:visible nav').getByRole('button', { name: 'Configuración inicial', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Infraestructura temporalmente deshabilitada' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar configuración', exact: true })).toHaveCount(0);
    expect((await admin.call('/api/infrastructure/')).body.config.server_name).toBe(namespace);
    configure(true); temporarilyDisabled = false;
    await page.reload(); await page.locator('aside:visible nav').getByRole('button', { name: 'Configuración inicial', exact: true }).click();
    await expect(scene.getByRole('button', { name: 'Guardar configuración', exact: true })).toBeVisible();
  } finally {
    if (temporarilyDisabled) configure(true);
    const current = sql("SELECT config->>'server_name' FROM infrastructure_config WHERE id=1");
    if (current === namespace) {
      if (before) sql(`UPDATE infrastructure_config SET (config,revision,updated_at,updated_by)=(SELECT config,revision,updated_at,updated_by FROM jsonb_populate_record(NULL::infrastructure_config,${q(before)}::jsonb)) WHERE id=1 AND config->>'server_name'=${q(namespace)}`);
      else sql(`DELETE FROM infrastructure_config WHERE id=1 AND config->>'server_name'=${q(namespace)}`);
    }
    expect(sql('SELECT to_jsonb(c) FROM infrastructure_config c WHERE id=1')).toBe(before);
    expect((await admin.call('/api/infrastructure/')).status).toBe(200);
  }
});
