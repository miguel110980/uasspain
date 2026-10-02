import { expect, test } from 'vitest';
import { sanitizeInput } from './sanitize';

test('passwords preserve symbols, case and surrounding spaces', () => {
  const credential = ' AbC<>{} & 9! '; // pragma: allowlist secret - synthetic fixture
  expect(sanitizeInput(credential, 'password')).toBe(credential);
});

test('email input is trimmed and case insensitive', () => {
  expect(sanitizeInput('  Person@EXAMPLE.COM ', 'email')).toBe('person@example.com');
});
