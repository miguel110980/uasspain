// Real Firefox assets/routes regression using its native WebDriver BiDi endpoint.
// Uses an isolated temporary profile; never opens the user's browser profile.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin = new URL(process.env.FRONTEND_TEST_ORIGIN || 'https://localhost').origin;
const binary = process.env.FIREFOX_BINARY || (process.platform === 'win32'
  ? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' : 'firefox');
const temporaryRoot = path.resolve(tmpdir());
const profile = await mkdtemp(path.join(temporaryRoot, 'uasspain-firefox-assets-'));
const report = { browser: 'Firefox', origin, routes: [], network: [], failures: [], errors: [] };
const child = spawn(binary, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0'], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let socket;
let command;
const pending = new Map();
try {
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Firefox BiDi startup timeout')), 20000);
    const listen = chunk => {
      output += chunk;
      const match = output.match(/WebDriver BiDi listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    child.stdout.on('data', listen);
    child.stderr.on('data', listen);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Firefox exited during startup: ${code}`)); });
  });
  socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Firefox BiDi connection timeout')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Firefox BiDi connection failed')); }, { once: true });
  });
  let sequence = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer); pending.delete(message.id);
      message.type === 'error'
        ? reject(new Error(`${message.error}: ${message.message}`)) : resolve(message.result);
    } else if (message.method === 'network.responseCompleted') {
      const { request, response } = message.params;
      if (new URL(request.url).origin === origin && (new URL(request.url).pathname.startsWith('/assets/') || response.mimeType?.includes('html'))) {
        report.network.push({ url: request.url, status: response.status, mime: response.mimeType, cache: response.fromCache });
      }
    } else if (message.method === 'network.fetchError') {
      const url = new URL(message.params.request.url);
      if (url.origin === origin && (url.pathname.startsWith('/assets/') || message.params.navigation)) {
        report.failures.push({ url: message.params.request.url, error: message.params.errorText });
      }
    } else if (message.method === 'log.entryAdded' && message.params.level === 'error') {
      report.errors.push({ type: message.params.type, text: message.params.text });
    }
  });
  command = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const session = await command('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  report.version = session.capabilities.browserVersion;
  await command('session.subscribe', { events: ['network.responseCompleted', 'network.fetchError', 'log.entryAdded'] });
  const { context } = await command('browsingContext.create', { type: 'tab' });
  const evaluate = async expression => {
    const result = await command('script.evaluate', { expression, target: { context }, awaitPromise: true });
    if (result.type === 'exception') throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const capture = async (label, route, heading) => {
    let state;
    for (let step = 0; step < 100; step++) {
      state = JSON.parse(await evaluate(`JSON.stringify({url:location.href, headings:[...document.querySelectorAll('h1')].map(x=>x.textContent), hydrated:Object.keys(document.getElementById('root')||{}).some(k=>k.startsWith('__reactContainer')), boundary:document.body.textContent.includes('No se pudo cargar la aplicación')})`));
      if (state.boundary || (state.hydrated && state.headings.some(text => text.includes(heading)))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    report.routes.push({ label, ...state });
    assert.equal(new URL(state.url).pathname, route, label);
    assert.equal(state.boundary, false, label);
    assert.equal(state.hydrated, true, label);
    assert.ok(state.headings.some(text => text.includes(heading)), `${label}: expected heading ${heading}`);
  };
  for (const route of ['/tecnologia', '/tecnolog%C3%ADa']) {
    await command('browsingContext.navigate', { context, url: origin + route, wait: 'complete' });
    await capture(`direct ${route}`, '/tecnologia', 'Stack Tecnológico');
    await command('browsingContext.reload', { context, wait: 'complete' });
    await capture(`reload ${route}`, '/tecnologia', 'Stack Tecnológico');
  }
  await command('browsingContext.navigate', { context, url: origin + '/', wait: 'complete' });
  await capture('home', '/', 'SOLUCIONES AÉREAS');
  await evaluate(`document.querySelector('a[href="/tecnologia"]').click()`);
  await capture('SPA technology', '/tecnologia', 'Stack Tecnológico');
  report.workers = JSON.parse(await evaluate(`(async()=>JSON.stringify((await navigator.serviceWorker.getRegistrations()).map(r=>r.scope)))()`));
  assert.deepEqual(report.workers, [], 'Unexpected service worker');
  assert.deepEqual(report.failures, [], 'Failed assets or page navigation');
  assert.deepEqual(report.errors, [], 'Browser errors');
  const assets = report.network.filter(entry => new URL(entry.url).pathname.startsWith('/assets/'));
  assert.ok(assets.some(entry => /\/Tecnologia-.*\.js$/.test(new URL(entry.url).pathname)), 'Technology chunk must be requested');
  for (const asset of assets) {
    assert.equal(asset.status, 200, asset.url);
    assert.match(asset.mime, asset.url.endsWith('.css') ? /text\/css/ : /javascript/, asset.url);
  }
  console.log(JSON.stringify({ browser: `Firefox ${report.version}`, routes: report.routes.length, assetRequests: assets.length, passed: true }));
} catch (error) {
  report.failure = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (command && socket?.readyState === WebSocket.OPEN) {
    await command('browser.close', {}).catch(() => {});
  }
  for (const { timer } of pending.values()) clearTimeout(timer);
  socket?.close();
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  // Verify the absolute target before removing this test's temporary profile.
  assert.equal(path.dirname(path.resolve(profile)), temporaryRoot);
  assert.ok(path.basename(profile).startsWith('uasspain-firefox-assets-'));
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  if (process.env.FRONTEND_TEST_REPORT) await writeFile(process.env.FRONTEND_TEST_REPORT, JSON.stringify(report, null, 2));
}
