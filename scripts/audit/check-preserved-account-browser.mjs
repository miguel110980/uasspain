import { chromium } from '../../frontend/node_modules/@playwright/test/index.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const origin = 'https://uasspain-prueba.duckdns.org';
const output = 'docs/audits/evidence/2026-11-17-preserved-account-browser.json';
const report = { observed_at: new Date().toISOString(), scope: 'Actual original Docker web login form and role dashboard, public-domain TLS over server LAN; no independent Internet assertion', tls_bypass: false, credential_changes: 0, accounts: [] };
let accounts;
try { accounts = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', '.run/backend-audit-20261023/load-authorized-accounts.ps1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })); }
catch { throw new Error('Protected account loader failed; sensitive output withheld'); }
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--host-resolver-rules=MAP uasspain-prueba.duckdns.org 192.168.1.34'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let index = 0;
  for (const account of accounts) {
    const result = { email: account.email, expected_role: account.role };
    report.accounts.push(result);
    const page = await context.newPage();
    try {
      await page.goto(origin + '/?auth=login', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.locator('#login-email').fill(account.email);
      await page.locator('#login-password').fill(account.password);
      const pending = page.waitForResponse(r => r.url().endsWith('/api/auth/login/') && r.request().method() === 'POST', { timeout: 20000 });
      await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
      const login = await pending;
      result.login_http = login.status();
      if (await page.locator('#login-password').count()) await page.locator('#login-password').fill('', { timeout: 1000 }).catch(() => {});
      if (login.status() !== 200) { result.status = 'FAIL_FORM_LOGIN'; continue; }
      await page.waitForURL(/\/(instructor|alumno|elegir-panel)(?:\?.*)?$/, { timeout: 20000 });
      if (new URL(page.url()).pathname === '/elegir-panel') await page.getByRole('button', { name: account.role === 'instructor' ? /^Instructor/ : /^Alumno/ }).click();
      await page.waitForURL(new RegExp('/' + account.role + '(?:\\?.*)?$'), { timeout: 15000 });
      await page.locator('aside').waitFor({ state: 'visible', timeout: 20000 });
      await page.waitForFunction(() => document.body.innerText.includes('Dashboard') && document.body.innerText.length > 150, { timeout: 20000 });
      const identity = await page.evaluate(async () => {
        const response = await fetch('/api/auth/me/', { headers: { 'X-UASSpain-Window-Id': sessionStorage.getItem('uasspain.window_session_id') } });
        const body = await response.json();
        return { http: response.status, email: body.email, role: body.session_role ?? body.role };
      });
      result.identity_matches = identity.http === 200 && identity.email === account.email && identity.role === account.role;
      result.dashboard_path = new URL(page.url()).pathname;
      result.dashboard_content_visible = (await page.locator('body').innerText()).length > 150;
      result.status = result.identity_matches && result.dashboard_content_visible ? 'PASS' : 'FAIL_IDENTITY_OR_DASHBOARD';
      if (index === 0 || index === 2) {
        await page.screenshot({ path: `docs/audits/evidence/2026-11-17-login-${account.role}.png` });
        result.dashboard_screenshot = `2026-11-17-login-${account.role}.png`;
      }
      result.own_test_logout_http = await page.evaluate(async () => (await fetch('/api/auth/logout/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UASSpain-Window-Id': sessionStorage.getItem('uasspain.window_session_id') }, body: '{}' })).status);
    } catch (error) { result.status = 'BLOCKED_BROWSER'; result.error_type = error?.name ?? 'Error'; }
    finally { await page.close(); }
    index++;
  }
  await context.close();
} catch (error) { report.error_type = error?.name ?? 'Error'; }
finally {
  accounts = undefined;
  await browser?.close();
  report.status = report.accounts.length === 7 && report.accounts.every(a => a.status === 'PASS') ? 'PASS_SEVEN_REAL_FORM_LOGINS' : 'FAIL_OR_BLOCKED';
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
