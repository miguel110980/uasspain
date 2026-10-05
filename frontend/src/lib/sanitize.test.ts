import { expect, test } from 'vitest';
import { sanitizeInput } from './sanitize';

test('passwords preserve symbols, case and surrounding spaces', () => {
  const credential = ' AbC<>{} & 9! '; // pragma: allowlist secret - synthetic fixture
  expect(sanitizeInput(credential, 'password')).toBe(credential);
});

test('email input is trimmed and case insensitive', () => {
  expect(sanitizeInput('  Person@EXAMPLE.COM ', 'email')).toBe('person@example.com');
});

test('passwords preserve Unicode and are never silently truncated', () => {
  const credential = ' 🔐é漢字 ' + 'x'.repeat(150);
  expect(sanitizeInput(credential, 'password')).toBe(credential);
});

test('email normalization preserves valid local-part symbols', () => {
  expect(sanitizeInput(" O'Hara+Tag@EXAMPLE.ES ", 'email')).toBe("o'hara+tag@example.es");
  expect(sanitizeInput('a!#$%&*+-/=?^_`{|}~@EXAMPLE.ES', 'email')).toBe('a!#$%&*+-/=?^_`{|}~@example.es');
});

test('malformed email is preserved for rejection instead of changing identity', () => {
  expect(sanitizeInput('a<b>@EXAMPLE.ES', 'email')).toBe('a<b>@example.es');
  expect(sanitizeInput('x'.repeat(255) + '@example.es', 'email')).toHaveLength(266);
});
