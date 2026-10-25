export const mailApiDefaults = { provider: 'postmark', from_email: 'no-reply@uasspain.com', from_name: 'UASSpain', contact_recipient: 'info@uasspain.com', sender_panel_confirmed: false };
export type MailApiConfig = typeof mailApiDefaults;
export function mergeMailApiConfig(saved?: Partial<MailApiConfig>): MailApiConfig {
  return { ...mailApiDefaults, ...saved };
}
export function mailApiDirty(config: MailApiConfig, saved: MailApiConfig, key: string): boolean {
  return key.length > 0 || (Object.keys(mailApiDefaults) as (keyof MailApiConfig)[]).some(field => config[field] !== saved[field]);
}
export function canTestMailApi(input: { loaded: boolean; busy: boolean; selectedApi: boolean; dirty: boolean; keyConfigured: boolean; savedConfirmed: boolean; authorized: boolean; recipient: string }): boolean {
  return input.loaded && !input.busy && input.selectedApi && !input.dirty && input.keyConfigured && input.savedConfirmed && input.authorized && !!input.recipient.trim();
}
