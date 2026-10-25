import { describe, expect, it } from 'vitest';
import { canTestSmtp, clearMailHistory, mailHistoryKey, parseMailHistoryMarker, smtpDefaults, smtpDirty, visibleMailMessages } from './mailSettings';

describe('SMTP configuration and explicit sending consent', () => {
  it('detects every editable field and candidate password without considering server flags', () => {
    for (const field of ['host', 'port', 'security', 'username', 'from_email', 'from_name', 'contact_recipient', 'timeout_seconds', 'password']) {
      expect(smtpDirty({ ...smtpDefaults, [field]: typeof smtpDefaults[field] === 'number' ? 456 : 'changed' }, smtpDefaults), field).toBe(true);
    }
    expect(smtpDirty({ ...smtpDefaults, pending_verification: true, ready_to_activate: true }, smtpDefaults)).toBe(false);
  });
  it('requires saved complete configuration and explicit consent for the chosen recipient', () => {
    const ready = { loaded: true, busy: false, dirty: false, configured: true, authorized: true, recipient: 'fixture@example.invalid' };
    expect(canTestSmtp(ready)).toBe(true);
    for (const change of [{ loaded: false }, { busy: true }, { dirty: true }, { configured: false }, { authorized: false }, { recipient: ' ' }]) expect(canTestSmtp({ ...ready, ...change })).toBe(false);
  });
});

describe('persistent visual mail history', () => {
  const old = { id: 'old', created_at: '2026-10-25T10:00:00Z' };
  const latest = { id: 'latest', created_at: '2026-10-25T10:00:01Z' };
  it('uses server time plus monotonic elapsed rather than a skewed browser wall clock', () => {
    const marker = clearMailHistory([old, latest], '2026-10-25T10:00:02Z', 500, null);
    expect(marker.through).toBe(Date.parse('2026-10-25T10:00:02.500Z'));
    expect(visibleMailMessages([old, latest], marker)).toEqual([]);
    expect(visibleMailMessages([{ id: 'new', created_at: '2026-10-25T10:00:03Z' }], marker)).toHaveLength(1);
  });
  it('hides known future-dated records and preserves a later cutoff across repeated clears', () => {
    const future = { id: 'future', created_at: '2026-10-25T11:00:00Z' };
    const marker = clearMailHistory([future], old.created_at, 0, null);
    const next = clearMailHistory([old], old.created_at, 0, marker);
    expect(visibleMailMessages([old, future], next)).toEqual([]);
    expect(next.through).toBe(marker.through);
  });
  it('filters delayed old responses and later updates without mutating operational rows', () => {
    const rows = [old, latest];
    const before = JSON.stringify(rows);
    const marker = clearMailHistory(rows, latest.created_at, 0, null);
    expect(visibleMailMessages([...rows].reverse(), marker)).toEqual([]);
    expect(visibleMailMessages(rows.map(row => ({ ...row, state: 'DELIVERED' })), marker)).toEqual([]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('round-trips across sessions and isolates administrator identity', () => {
    const marker = clearMailHistory([old], latest.created_at, 0, null);
    expect(parseMailHistoryMarker(JSON.stringify(marker))).toEqual(marker);
    expect(mailHistoryKey('admin-a')).not.toBe(mailHistoryKey('admin-b'));
    for (const raw of [null, '', 'bad-json', '{}', '{"through":null,"ids":[]}', '{"through":1,"ids":[3]}']) expect(parseMailHistoryMarker(raw)).toBeNull();
  });
});
