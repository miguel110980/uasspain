import defaults from '../../../backend-rust/src/contact-defaults.json';

// Compose uses CONTACT_RECIPIENT_EMAIL for both this public build input and
// the backend destination. Credentials never enter the frontend build.
export const corporateContactEmail = import.meta.env.VITE_CONTACT_EMAIL?.trim() || defaults.email;
if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(corporateContactEmail)) {
  throw new Error('Invalid public corporate contact address');
}

export function contactField(value: string, field: string) {
  if (field === 'mensaje') return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, 2000);
  return value;
}
