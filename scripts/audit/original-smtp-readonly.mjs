/** Preflight only: do not send or reveal SMTP credentials. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const query = `SELECT json_build_object('settings',COALESCE((SELECT json_agg(json_build_object('key',key,'value',value)) FROM core_systemsetting WHERE key IN ('smtp','smtp_candidate','smtp_service_contact','smtp_service_automatic','mail_mode')),'[]'::json),'secret_keys',COALESCE((SELECT json_agg(key) FROM core_systemsecret WHERE key LIKE 'smtp%'),'[]'::json))`;
const data = JSON.parse(execFileSync('docker', ['exec', 'uasspain-postgres', 'psql', '-X', '-U', 'uasspain', '-d', 'uasspain', '-qtA', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8', windowsHide: true }));
const backend = JSON.parse(execFileSync('docker', ['inspect', 'uasspain-backend'], { encoding: 'utf8', windowsHide: true }))[0];
if (backend.Config.Labels['com.docker.compose.project'] !== 'uasspain') throw Error('Unexpected project');
const env = Object.fromEntries(backend.Config.Env.map(line => { const i = line.indexOf('='); return [line.slice(0,i), line.slice(i+1)]; }));
const legacy = data.settings.find(x => x.key === 'smtp')?.value;
function summary(config) { return config ? { enabled: config.enabled === true, host_present: !!config.host, port: config.port, security: config.security, username_present: !!config.username, sender_present: !!config.from_email, last_test_ok: config.last_test_ok ?? null } : null; }
const report = { observed_at: new Date().toISOString(), scope: 'ORIGINAL metadata preflight for one authorized external message; no send, credential/config changes or external backup probes', mode: data.settings.find(x => x.key === 'mail_mode')?.value?.api_exclusive ? 'API_EXCLUSIVE' : 'SMTP', saved_legacy: summary(legacy), services: data.settings.filter(x => /^smtp_service_/.test(x.key)).map(x => ({ service: x.key.slice(13), active: { enabled: x.value.active?.enabled === true, authorized_sender: x.value.active?.authorized_sender === true, shared_transport: x.value.active?.shared_transport === true, config: summary(x.value.active?.config) }, draft_present: !!x.value.draft, proof_states: (x.value.proofs || []).map(p => p.state) })), secret_key_names_only: data.secret_keys, environment: Object.fromEntries(Object.entries(env).filter(([k]) => /^(SMTP_|DEV_EMAIL|APP_PRODUCTION)/.test(k)).map(([k,v]) => [k, /PASS|SECRET|TOKEN|USER|FROM|RECIPIENT|HOST/i.test(k) ? { present: !!v } : v])), smtp_attempts: 0, delivery: 'NOT_RUN', credentials_revealed: false };
writeFileSync(resolve(root, 'docs/audits/evidence/2026-11-16-original-smtp-preflight.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
