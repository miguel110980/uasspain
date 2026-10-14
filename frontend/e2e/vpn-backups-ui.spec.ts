import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminClient, apiClient, mailFiles, readMail, sql } from '../../scripts/e2e/auth-fixtures.mjs';

const login = async page => {
  await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *', { exact: true }).fill('e2e-admin@test.local');
  await page.getByLabel('Contraseña *', { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD || 'E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
};
const sidebar = page => page.locator('aside:visible nav');
const setup = page => page.locator('[aria-label="Configuración inicial de infraestructura"]');
const q = value => "'" + String(value).replaceAll("'", "''") + "'";

test('three sections keep one editor per function, preserve settings and fit both themes', async ({ page }, info) => {
  expect(info.project.use.baseURL).toBe('https://localhost:8444');
  const admin = await adminClient();
  const before = sql('SELECT to_jsonb(c) FROM infrastructure_config c WHERE id=1');
  const serversBefore = sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM backups_backupserver s");
  const namespace = `TEMP VPN UI ${randomUUID()}`;
  const errors: string[] = [], forbiddenRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() !== 'GET' && /\/api\/backups\/(create|restore|restore-test)\//.test(request.url())) forbiddenRequests.push(request.url());
  });
  try {
    await login(page);
    await sidebar(page).getByRole('button', { name: 'Configuración inicial', exact: true }).click();
    await setup(page).getByRole('button', { name: '2. Infraestructura', exact: true }).click();
    await setup(page).getByLabel('Nombre del servidor', { exact: true }).fill(namespace);
    await setup(page).getByRole('button', { name: 'Guardar configuración', exact: true }).click();
    await expect(setup(page).getByRole('status')).toContainText('Configuración guardada');
    expect((await admin.call('/api/infrastructure/')).body.config.server_name).toBe(namespace);
    await setup(page).getByRole('button', { name: '3. Conexiones VPN', exact: true }).click();
    await expect(setup(page).locator('input,select,textarea')).toHaveCount(0);
    await setup(page).getByRole('link', { name: 'Abrir Conexiones VPN', exact: true }).click();
    const vpnForm = page.getByRole('region', { name: 'Configuración de conexión VPN', exact: true });
    await expect(vpnForm.getByLabel('Adaptador de red de WireGuard')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Conexiones VPN', exact: true }).getByRole('button', { name: 'Configurar', exact: true })).toHaveCount(0);
    await vpnForm.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
    await expect(vpnForm.getByRole('status').filter({ hasText: 'Configuración guardada' })).toBeVisible();
    expect((await admin.call('/api/infrastructure/')).body.config.server_name).toBe(namespace);
    await sidebar(page).getByRole('button', { name: 'Configuración inicial', exact: true }).click();
    await setup(page).getByRole('button', { name: '4. Copias de seguridad', exact: true }).click();
    await expect(setup(page).getByRole('button', { name: 'Configurar', exact: true })).toHaveCount(0);
    await expect(setup(page).getByRole('checkbox')).toHaveCount(0);
    await setup(page).getByRole('link', { name: 'Abrir Copias de seguridad', exact: true }).click();
    const targets = page.getByRole('region', { name: 'Servidores de copias de seguridad', exact: true });
    await expect(targets.getByRole('article')).toHaveCount(3);
    const local = targets.getByRole('article', { name: 'Copias de seguridad locales', exact: true });
    await local.getByRole('button', { name: 'Configurar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Configurar Copias de seguridad locales', exact: true });
    await expect(dialog.getByLabel('Nombre del destino')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    await expect(local.getByRole('button', { name: 'Configurar', exact: true })).toBeFocused();

    for (const section of ['vpn', 'backups', 'infraestructura-setup']) {
      await page.goto(`/admin?section=${section}`);
      if (section === 'infraestructura-setup') await setup(page).getByRole('button', { name: '4. Copias de seguridad', exact: true }).click();
      await expect(page.getByRole('heading', { level: 2, name: section === 'vpn' ? 'Conexión segura WireGuard' : section === 'backups' ? 'Copias de seguridad' : 'Configuración inicial', exact: true })).toBeVisible();
      for (const theme of ['light', 'dark']) for (const width of [320, 390, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light'); localStorage.setItem('uasspain-theme', value); }, theme);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await expect.poll(() => page.locator('header h1').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await page.screenshot({ path: info.outputPath(`${section}-${theme}-${width}.png`), fullPage: true });
      }
    }
    expect(errors).toEqual([]); expect(forbiddenRequests).toEqual([]);
    expect(sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM backups_backupserver s")).toBe(serversBefore);
  } finally {
    if (sql("SELECT config->>'server_name' FROM infrastructure_config WHERE id=1") === namespace) {
      if (before) sql(`UPDATE infrastructure_config SET (config,revision,updated_at,updated_by)=(SELECT config,revision,updated_at,updated_by FROM jsonb_populate_record(NULL::infrastructure_config,${q(before)}::jsonb)) WHERE id=1 AND config->>'server_name'=${q(namespace)}`);
      else sql(`DELETE FROM infrastructure_config WHERE id=1 AND config->>'server_name'=${q(namespace)}`);
    }
    expect(sql('SELECT to_jsonb(c) FROM infrastructure_config c WHERE id=1')).toBe(before);
    await admin.call('/api/auth/logout/', 'POST', {});
  }
});

test('observations fill only missing fields and unavailable supervision never appears connected', async ({ page }, info) => {
  expect(info.project.use.baseURL).toBe('https://localhost:8444');
  await login(page);
  const config = { host_platform: '', server_name: '', server_address: '', installation: '', timezone: '', step: 0,
    vpn: { interface: '', address: '', port: 0, public_key: '', peers: [] }, paths: [], reserved_networks: [] };
  let observation: any = { state: 'disconnected', preparation_state: 'NOT_CONFIGURED', agent_state: 'VERIFIED', interface: null, interfaces: ['uas-test'], peers: [] };
  await page.route(/\/api\/infrastructure\/$/, route => route.fulfill({ json: { enabled: true, config, revision: 0, agent_state: 'VERIFIED', evidence: [] } }));
  await page.route(/\/api\/vpn\/status\/$/, route => route.fulfill({ json: observation }));
  await page.goto('/admin?section=vpn');
  const scene = page.getByRole('region', { name: 'Conexiones VPN', exact: true });
  const form = page.getByRole('region', { name: 'Configuración de conexión VPN', exact: true });
  await expect(form.getByLabel('Adaptador de red de WireGuard')).toHaveValue('uas-test');
  await expect(scene.getByRole('paragraph').filter({ hasText: /^Pendiente de configuración$/ })).toBeVisible();
  await expect(form.getByLabel('Clave pública de este equipo')).toHaveValue('');
  observation = { state: 'connected', agent_state: 'BLOCKED', preparation_state: 'BLOCKED', error: 'STALE_OR_INVALID_AGENT_MESSAGE', peers: [] };
  await page.reload();
  await expect(scene.getByText('Estado desconocido', { exact: true })).toBeVisible();
  await expect(scene.getByText('Conectada', { exact: true })).toHaveCount(0);
  await expect(form.getByLabel('Adaptador de red de WireGuard')).toHaveValue('');
  await expect(scene.getByText('No se han recibido datos válidos del servicio de supervisión VPN.', { exact: true }).first()).toBeVisible();
  expect(await scene.innerText()).not.toContain('STALE_OR_INVALID_AGENT_MESSAGE');
  observation = { state: 'disconnected', agent_state: 'VERIFIED', preparation_state: 'DISCONNECTED', interface: 'uas-test', interfaces: ['uas-test'],
    public_key: 'synthetic-public-observation', listen_port: 51820, ip_address: '10.203.77.2/30', peers_count: 0, active_peers: 0, peers: [] };
  await page.reload();
  await expect(form.getByLabel('Puerto de conexión WireGuard (UDP)')).toHaveValue('51820');
  await expect(form.getByLabel('Clave pública de este equipo')).toHaveValue('synthetic-public-observation');
  await expect(form.getByLabel('Dirección IP interna de la VPN')).toHaveValue('10.203.77.2/30');
  await expect(scene.getByText('Desconectada', { exact: true }).first()).toBeVisible();
  config.vpn = { ...config.vpn, interface: 'uas-saved', port: 60000, public_key: 'saved-public', address: '10.9.0.2/30' };
  await page.reload();
  await expect(form.getByLabel('Adaptador de red de WireGuard')).toHaveValue('uas-saved');
  await expect(form.getByLabel('Puerto de conexión WireGuard (UDP)')).toHaveValue('60000');
  await expect(form.getByLabel('Clave pública de este equipo')).toHaveValue('saved-public');
});

test('administrative read endpoints retain real backend permissions and reject ordinary roles', async ({}, info) => {
  expect(info.project.use.baseURL).toBe('https://localhost:8444');
  const paths = ['/api/infrastructure/', '/api/vpn/status/', '/api/backups/servers/', '/api/backups/status/'];
  const admin = await adminClient();
  for (const path of paths) expect((await admin.call(path)).status).toBe(200);
  const configuration = sql('SELECT to_jsonb(c) FROM infrastructure_config c WHERE id=1');
  const servers = sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM backups_backupserver s");
  for (const [email, password] of [['instructor.e2e@test.local', 'E2eInstr_2026!'], ['alumno.e2e@test.local', 'E2ePass_2026!']]) { // pragma: allowlist secret - isolated fixtures
    const client = apiClient(), beforeMail = new Set(mailFiles());
    let response = await client.call('/api/auth/login/', 'POST', { email, password });
    if (response.status === 202) {
      const message = await readMail(email, beforeMail);
      response = await client.call('/api/auth/login/', 'POST', { email, password, code: message.body.match(/\b\d{6}\b/)?.[0] });
    }
    expect(response.status).toBe(200);
    for (const path of paths) expect((await client.call(path)).status).toBe(403);
    expect((await client.call('/api/infrastructure/', 'PUT', { expected_revision: 0, config: {} })).status).toBe(403);
    await client.call('/api/auth/logout/', 'POST', {});
  }
  expect(sql('SELECT to_jsonb(c) FROM infrastructure_config c WHERE id=1')).toBe(configuration);
  expect(sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM backups_backupserver s")).toBe(servers);
  await admin.call('/api/auth/logout/', 'POST', {});
});
