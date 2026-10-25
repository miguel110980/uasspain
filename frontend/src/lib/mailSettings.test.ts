import { describe, expect, it } from 'vitest';
import { canTestMailApi, mailApiDefaults, mailApiDirty, mergeMailApiConfig } from './mailSettings';
describe('saved mail configuration and authorized tests', () => {
  it('fills only missing fields and preserves saved values, including false confirmation', () => {
    expect(mergeMailApiConfig({ from_name: 'Saved identity', contact_recipient: 'saved@example.invalid', sender_panel_confirmed: false })).toEqual({ ...mailApiDefaults, from_name: 'Saved identity', contact_recipient: 'saved@example.invalid' });
    expect(mergeMailApiConfig()).toEqual(mailApiDefaults);
  });
  it('detects each unsaved configuration field and a new candidate secret', () => {
    for (const field of Object.keys(mailApiDefaults)) {
      const changed = { ...mailApiDefaults, [field]: field === 'sender_panel_confirmed' ? true : 'changed' };
      expect(mailApiDirty(changed, mailApiDefaults, '')).toBe(true);
    }
    expect(mailApiDirty(mailApiDefaults, mailApiDefaults, 'candidate')).toBe(true);
    expect(mailApiDirty(mailApiDefaults, { ...mailApiDefaults }, '')).toBe(false);
  });
  it('requires persisted confirmation, saved credentials and explicit recipient authorization', () => {
    const ready = { loaded: true, busy: false, selectedApi: true, dirty: false, keyConfigured: true, savedConfirmed: true, authorized: true, recipient: 'fixture@example.invalid' };
    expect(canTestMailApi(ready)).toBe(true);
    for (const change of [{loaded:false}, {busy:true}, {selectedApi:false}, {dirty:true}, {keyConfigured:false}, {savedConfirmed:false}, {authorized:false}, {recipient:' '}]) expect(canTestMailApi({...ready,...change})).toBe(false);
  });
});
