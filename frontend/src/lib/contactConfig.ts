import defaults from '../../../backend-rust/src/contact-defaults.json';

// The public address and backend destination share the fixed corporate inbox.
export const corporateContactEmail = defaults.email;
if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(corporateContactEmail)) {
  throw new Error('Invalid public corporate contact address');
}

export function contactField(value: string, field: string) {
  if (field === 'mensaje') return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, 2000);
  return value;
}
