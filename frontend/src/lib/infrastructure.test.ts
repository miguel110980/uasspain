import { describe, expect, it } from 'vitest';
import { availableStorage, backupDisplayName, infrastructureMessage, infrastructureState, mergeInfrastructureDraft, vpnDraftFromObservation } from './infrastructure';

const empty = { interface: '', address: '', port: 0, public_key: '', peers: [] };
const known = { agent_state: 'VERIFIED', state: 'disconnected', interface: 'uas-backup1', interfaces: ['uas-backup1'], public_key: 'public-only',
  listen_port: 51820, ip_address: '10.203.77.2/30', peers: [{ public_key: 'peer-public', endpoint: 'backup.test:51820', allowed_ips: ['10.203.77.1/32'], keepalive: 25, private_key: 'must-not-copy' }] };

describe('infrastructure presentation and configuration ownership', () => {
  it('keeps unknown, unconfigured, disconnected and verified states distinct', () => {
    expect(infrastructureState('NOT_CONFIGURED')).not.toBe(infrastructureState('DISCONNECTED'));
    expect(infrastructureState('BLOCKED')).not.toBe(infrastructureState('VERIFIED'));
    expect(infrastructureState('unrecognised')).toContain('desconocido');
  });
  it('translates diagnostic codes without hiding the absence of evidence', () => {
    expect(infrastructureMessage('STALE_OR_INVALID_AGENT_MESSAGE')).toContain('datos válidos');
    expect(infrastructureMessage('INVALID_AGENT_SIGNATURE')).toContain('origen');
    expect(infrastructureMessage('UNKNOWN_INTERNAL_CODE')).not.toContain('UNKNOWN_INTERNAL_CODE');
    expect(infrastructureMessage('Falta permiso de almacenamiento.')).toBe('Falta permiso de almacenamiento.');
  });
  it('does not suggest data from an unavailable or invalid supervisor', () => {
    expect(vpnDraftFromObservation(empty, { ...known, agent_state: 'BLOCKED' })).toEqual(empty);
    expect(vpnDraftFromObservation(empty, null)).toEqual(empty);
  });
  it('fills empty fields from public observations without claiming the tunnel is connected', () => {
    const result = vpnDraftFromObservation(empty, known);
    expect(result.interface).toBe('uas-backup1'); expect(result.port).toBe(51820);
    expect(result.peers[0]).not.toHaveProperty('private_key');
    expect(result).not.toHaveProperty('state'); expect(empty.interface).toBe('');
  });
  it('never replaces saved values and does not choose between multiple adapters', () => {
    const saved = { ...empty, interface: 'configured', port: 60000, public_key: 'saved', address: '10.9.0.2/30' };
    expect(vpnDraftFromObservation(saved, known)).toEqual(saved);
    expect(vpnDraftFromObservation(empty, { agent_state: 'VERIFIED', interfaces: ['one', 'two'] })).toEqual(empty);
  });
  it('does not present a mismatching configured address as a detected address', () => {
    expect(vpnDraftFromObservation(empty, { ...known, error: 'CONFIGURATION_RUNTIME_MISMATCH' }).address).toBe('');
  });
  it('preserves changes made by the other screen when saving a VPN draft', () => {
    const base = { server_name: 'before', vpn: empty }, draft = { ...base, vpn: { ...empty, interface: 'one' } };
    expect(mergeInfrastructureDraft(base, draft, { ...base, server_name: 'new server' }, 'vpn')).toEqual({ server_name: 'new server', vpn: draft.vpn });
  });
  it('keeps a new VPN configuration when saving host metadata', () => {
    const base = { server_name: 'before', vpn: empty }, fresh = { ...base, vpn: { ...empty, interface: 'new adapter' } };
    expect(mergeInfrastructureDraft(base, { ...base, server_name: 'new server' }, fresh, 'setup')).toEqual({ ...fresh, server_name: 'new server' });
  });
  it('rejects conflicting edits instead of overwriting either configuration', () => {
    const base = { vpn: empty };
    expect(() => mergeInfrastructureDraft(base, { vpn: { ...empty, interface: 'ours' } }, { vpn: { ...empty, interface: 'theirs' } }, 'vpn')).toThrow('otra ventana');
  });
  it('renames legacy labels in presentation while preserving custom names and measured zero free space', () => {
    expect(backupDisplayName('Servidor externo 1', 'external_1')).toBe('Servidor externo de copias 1');
    expect(backupDisplayName('Archivo corporativo', 'external_1')).toBe('Archivo corporativo');
    expect(availableStorage({ disk_total_bytes: 100, disk_used_bytes: 100 })).toBe('0 bytes');
    expect(availableStorage({ disk_total_bytes: 100 })).toBe('Pendiente de comprobación');
    expect(availableStorage({ disk_total_bytes: 100, disk_used_bytes: 120 })).toBe('Pendiente de comprobación');
  });
});
