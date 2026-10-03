import { describe, expect, it } from 'vitest';
import { buildMonitorServices, websocketServiceStatus } from './systemStatus';

describe('admin status reflects the backend contract', () => {
  it('does not invent an operational memory backend when fields are absent', () => {
    expect(websocketServiceStatus({}).status).toBe('warn');
    expect(websocketServiceStatus({}).value).toBe('No disponible');
  });
  it('keeps optional integrations separate from API availability and overlapping role totals', () => {
    const services = buildMonitorServices({ platform: { database_connected: true }, backend: { status: 'ok' },
      redis: { configured: true, connected: true, backend: 'redis' }, websockets: { operational: true, backend: 'redis' },
      smtp: { configured: false }, google_oauth: { configured: false }, users: { unique_active: 3, admin: 1, instructor: 2, alumno: 2 } });
    expect(services.find((s) => s.name === 'API REST')?.value).toBe('Online');
    expect(services.find((s) => s.name === 'Usuarios activos')?.value).toBe('3');
    expect(services.find((s) => s.name === 'Redis / WebSockets')?.status).toBe('ok');
  });
  it('reports a failed required dependency', () => {
    expect(buildMonitorServices({ platform: { database_connected: true }, backend: { status: 'error' } })[0].status).toBe('err');
  });
});
