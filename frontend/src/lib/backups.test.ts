import { describe, expect, it } from 'vitest';
import { backupDuration, backupReplicas, backupState } from './backups';

describe('backup inventory presentation', () => {
  it('keeps global transfer outcome independent of integrity and local success', () => {
    expect(backupState({ status: 'partial', verified: true, destinations: { local: { status: 'success' }, external_1: { status: 'failed' } } })).toBe('Parcial');
    expect(backupState({ status: 'connection_failed', verified: false })).toBe('Error');
    expect(backupState({ status: 'completed', verified: false })).toBe('Correcta');
  });
  it('retains measured subsecond durations and identifies unavailable old measurements', () => {
    expect(backupDuration(237, 0)).toBe('0,237 s');
    expect(backupDuration(null, 0)).toBe('Sin medición disponible');
    expect(backupDuration(null, 3)).toBe('3 s');
  });
  it('offers successful replicas without consulting whether their slots remain active', () => {
    expect(backupReplicas({ checksum: 'registered', destinations: { local: { status: 'NOT_CONFIGURED' }, external_1: { status: 'success', server_id: 'exact-server', server_name: 'Histórica' }, external_2: { status: 'failed' } } })).toEqual([{ id: 'exact-server', name: 'Histórica' }]);
    expect(backupReplicas({ destinations: { external_1: { status: 'failed' } }, checksum: 'registered' })).toEqual([]);
  });
});
