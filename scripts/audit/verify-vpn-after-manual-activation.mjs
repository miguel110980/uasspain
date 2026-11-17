import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Read-only runtime inspection. Never export configuration keys or credentials.
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const hostRaw = readFileSync('.run/infrastructure-agent/status.json');
const mountedRaw = docker('exec', 'uasspain-backend', 'cat', '/run/infrastructure-agent/status.json');
const envelope = JSON.parse(mountedRaw);
const payload = Buffer.from(envelope.payload, 'base64');
const key = readFileSync('.secrets/backup-sftp/infrastructure_agent.key');
const expected = createHmac('sha256', key).update(payload).digest();
const signature = Buffer.from(envelope.signature, 'base64');
const signatureValid = expected.length === signature.length && timingSafeEqual(expected, signature);
const observed = JSON.parse(payload);
const config = JSON.parse(docker('exec', 'uasspain-postgres', 'psql', '-X', '-U', 'uasspain', '-d', 'uasspain', '-qtA', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT config FROM infrastructure_config WHERE id=1')).vpn;
const iface = observed.interfaces.find(i => i.name === config.interface);
const age = Math.floor((Date.now() - Date.parse(observed.observed_at)) / 1000);
const sameRoutes = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const peers = (iface?.peers ?? []).map(p => {
  const saved = config.peers.find(c => c.public_key === p.public_key);
  return {
    configured_identity_matches: Boolean(saved),
    allowed_routes_match: Boolean(saved && sameRoutes(saved.allowed_ips, p.allowed_ips)),
    configured_endpoint_present: Boolean(saved?.endpoint),
    runtime_endpoint_present: Boolean(p.endpoint),
    latest_handshake: p.latest_handshake,
    received_bytes: p.rx_bytes ?? p.transfer_rx ?? null,
    transmitted_bytes: p.tx_bytes ?? p.transfer_tx ?? null,
    active: p.latest_handshake > 0 && Date.now() / 1000 - p.latest_handshake <= 180 && Date.now() / 1000 >= p.latest_handshake && Boolean(saved && sameRoutes(saved.allowed_ips, p.allowed_ips)),
  };
});
const mountedKeyHash = docker('exec', 'uasspain-backend', 'sha256sum', '/run/backup-secrets/infrastructure_agent.key').split(/\s+/)[0];
const checks = {
  host_and_backend_snapshot_match: createHash('sha256').update(hostRaw).digest('hex') === createHash('sha256').update(mountedRaw).digest('hex'),
  backend_key_matches_collector_key: mountedKeyHash === createHash('sha256').update(key).digest('hex'),
  signature_valid: signatureValid,
  observation_fresh: age >= -15 && age <= 120,
  interface_present: Boolean(iface),
  public_identity_matches: iface?.public_key === config.public_key,
  listen_port_matches: iface?.listen_port === config.port,
  tunnel_address_matches: Boolean(iface?.addresses.includes(config.address)),
};
const ready = Object.values(checks).every(Boolean);
const connected = ready && peers.some(p => p.active);
const report = {
  observed_at: new Date().toISOString(),
  scope: 'Read-only signed host observation and original Docker mount/configuration; no authenticated API or browser assertion',
  user_action: 'Owner reports manually activating existing WireGuard tunnel in Windows',
  checks,
  observation_age_seconds: age,
  collector_observed_at: observed.observed_at,
  interface: iface?.name ?? null,
  service_state: observed.service_state,
  peers,
  collector_errors: observed.errors,
  expected_status_from_inspected_backend_rule: ready ? (connected ? 'ACTIVE' : 'DISCONNECTED') : 'BLOCKED_OR_NOT_CONFIGURED',
  authenticated_api_and_panel: 'NOT_RUN',
  peer_connectivity: connected ? 'PASS_RECENT_HANDSHAKE' : 'BLOCKED_NO_RECENT_HANDSHAKE',
  collector_probe: JSON.parse(readFileSync('.run/infrastructure-agent/collector-last-run.json', 'utf8').replace(/^\uFEFF/, '')),
  network_service_configuration_changes_by_agent: 0,
  status: ready ? 'PASS_LOCAL_ACTIVATION_AND_OBSERVATION' : 'FAIL_LOCAL_OBSERVATION_OR_IDENTITY',
};
writeFileSync('docs/audits/evidence/2026-11-17-vpn-after-manual-activation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (!ready) process.exitCode = 1;
