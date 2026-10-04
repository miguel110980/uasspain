import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from './errors';

describe('authentication service errors', () => {
  const credentials = 'Credenciales incorrectas. Compruebe su email y contraseña.';
  it.each([500, 502, 503, 504])('does not report incorrect credentials for an HTML %i gateway response', status => {
    expect(extractErrorMessage({ response: { status, data: '<html>Gateway error</html>' } }, credentials))
      .toBe('Servicio temporalmente no disponible. Inténtalo de nuevo en unos instantes.');
  });
  it('preserves a real authentication denial', () => {
    expect(extractErrorMessage({ response: { status: 401, data: { detail: 'Credenciales no válidas.' } } }, credentials))
      .toBe('Credenciales no válidas.');
  });
  it('preserves a structured service response', () => {
    expect(extractErrorMessage({ response: { status: 503, data: { detail: 'Servicio temporalmente no disponible.' } } }, credentials))
      .toBe('Servicio temporalmente no disponible.');
  });
  it.each(['ECONNABORTED', 'ETIMEDOUT'])('distinguishes %s from a rejected password', code => {
    expect(extractErrorMessage({ code }, credentials)).toContain('tardando en responder');
  });
  it('distinguishes a network outage from a rejected password', () => {
    expect(extractErrorMessage({ code: 'ERR_NETWORK' }, credentials)).toContain('conectar con el servidor');
  });
});
