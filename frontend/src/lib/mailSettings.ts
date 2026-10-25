export const smtpDefaults = { enabled: false, provider: '', host: '', port: 587, security: 'STARTTLS', username: '', password: '', password_configured: false, from_email: '', from_name: '', contact_recipient: '', timeout_seconds: 30, configured: false, active_configured: false, pending_verification: false, ready_to_activate: false };
export type SmtpSettings = typeof smtpDefaults;
const editableFields = ['host', 'port', 'security', 'username', 'from_email', 'from_name', 'contact_recipient', 'timeout_seconds'] as const;
export function smtpDirty(config: SmtpSettings, saved: SmtpSettings): boolean {
  return config.password.length > 0 || editableFields.some(field => config[field] !== saved[field]);
}
export function canTestSmtp(input: { loaded: boolean; busy: boolean; dirty: boolean; configured: boolean; authorized: boolean; recipient: string }): boolean {
  return input.loaded && !input.busy && !input.dirty && input.configured && input.authorized && !!input.recipient.trim();
}

export type MailHistoryMarker = { through: number; ids: string[] };
type DatedMessage = { id: string; created_at: string };
export function mailHistoryKey(profileId: string): string {
  return `uasspain.mail-history.v1.${profileId}`;
}
export function parseMailHistoryMarker(raw: string | null): MailHistoryMarker | null {
  try {
    const value = JSON.parse(raw || 'null');
    return value && Number.isFinite(value.through) && Array.isArray(value.ids) && value.ids.every(id => typeof id === 'string')
      ? { through: value.through, ids: value.ids } : null;
  } catch { return null; }
}
export function clearMailHistory(messages: DatedMessage[], observedAt: string | undefined, elapsed: number, previous: MailHistoryMarker | null): MailHistoryMarker {
  const observed = Date.parse(observedAt || '');
  const through = Math.max(previous?.through || 0, Number.isFinite(observed) ? observed + Math.max(0, elapsed) : Date.now(), ...messages.map(message => Date.parse(message.created_at)).filter(Number.isFinite));
  return { through, ids: [...new Set([...(previous?.ids || []), ...messages.filter(message => !Number.isFinite(Date.parse(message.created_at))).map(message => message.id)])] };
}
export function visibleMailMessages<T extends DatedMessage>(messages: T[], marker: MailHistoryMarker | null): T[] {
  return marker ? messages.filter(message => !marker.ids.includes(message.id) && Date.parse(message.created_at) > marker.through) : messages;
}
